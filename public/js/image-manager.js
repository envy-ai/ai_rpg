(function () {
  class ImageGenerationManager {
    constructor(options = {}) {
      this.pending = new Map();
      this.pollInterval = options.pollInterval || 2000;
      this.maxAttempts = options.maxAttempts || 120;
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
      const payload = {
        entityType,
        entityId,
        force: Boolean(force)
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
        return this._watchJob(baseResult.jobId, {
          entityType,
          entityId
        });
      }

      if (baseResult.existingJob && baseResult.job?.jobId) {
        return this._watchJob(baseResult.job.jobId, {
          entityType,
          entityId
        });
      }

      return baseResult;
    }

    async _watchJob(jobId, context) {
      for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
        await this._sleep(this.pollInterval);
        const jobData = await this._fetchJob(jobId);

        const detail = {
          ...context,
          jobId,
          job: jobData.job,
          result: jobData.result || null,
          error: jobData.error || null
        };
        this._dispatch('image:job-progress', detail);

        const status = jobData?.job?.status;
        if (status === 'completed' && jobData.result) {
          const imageId = jobData.result.imageId || null;
          let imageUrl = jobData.result.images && jobData.result.images[0]
            ? jobData.result.images[0].url
            : null;
          if (!imageUrl && imageId) {
            imageUrl = this._buildImageUrl(imageId);
          }

          const resolved = {
            entityType: context.entityType,
            entityId: context.entityId,
            imageId,
            imageUrl,
            jobId,
            job: jobData.job,
            metadata: jobData.result.metadata || null
          };

          this._dispatch('image:updated', resolved);
          return resolved;
        }

        if (status === 'failed' || status === 'timeout') {
          this._dispatch('image:error', detail);
          throw new Error(detail.error || `Image job ${status}`);
        }
      }

      const timeoutError = `Image job ${jobId} timed out`;
      this._dispatch('image:error', {
        ...context,
        jobId,
        error: timeoutError
      });
      throw new Error(timeoutError);
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
