const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * ComfyUI API Client
 * Handles communication with ComfyUI server for image generation
 */
class ComfyUIClient {
  constructor(config) {
    this.host = config.imagegen.server.host;
    this.port = config.imagegen.server.port;
    this.baseURL = `http://${this.host}:${this.port}`;
    this.timeout = 30000; // 30 second timeout
    this.maxRetries = 3;
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
  async queuePrompt(workflow, promptId = null) {
    const id = promptId || this.generatePromptId();

    const payload = {
      prompt: workflow,
      client_id: crypto.randomUUID(),
      prompt_id: id
    };

    try {
      console.log(`🎨 Queuing ComfyUI prompt ${id}...`);

      const response = await axios.post(`${this.baseURL}/prompt`, payload, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ ComfyUI prompt ${id} queued successfully`);
      return {
        success: true,
        promptId: id,
        data: response.data
      };

    } catch (error) {
      console.error(`❌ Failed to queue ComfyUI prompt ${id}:`, error.message);
      return {
        success: false,
        error: error.message,
        promptId: id
      };
    }
  }

  /**
   * Get execution history for a prompt
   * @param {string} promptId - Prompt ID to check
   * @returns {Promise<Object>} History data or error
   */
  async getHistory(promptId) {
    try {
      const response = await axios.get(`${this.baseURL}/history/${promptId}`, {
        timeout: this.timeout
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
  async getImage(filename, subfolder = '', folderType = 'output') {
    try {
      const params = new URLSearchParams({
        filename: filename,
        subfolder: subfolder,
        type: folderType
      });

      console.log(`📥 Downloading image: ${filename}`);

      const response = await axios.get(`${this.baseURL}/view?${params}`, {
        timeout: this.timeout,
        responseType: 'arraybuffer'
      });

      console.log(`✅ Downloaded image: ${filename} (${response.data.byteLength} bytes)`);
      return Buffer.from(response.data);

    } catch (error) {
      console.error(`❌ Failed to download image ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * Wait for prompt completion and get results
   * @param {string} promptId - Prompt ID to wait for
   * @param {number} maxWaitTime - Maximum time to wait in milliseconds
   * @param {number} pollInterval - How often to check in milliseconds
   * @returns {Promise<Object>} Final result with images
   */
  async waitForCompletion(promptId, maxWaitTime = 300000, pollInterval = 2000) {
    const startTime = Date.now();

    console.log(`⏳ Waiting for ComfyUI prompt ${promptId} to complete...`);

    while (Date.now() - startTime < maxWaitTime) {
      const historyResult = await this.getHistory(promptId);

      if (!historyResult.success) {
        // If we can't get history, keep waiting (might not be in history yet)
        await this.sleep(pollInterval);
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
      await this.sleep(pollInterval);
    }

    // Timeout reached
    console.error(`⏰ Timeout waiting for ComfyUI prompt ${promptId}`);
    return {
      success: false,
      error: 'Timeout waiting for completion',
      promptId: promptId
    };
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
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      // Extract file extension
      const ext = path.extname(originalFilename) || '.png';
      const filename = `${imageId}${ext}`;
      const filepath = path.join(saveDirectory, filename);

      // Ensure directory exists
      if (!fs.existsSync(saveDirectory)) {
        fs.mkdirSync(saveDirectory, { recursive: true });
      }

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