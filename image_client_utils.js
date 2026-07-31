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

function imageRequestError(error, label) {
  const message = error?.response?.data?.error?.message || error.message || String(error);
  return new Error(`${label} image request failed: ${message}`);
}

module.exports = {
  ensureDirectory,
  resolveImageFilePath,
  initImageEngineConfig,
  validateImageSaveInputs,
  extractB64ImageData,
  imageRequestError
};
