const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class OpenAIImageClient {
  constructor(config) {
    const engineConfig = config?.imagegen ?? {};

    this.apiKey = engineConfig.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = engineConfig.endpoint || 'https://api.openai.com/v1/images/generations';
    this.model = engineConfig.model || null;

    if (!this.apiKey) {
      throw new Error('OpenAI image generation requires imagegen.apiKey or OPENAI_API_KEY.');
    }

    if (!this.model) {
      throw new Error('OpenAI image generation requires imagegen.model.');
    }

    this.timeout = 60000;
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
      if (!data || !Array.isArray(data.data) || !data.data.length || !data.data[0]?.b64_json) {
        throw new Error('OpenAI image response missing image data.');
      }

      const imageBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      return {
        requestId,
        imageBuffer,
        mimeType: data.data[0]?.mime_type || 'image/png'
      };
    } catch (error) {
      const message = error?.response?.data?.error?.message || error.message || String(error);
      throw new Error(`OpenAI image request failed: ${message}`);
    }
  }

  async saveImage(imageBuffer, imageId, originalFilename, saveDirectory) {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('OpenAI image buffer missing.');
    }

    if (!imageId) {
      throw new Error('OpenAI image save requires an imageId.');
    }

    const ext = path.extname(originalFilename || '') || '.png';
    const filename = `${imageId}${ext}`;
    const filepath = path.join(saveDirectory, filename);

    if (!fs.existsSync(saveDirectory)) {
      fs.mkdirSync(saveDirectory, { recursive: true });
    }

    fs.writeFileSync(filepath, imageBuffer);

    return {
      filename,
      filepath,
      size: imageBuffer.length
    };
  }
}

module.exports = OpenAIImageClient;
