const fs = require('fs');
const path = require('path');

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveImageFilePath(imageId, originalFilename, saveDirectory) {
  const ext = path.extname(originalFilename || '') || '.png';
  const filename = `${imageId}${ext}`;
  return { filename, filepath: path.join(saveDirectory, filename) };
}

function initImageEngineConfig(config, { label, envVar, defaultEndpoint }) {
  const engineConfig = config?.imagegen ?? {};

  const apiKey = engineConfig.apiKey || process.env[envVar];
  const baseURL = engineConfig.endpoint || defaultEndpoint;
  const model = engineConfig.model || null;

  if (!apiKey) {
    throw new Error(`${label} image generation requires imagegen.apiKey or ${envVar}.`);
  }

  if (!model) {
    throw new Error(`${label} image generation requires imagegen.model.`);
  }

  return { apiKey, baseURL, model, timeout: 60000 };
}

function validateImageSaveInputs(imageBuffer, imageId, label) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    throw new Error(`${label} image buffer missing.`);
  }

  if (!imageId) {
    throw new Error(`${label} image save requires an imageId.`);
  }
}

function extractB64ImageData(data, label) {
  if (!data || !Array.isArray(data.data) || !data.data.length || !data.data[0]?.b64_json) {
    throw new Error(`${label} image response missing image data.`);
  }

  return {
    imageBuffer: Buffer.from(data.data[0].b64_json, 'base64'),
    mimeType: data.data[0]?.mime_type || 'image/png'
  };
}

function createAbortError(reason = 'Operation cancelled.') {
  const message = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : (reason?.message || 'Operation cancelled.');
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError'
    || error?.name === 'CanceledError'
    || error?.code === 'ABORT_ERR'
    || error?.code === 'ERR_CANCELED';
}

function throwIfAborted(signal, fallbackReason = 'Operation cancelled.') {
  if (signal?.aborted) {
    throw createAbortError(signal.reason || fallbackReason);
  }
}

function imageRequestError(error, label) {
  if (isAbortError(error)) {
    return createAbortError(error?.message || `${label} image request cancelled.`);
  }
  const message = error?.response?.data?.error?.message || error.message || String(error);
  return new Error(`${label} image request failed: ${message}`);
}

module.exports = {
  ensureDirectory,
  resolveImageFilePath,
  initImageEngineConfig,
  validateImageSaveInputs,
  extractB64ImageData,
  createAbortError,
  isAbortError,
  throwIfAborted,
  imageRequestError
};
