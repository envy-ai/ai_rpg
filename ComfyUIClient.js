const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const {
  createAbortError,
  ensureDirectory,
  isAbortError,
  resolveImageFilePath,
  throwIfAborted
} = require('./image_client_utils.js');

/**
 * ComfyUI API Client
 * Handles communication with ComfyUI server for image generation
 */
class ComfyUIClient {
  constructor(config, { WebSocketImpl = WebSocket } = {}) {
    this.host = config.imagegen.server.host;
    this.port = config.imagegen.server.port;
    this.baseURL = `http://${this.host}:${this.port}`;
    this.timeout = 30000; // 30 second timeout
    this.maxRetries = 3;
    this.WebSocketImpl = WebSocketImpl;
    this.progressConnectionTimeout = 5000;
  }

  /**
   * Generate a unique prompt ID
   */
  generatePromptId() {
    return crypto.randomUUID();
  }

  /**
   * Queue a workflow for execution
   * @param {Object} workflow - ComfyUI workflow JSON
   * @param {string} promptId - Unique prompt ID
   * @returns {Promise<Object>} Response from ComfyUI
   */
  async queuePrompt(workflow, promptId = null, options = {}) {
    const id = promptId || this.generatePromptId();
    const signal = options?.signal || null;
    throwIfAborted(signal, `ComfyUI prompt ${id} cancelled before queueing.`);

    const payload = {
      prompt: workflow,
      client_id: crypto.randomUUID(),
      prompt_id: id
    };

    try {
      console.log(`🎨 Queuing ComfyUI prompt ${id}...`);

      const response = await axios.post(`${this.baseURL}/prompt`, payload, {
        timeout: this.timeout,
        signal: signal || undefined,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      throwIfAborted(signal, `ComfyUI prompt ${id} cancelled while queueing.`);
      console.log(`✅ ComfyUI prompt ${id} queued successfully`);
      return {
        success: true,
        promptId: id,
        clientId: payload.client_id,
        data: response.data
      };

    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw createAbortError(signal?.reason || error?.message || `ComfyUI prompt ${id} cancelled.`);
      }
      console.error(`❌ Failed to queue ComfyUI prompt ${id}:`, error.message);
      return {
        success: false,
        error: error.message,
        promptId: id,
        clientId: payload.client_id
      };
    }
  }

  buildProgressWebSocketUrl(clientId) {
    if (typeof clientId !== 'string' || !clientId.trim()) {
      throw new Error('ComfyUI progress WebSocket requires a client id.');
    }
    const url = new URL(this.baseURL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = new URLSearchParams({ clientId: clientId.trim() }).toString();
    return url.toString();
  }

  async openProgressWebSocket({ clientId, promptId, onProgress, signal = null }) {
    if (typeof promptId !== 'string' || !promptId.trim()) {
      throw new Error('ComfyUI progress WebSocket requires a prompt id.');
    }
    if (typeof onProgress !== 'function') {
      throw new Error('ComfyUI progress WebSocket requires onProgress().');
    }
    throwIfAborted(signal, `ComfyUI prompt ${promptId} cancelled before progress connection.`);

    const socket = new this.WebSocketImpl(this.buildProgressWebSocketUrl(clientId));
    socket.comfyExecutionError = null;

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        socket.close();
        reject(new Error(`Timed out connecting to ComfyUI progress WebSocket for prompt ${promptId}.`));
      }, this.progressConnectionTimeout);

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.removeListener('open', handleOpen);
        socket.removeListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };
      const handleOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const handleError = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(
          `Failed to connect to ComfyUI progress WebSocket for prompt ${promptId}: ${error?.message || String(error)}`
        ));
      };
      const handleAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        socket.close();
        reject(createAbortError(signal?.reason || `ComfyUI prompt ${promptId} cancelled.`));
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
      signal?.addEventListener('abort', handleAbort, { once: true });
    });

    socket.on('message', (rawData, isBinary) => {
      if (isBinary) {
        return;
      }

      let event;
      try {
        event = JSON.parse(Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData));
      } catch (_) {
        return;
      }

      const eventPromptId = typeof event?.data?.prompt_id === 'string'
        ? event.data.prompt_id
        : null;
      if (eventPromptId && eventPromptId !== promptId) {
        return;
      }

      if (event?.type === 'progress') {
        const value = Number(event.data?.value);
        const max = Number(event.data?.max);
        if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value < 0 || value > max) {
          console.warn(`Ignoring invalid ComfyUI progress for prompt ${promptId}: value=${event.data?.value}, max=${event.data?.max}`);
          return;
        }
        onProgress({
          promptId,
          nodeId: event.data?.node ?? null,
          value,
          max,
          fraction: value / max
        });
        return;
      }

      if (event?.type === 'execution_error' || event?.type === 'execution_interrupted') {
        const detail = event.data?.exception_message || event.data?.exception_type || event.type;
        socket.comfyExecutionError = `ComfyUI ${event.type} for prompt ${promptId}: ${detail}`;
      }
    });

    return socket;
  }

  /**
   * Get execution history for a prompt
   * @param {string} promptId - Prompt ID to check
   * @returns {Promise<Object>} History data or error
   */
  async getHistory(promptId, options = {}) {
    const signal = options?.signal || null;
    throwIfAborted(signal, `ComfyUI prompt ${promptId} cancelled.`);
    try {
      const response = await axios.get(`${this.baseURL}/history/${promptId}`, {
        timeout: this.timeout,
        signal: signal || undefined
      });

      const historyData = response.data[promptId];

      if (!historyData) {
        return {
          success: false,
          error: 'Prompt not found in history',
          promptId: promptId
        };
      }

      return {
        success: true,
        promptId: promptId,
        data: historyData,
        isComplete: historyData.status?.completed || false
      };

    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw createAbortError(signal?.reason || error?.message || `ComfyUI prompt ${promptId} cancelled.`);
      }
      console.error(`❌ Failed to get history for prompt ${promptId}:`, error.message);
      return {
        success: false,
        error: error.message,
        promptId: promptId
      };
    }
  }

  /**
   * Download an image from ComfyUI
   * @param {string} filename - Image filename
   * @param {string} subfolder - Subfolder (can be empty)
   * @param {string} folderType - Folder type (usually 'output')
   * @returns {Promise<Buffer>} Image data buffer
   */
  async getImage(filename, subfolder = '', folderType = 'output', options = {}) {
    const signal = options?.signal || null;
    throwIfAborted(signal, `ComfyUI image download ${filename} cancelled.`);
    try {
      const params = new URLSearchParams({
        filename: filename,
        subfolder: subfolder,
        type: folderType
      });

      console.log(`📥 Downloading image: ${filename}`);

      const response = await axios.get(`${this.baseURL}/view?${params}`, {
        timeout: this.timeout,
        signal: signal || undefined,
        responseType: 'arraybuffer'
      });

      console.log(`✅ Downloaded image: ${filename} (${response.data.byteLength} bytes)`);
      return Buffer.from(response.data);

    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw createAbortError(signal?.reason || error?.message || `ComfyUI image download ${filename} cancelled.`);
      }
      console.error(`❌ Failed to download image ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * Upload an existing image into ComfyUI's input directory for img2img workflows.
   * @param {string} filePath - Local source image path
   * @param {Object} options - Upload options
   * @param {string} [options.filename] - Uploaded filename
   * @param {string} [options.subfolder] - ComfyUI input subfolder
   * @param {string} [options.type] - ComfyUI folder type
   * @param {boolean} [options.overwrite] - Whether to overwrite an existing input image
   * @returns {Promise<Object>} Upload metadata including imageReference for LoadImage nodes
   */
  async uploadInputImage(filePath, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('ComfyUI uploadInputImage requires a source file path.');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`ComfyUI input image does not exist: ${filePath}`);
    }
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      throw new Error('ComfyUI image uploads require a Node runtime with FormData and Blob support.');
    }

    const {
      filename = path.basename(filePath),
      subfolder = '',
      type = 'input',
      overwrite = true
    } = options || {};
    const signal = options?.signal || null;
    throwIfAborted(signal, `ComfyUI image upload ${filePath} cancelled.`);
    const resolvedFilename = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : path.basename(filePath);
    const resolvedSubfolder = typeof subfolder === 'string' ? subfolder.trim() : '';
    const resolvedType = typeof type === 'string' && type.trim() ? type.trim() : 'input';
    const ext = path.extname(resolvedFilename).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : (ext === '.webp' ? 'image/webp' : (ext === '.gif' ? 'image/gif' : 'image/png'));

    const imageBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('image', new Blob([imageBuffer], { type: mimeType }), resolvedFilename);
    form.append('overwrite', overwrite ? 'true' : 'false');
    form.append('type', resolvedType);
    if (resolvedSubfolder) {
      form.append('subfolder', resolvedSubfolder);
    }

    try {
      console.log(`📤 Uploading ComfyUI input image: ${resolvedFilename}`);
      const response = await axios.post(`${this.baseURL}/upload/image`, form, {
        timeout: this.timeout,
        signal: signal || undefined,
        headers: typeof form.getHeaders === 'function' ? form.getHeaders() : undefined
      });

      const name = typeof response.data?.name === 'string' && response.data.name.trim()
        ? response.data.name.trim()
        : resolvedFilename;
      const returnedSubfolder = typeof response.data?.subfolder === 'string'
        ? response.data.subfolder.trim()
        : resolvedSubfolder;
      const returnedType = typeof response.data?.type === 'string' && response.data.type.trim()
        ? response.data.type.trim()
        : resolvedType;
      const imageReference = returnedSubfolder ? `${returnedSubfolder}/${name}` : name;

      return {
        success: true,
        name,
        subfolder: returnedSubfolder,
        type: returnedType,
        imageReference,
        data: response.data
      };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw createAbortError(signal?.reason || error?.message || `ComfyUI image upload ${resolvedFilename} cancelled.`);
      }
      console.error(`❌ Failed to upload ComfyUI input image ${resolvedFilename}:`, error.message);
      throw error;
    }
  }

  /**
   * Ask ComfyUI to unload cached models and release memory.
   * This is intentionally strict so callers can report cleanup failures before
   * another GPU-backed model is loaded.
   * @returns {Promise<Object>} ComfyUI response metadata
   */
  async unloadModels() {
    try {
      const response = await axios.post(`${this.baseURL}/free`, {
        unload_models: true,
        free_memory: true
      }, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      throw new Error(`Failed to ask ComfyUI to unload models: ${error?.message || String(error)}`);
    }
  }

  /**
   * Release active model weights from VRAM while preserving Cache Monitor's
   * RAM-backed model cache. If Cache Monitor is unavailable, fall back to
   * ComfyUI's full /free cleanup and report that fallback to the caller.
   * @returns {Promise<Object>} Cache Monitor or fallback response metadata
   */
  async releaseVram() {
    let cacheMonitorError = null;
    try {
      const response = await axios.post(`${this.baseURL}/comfyui-cache-monitor/release_vram`, {}, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (response.data?.released !== true) {
        throw new Error('ComfyUI Cache Monitor did not confirm that VRAM was released.');
      }
      return {
        success: true,
        fallbackUsed: false,
        data: response.data
      };
    } catch (error) {
      cacheMonitorError = new Error(
        `Failed to ask ComfyUI Cache Monitor to release VRAM: ${error?.message || String(error)}`,
        { cause: error }
      );
    }

    let fallback;
    try {
      fallback = await this.unloadModels();
    } catch (fallbackError) {
      throw new AggregateError(
        [cacheMonitorError, fallbackError],
        'ComfyUI Cache Monitor VRAM release and the /free fallback both failed.'
      );
    }

    return {
      success: true,
      fallbackUsed: true,
      cacheMonitorError: cacheMonitorError.message,
      data: fallback.data
    };
  }

  /**
   * Remove this server's queued prompts and interrupt ComfyUI's active sampler.
   * Both requests are attempted so one failed cancellation does not suppress
   * the other.
   */
  async cancelPrompts(promptIds = []) {
    if (!Array.isArray(promptIds)) {
      throw new Error('ComfyUI cancelPrompts requires an array of prompt ids.');
    }
    const normalizedPromptIds = Array.from(new Set(promptIds
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)));
    const requests = [];
    if (normalizedPromptIds.length) {
      requests.push(axios.post(`${this.baseURL}/queue`, {
        delete: normalizedPromptIds
      }, {
        timeout: this.timeout,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    requests.push(axios.post(`${this.baseURL}/interrupt`, {}, {
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' }
    }));

    const results = await Promise.allSettled(requests);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      const messages = failures.map(result => result.reason?.message || String(result.reason));
      throw new Error(`Failed to cancel ComfyUI prompt work: ${messages.join('; ')}`);
    }
    return {
      success: true,
      deletedPromptIds: normalizedPromptIds,
      interrupted: true
    };
  }

  /**
   * Wait for prompt completion and get results
   * @param {string} promptId - Prompt ID to wait for
   * @param {number} maxWaitTime - Maximum time to wait in milliseconds
   * @param {number} pollInterval - How often to check in milliseconds
   * @param {Object} options - Optional progress-stream settings
   * @param {string} [options.clientId] - Client id used when the prompt was queued
   * @param {Function} [options.onProgress] - Receives current ComfyUI sampler progress
   * @returns {Promise<Object>} Final result with images
   */
  async waitForCompletion(promptId, maxWaitTime = 300000, pollInterval = 2000, options = {}) {
    const startTime = Date.now();
    const clientId = typeof options?.clientId === 'string' ? options.clientId.trim() : '';
    const onProgress = options?.onProgress;
    const signal = options?.signal || null;
    let progressSocket = null;

    throwIfAborted(signal, `ComfyUI prompt ${promptId} cancelled.`);
    console.log(`⏳ Waiting for ComfyUI prompt ${promptId} to complete...`);

    if (typeof onProgress === 'function') {
      try {
        progressSocket = await this.openProgressWebSocket({ clientId, promptId, onProgress, signal });
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw error;
        }
        console.warn(`ComfyUI progress unavailable for prompt ${promptId}: ${error.message}`);
      }
    }

    try {
      while (Date.now() - startTime < maxWaitTime) {
        throwIfAborted(signal, `ComfyUI prompt ${promptId} cancelled.`);
        if (progressSocket?.comfyExecutionError) {
          return {
            success: false,
            error: progressSocket.comfyExecutionError,
            promptId
          };
        }

        const historyResult = await this.getHistory(promptId, { signal });

        if (!historyResult.success) {
          // If we can't get history, keep waiting (might not be in history yet)
          await this.sleep(pollInterval, signal);
          continue;
        }

        const history = historyResult.data;

        // Check if execution is complete
        if (history.outputs && Object.keys(history.outputs).length > 0) {
          console.log(`✅ ComfyUI prompt ${promptId} completed!`);

          // Extract image information
          const images = [];
          for (const nodeId in history.outputs) {
            const nodeOutput = history.outputs[nodeId];
            if (nodeOutput.images) {
              for (const imageInfo of nodeOutput.images) {
                images.push({
                  filename: imageInfo.filename,
                  subfolder: imageInfo.subfolder,
                  type: imageInfo.type,
                  nodeId: nodeId
                });
              }
            }
          }

          return {
            success: true,
            promptId: promptId,
            images: images,
            history: history
          };
        }

        // Wait before next check
        await this.sleep(pollInterval, signal);
      }

      // Timeout reached
      console.error(`⏰ Timeout waiting for ComfyUI prompt ${promptId}`);
      return {
        success: false,
        error: 'Timeout waiting for completion',
        promptId: promptId
      };
    } finally {
      if (progressSocket && progressSocket.readyState === this.WebSocketImpl.OPEN) {
        progressSocket.close();
      }
    }
  }

  /**
   * Test connection to ComfyUI server
   * @returns {Promise<boolean>} True if connection successful
   */
  async testConnection() {
    try {
      console.log(`🔍 Testing ComfyUI connection to ${this.baseURL}...`);

      const response = await axios.get(`${this.baseURL}/queue`, {
        timeout: baseTimeoutMilliseconds
      });

      console.log(`✅ ComfyUI server is reachable`);
      return true;

    } catch (error) {
      console.error(`❌ ComfyUI server unreachable: ${error.message}`);
      return false;
    }
  }

  /**
   * Sleep utility function
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms, signal = null) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', handleAbort);
        reject(createAbortError(signal?.reason));
      };
      const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', handleAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', handleAbort, { once: true });
    });
  }

  /**
   * Save image data to file with unique filename
   * @param {Buffer} imageData - Image buffer
   * @param {string} imageId - Unique image ID
   * @param {string} originalFilename - Original filename from ComfyUI
   * @param {string} saveDirectory - Directory to save to
   * @returns {Object} File save result
   */
  async saveImage(imageData, imageId, originalFilename, saveDirectory) {
    try {
      const { filename, filepath } = resolveImageFilePath(imageId, originalFilename, saveDirectory);

      // Ensure directory exists
      ensureDirectory(saveDirectory);

      // Write file
      fs.writeFileSync(filepath, imageData);

      console.log(`💾 Saved image: ${filepath} (${imageData.length} bytes)`);

      return {
        success: true,
        filename: filename,
        filepath: filepath,
        size: imageData.length
      };

    } catch (error) {
      console.error(`❌ Failed to save image ${imageId}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ComfyUIClient;
