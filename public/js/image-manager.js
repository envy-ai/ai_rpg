(function () {
  class ImageGenerationManager {
    constructor(options = {}) {
      this.pending = new Map();
      this.pollInterval = options.pollInterval || 2000;
      this.maxAttempts = options.maxAttempts || 120;
      this.realtimeEnabled = false;
      this.jobWaiters = new Map();
    }

    _buildKey(entityType, entityId) {
      return `${entityType || ''}:${entityId || ''}`;
    }

    _buildImageUrl(imageId) {
      if (!imageId) {
        return null;
      }
      return `/generated-images/${imageId}.png`;
    }

    _dispatch(eventName, detail) {
      try {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
      } catch (_) {
        // Ignore environments without CustomEvent support
      }
    }

    ensureImage({ entityType, entityId, existingImageId = null, force = false } = {}) {
      if (!entityType || !entityId) {
        return Promise.resolve(null);
      }

      const normalizedType = String(entityType).toLowerCase();
      const key = this._buildKey(normalizedType, entityId);

      if (!force && existingImageId) {
        const resolved = {
          entityType: normalizedType,
          entityId,
          imageId: existingImageId,
          imageUrl: this._buildImageUrl(existingImageId),
          skipped: true
        };
        this._dispatch('image:updated', resolved);
        return Promise.resolve(resolved);
      }

      if (this.pending.has(key)) {
        return this.pending.get(key);
      }

      const requestPromise = this._requestImage({
        entityType: normalizedType,
        entityId,
        existingImageId,
        force
      }).finally(() => {
        this.pending.delete(key);
      });

      this.pending.set(key, requestPromise);
      return requestPromise;
    }

    async _requestImage({ entityType, entityId, existingImageId, force }) {
      const clientId = window.AIRPG_CLIENT_ID || null;
      const payload = {
        entityType,
        entityId,
        force: Boolean(force),
        clientId
      };
      if (existingImageId && force) {
        payload.existingImageId = existingImageId;
      }

      const response = await fetch('/api/images/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 202) {
        const error = data?.error || `Image request failed (${response.status})`;
        this._dispatch('image:error', {
          entityType,
          entityId,
          error
        });
        throw new Error(error);
      }

      const baseResult = {
        entityType,
        entityId,
        imageId: data.imageId || existingImageId || null,
        imageUrl: data.imageId ? this._buildImageUrl(data.imageId) : null,
        jobId: data.jobId || data.job?.jobId || null,
        job: data.job || null,
        skipped: Boolean(data.skipped),
        existingJob: Boolean(data.existingJob),
        reason: data.reason || null,
        message: data.message || null
      };

      if (baseResult.skipped && !force) {
        this._dispatch('image:skipped', baseResult);
        return baseResult;
      }

      if (baseResult.imageId && !baseResult.jobId) {
        // We have an immediate image reference; prefer metadata lookup to get canonical URL
        const metadata = await this._fetchImageMetadata(baseResult.imageId).catch(() => null);
        if (metadata?.metadata?.images?.[0]?.url) {
          baseResult.imageUrl = metadata.metadata.images[0].url;
        }
        this._dispatch('image:updated', baseResult);
        return baseResult;
      }

      if (baseResult.jobId) {
        return this._trackJob(baseResult.jobId, {
          entityType,
          entityId
        });
      }

      if (baseResult.existingJob && baseResult.job?.jobId) {
        return this._trackJob(baseResult.job.jobId, {
          entityType,
          entityId
        });
      }

      return baseResult;
    }

    _trackJob(jobId, context) {
      if (!jobId) {
        return Promise.resolve(null);
      }

      return this._awaitJobRealtime(jobId, context || {});

      /*
      if (!this.realtimeEnabled) {
        return this._watchJob(jobId, context || {});
      }
      */
    }

    _awaitJobRealtime(jobId, context = {}) {
      let entry = this.jobWaiters.get(jobId);
      if (!entry) {
        entry = {
          context: { ...context },
          resolve: null,
          reject: null,
          promise: null,
          pollingPromise: null
        };
        entry.promise = new Promise((resolve, reject) => {
          entry.resolve = resolve;
          entry.reject = reject;
        });
        this.jobWaiters.set(jobId, entry);
      } else {
        entry.context = { ...entry.context, ...context };
      }

      return entry.promise;
    }

    /*
    async _watchJob(jobId, context) {
      // Legacy polling implementation disabled for now.
    }
    */

    setRealtimeAvailable(isAvailable) {
      const wasEnabled = this.realtimeEnabled;
      this.realtimeEnabled = Boolean(isAvailable);

      /*
      if (!this.realtimeEnabled && wasEnabled) {
        this.jobWaiters.forEach((entry, jobId) => {
          if (entry.pollingPromise) {
            return;
          }
          entry.pollingPromise = this._watchJob(jobId, entry.context || {})
            .then(result => {
              if (this.jobWaiters.has(jobId)) {
                entry.resolve(result);
                this.jobWaiters.delete(jobId);
              }
            })
            .catch(error => {
              if (this.jobWaiters.has(jobId)) {
                entry.reject(error);
                this.jobWaiters.delete(jobId);
              }
            });
        });
      }
      */
    }

    handleRealtimeJobUpdate(update) {
      if (!update || !update.jobId) {
        return;
      }

      const entry = this.jobWaiters.get(update.jobId);
      const context = entry?.context || {};
      const detail = {
        ...context,
        jobId: update.jobId,
        payload: update.payload || {},
        job: {
          id: update.jobId,
          status: update.status,
          progress: update.progress,
          message: update.message,
          createdAt: update.createdAt,
          startedAt: update.startedAt,
          completedAt: update.completedAt
        },
        result: update.result || null,
        error: update.error || null
      };

      this._dispatch('image:job-progress', detail);

      if (update.status === 'completed' && update.result) {
        const resolved = this._buildResolvedJobResult(detail);
        if (entry) {
          entry.resolve(resolved);
          this.jobWaiters.delete(update.jobId);
        }
        this._dispatch('image:updated', resolved);
        return;
      }

      if (update.status === 'failed' || update.status === 'timeout') {
        const errorMessage = update.error || `Image job ${update.status}`;
        if (entry) {
          entry.reject(new Error(errorMessage));
          this.jobWaiters.delete(update.jobId);
        }
        this._dispatch('image:error', { ...detail, error: errorMessage });
      }
    }

    _buildResolvedJobResult(detail) {
      const payload = detail.payload || {};
      const result = detail.result || {};
      const entityType = payload.entityType || detail.entityType || null;
      const entityId = payload.entityId || detail.entityId || null;
      const imageId = result.imageId || null;

      let imageUrl = null;
      if (Array.isArray(result.images) && result.images[0]?.url) {
        imageUrl = result.images[0].url;
      } else if (imageId) {
        imageUrl = this._buildImageUrl(imageId);
      }

      return {
        entityType,
        entityId,
        imageId,
        imageUrl,
        jobId: detail.jobId,
        job: detail.job,
        metadata: result.metadata || null
      };
    }

    async _fetchJob(jobId) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch job status (${response.status})`);
      }
      return response.json();
    }

    async _fetchImageMetadata(imageId) {
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch image metadata (${response.status})`);
      }
      return response.json();
    }

    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  window.AIRPG = window.AIRPG || {};
  window.AIRPG.imageManager = new ImageGenerationManager();
})();
