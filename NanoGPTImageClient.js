const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const {
  resolveImageFilePath,
  initImageEngineConfig,
  validateImageSaveInputs,
  extractB64ImageData,
  throwIfAborted,
  imageRequestError
} = require('./image_client_utils.js');

class NanoGPTImageClient {
  constructor(config) {
    const { apiKey, baseURL, model, timeout } = initImageEngineConfig(config, {
      label: 'NanoGPT',
      envVar: 'NANOGPT_API_KEY',
      defaultEndpoint: 'https://nano-gpt.com/'
    });

    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.timeout = timeout;
  }

  generatePromptId() {
    return crypto.randomUUID();
  }

  async generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024, seed = null, signal = null }) {
    const requestId = this.generatePromptId();
    throwIfAborted(signal, 'NanoGPT image request cancelled.');

    const payload = {
      model: this.model,
      prompt,
      negative_prompt: negativePrompt,
      size: `${width}x${height}`,
    };

    if (seed !== null && seed !== undefined) {
      payload.seed = seed;
    }

    try {
      const response = await axios.post(
        `${this.baseURL}/api/generate-image`,
        payload,
        {
          timeout: this.timeout,
          signal: signal || undefined,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      throwIfAborted(signal, 'NanoGPT image request cancelled.');
      const data = response.data;
      const { imageBuffer, mimeType } = extractB64ImageData(data, 'NanoGPT');
      return { requestId, imageBuffer, mimeType };
    } catch (error) {
      throw imageRequestError(error, 'NanoGPT');
    }
  }

  async saveImage(imageBuffer, imageId, originalFilename, saveDirectory) {
    validateImageSaveInputs(imageBuffer, imageId, 'NanoGPT');

    const { filename, filepath } = resolveImageFilePath(imageId, originalFilename, saveDirectory);

    fs.writeFileSync(filepath, imageBuffer);

    return {
      filename,
      filepath,
      size: imageBuffer.length,
    };
  }
}

module.exports = NanoGPTImageClient;
