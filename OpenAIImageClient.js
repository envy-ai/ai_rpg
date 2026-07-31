const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const {
  ensureDirectory,
  resolveImageFilePath,
  initImageEngineConfig,
  validateImageSaveInputs,
  extractB64ImageData,
  imageRequestError
} = require('./image_client_utils.js');

class OpenAIImageClient {
  constructor(config) {
    const { apiKey, baseURL, model, timeout } = initImageEngineConfig(config, {
      label: 'OpenAI',
      envVar: 'OPENAI_API_KEY',
      defaultEndpoint: 'https://api.openai.com/v1/images/generations'
    });

    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.timeout = timeout;
  }

  generateRequestId() {
    return crypto.randomUUID();
  }

  async generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024 }) {
    const requestId = this.generateRequestId();

    const size = `${width}x${height}`;
    const combinedPrompt = negativePrompt
      ? `${prompt}\nNegative prompt: ${negativePrompt}`
      : prompt;

    try {
      const response = await axios.post(
        this.baseURL,
        {
          model: this.model,
          prompt: combinedPrompt,
          size,
          n: 1
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          }
        }
      );

      const data = response.data;
      const { imageBuffer, mimeType } = extractB64ImageData(data, 'OpenAI');
      return {
        requestId,
        imageBuffer,
        mimeType
      };
    } catch (error) {
      throw imageRequestError(error, 'OpenAI');
    }
  }

  async saveImage(imageBuffer, imageId, originalFilename, saveDirectory) {
    validateImageSaveInputs(imageBuffer, imageId, 'OpenAI');

    const { filename, filepath } = resolveImageFilePath(imageId, originalFilename, saveDirectory);

    ensureDirectory(saveDirectory);

    fs.writeFileSync(filepath, imageBuffer);

    return {
      filename,
      filepath,
      size: imageBuffer.length
    };
  }
}

module.exports = OpenAIImageClient;
