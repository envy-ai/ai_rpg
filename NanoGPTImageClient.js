const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class NanoGPTImageClient {
  constructor(config) {
    const engineConfig = config?.imagegen ?? {};

    this.apiKey = engineConfig.apiKey || process.env.NANOGPT_API_KEY;
    this.baseURL = engineConfig.endpoint || 'https://nano-gpt.com/';
    this.model = engineConfig.model || null;

    if (!this.apiKey) {
      throw new Error('NanoGPT image generation requires imagegen.apiKey or NANOGPT_API_KEY.');
    }

    if (!this.model) {
      throw new Error('NanoGPT image generation requires imagegen.model.');
    }

    this.timeout = 60000;
  }

  generatePromptId() {
    return crypto.randomUUID();
  }

  async generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024, seed = null }) {
    const requestId = this.generatePromptId();

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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      const data = response.data;
      if (!data || !Array.isArray(data.data) || !data.data.length || !data.data[0]?.b64_json) {
        throw new Error('NanoGPT image response missing image data.');
      }

      const imageBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      return { requestId, imageBuffer, mimeType: data.data[0]?.mime_type || 'image/png' };
    } catch (error) {
      const message = error?.response?.data?.error?.message || error.message || String(error);
      throw new Error(`NanoGPT image request failed: ${message}`);
    }
  }

  async saveImage(imageBuffer, imageId, originalFilename, saveDirectory) {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('NanoGPT image buffer missing.');
    }

    if (!imageId) {
      throw new Error('NanoGPT image save requires an imageId.');
    }

    const ext = path.extname(originalFilename || '') || '.png';
    const filename = `${imageId}${ext}`;
    const filepath = path.join(saveDirectory, filename);

    fs.writeFileSync(filepath, imageBuffer);

    return {
      filename,
      filepath,
      size: imageBuffer.length,
    };
  }
}

module.exports = NanoGPTImageClient;
