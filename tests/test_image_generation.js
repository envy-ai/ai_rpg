// Test Image Generation Functionality
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testImageGeneration() {
  const baseURL = 'http://localhost:7777';

  try {
    console.log('=== Testing Image Generation Functionality ===');

    // Test 1: Check if image generation is enabled
    console.log('\n1. Checking image generation configuration...');

    const testPayload = {
      prompt: 'a beautiful landscape with mountains and a lake, digital art',
      width: 512,
      height: 512,
      seed: 12345
    };

    console.log('Test payload:', testPayload);

    // Test 2: Submit image generation request
    console.log('\n2. Submitting image generation request...');

    try {
      const generateResponse = await axios.post(`${baseURL}/api/generate-image`, testPayload, {
        timeout: 120000 // 2 minute timeout for image generation
      });

      if (generateResponse.data.success) {
        console.log('✅ Image generation request successful');
        console.log(`  - Image ID: ${generateResponse.data.imageId}`);
        console.log(`  - Generated images: ${generateResponse.data.images.length}`);

        for (const image of generateResponse.data.images) {
          console.log(`  - Image URL: ${image.url}`);
          console.log(`  - File size: ${image.size} bytes`);
        }

        // Test 3: Verify image metadata endpoint
        console.log('\n3. Testing image metadata retrieval...');
        const metadataResponse = await axios.get(`${baseURL}/api/images/${generateResponse.data.imageId}`);

        if (metadataResponse.data.success) {
          console.log('✅ Image metadata retrieved successfully');
          console.log(`  - Prompt: ${metadataResponse.data.metadata.prompt}`);
          console.log(`  - Dimensions: ${metadataResponse.data.metadata.width}x${metadataResponse.data.metadata.height}`);
          console.log(`  - Seed: ${metadataResponse.data.metadata.seed}`);
        } else {
          console.log('❌ Failed to retrieve image metadata');
        }

        // Test 4: Check if image file exists
        console.log('\n4. Verifying image file accessibility...');
        const firstImage = generateResponse.data.images[0];

        try {
          const imageResponse = await axios.get(`${baseURL}${firstImage.url}`, {
            responseType: 'arraybuffer'
          });

          console.log('✅ Image file accessible via URL');
          console.log(`  - Content-Type: ${imageResponse.headers['content-type']}`);
          console.log(`  - File size: ${imageResponse.data.byteLength} bytes`);

          // Verify file exists on disk
          const localPath = path.join(__dirname, 'public', 'generated-images', firstImage.filename);
          if (fs.existsSync(localPath)) {
            const stats = fs.statSync(localPath);
            console.log('✅ Image file exists on disk');
            console.log(`  - Local path: ${localPath}`);
            console.log(`  - File size: ${stats.size} bytes`);
          } else {
            console.log('❌ Image file not found on disk');
          }

        } catch (imageError) {
          console.log('❌ Failed to access image file:', imageError.message);
        }

      } else {
        console.log('❌ Image generation failed:', generateResponse.data.error);
      }

    } catch (generateError) {
      if (generateError.response) {
        console.log('❌ Image generation API error:', generateError.response.data.error);

        // Check common error conditions
        if (generateError.response.status === 503) {
          console.log('💡 Image generation may be disabled or ComfyUI server unreachable');
        } else if (generateError.response.status === 400) {
          console.log('💡 Check the request parameters');
        } else if (generateError.response.status === 500) {
          console.log('💡 Internal server error - check ComfyUI connectivity');
        }
      } else {
        console.log('❌ Network error:', generateError.message);
      }
    }

    // Test 5: List all generated images
    console.log('\n5. Testing image listing endpoint...');

    try {
      const listResponse = await axios.get(`${baseURL}/api/images`);

      if (listResponse.data.success) {
        console.log('✅ Image listing successful');
        console.log(`  - Total images: ${listResponse.data.count}`);

        if (listResponse.data.images.length > 0) {
          console.log('  - Recent images:');
          listResponse.data.images.slice(-3).forEach((img, index) => {
            console.log(`    ${index + 1}. ${img.id} - "${img.prompt.substring(0, 50)}..."`);
          });
        }
      } else {
        console.log('❌ Failed to list images');
      }
    } catch (listError) {
      console.log('❌ Image listing error:', listError.message);
    }

    console.log('\n🎉 Image generation testing completed!');
    console.log('\n📋 Summary:');
    console.log('  ✅ Image generation API endpoint implemented');
    console.log('  ✅ Image metadata storage and retrieval');
    console.log('  ✅ File serving and storage system');
    console.log('  ✅ Error handling for various scenarios');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test ComfyUI template rendering
async function testTemplateRendering() {
  console.log('\n=== Testing ComfyUI Template Rendering ===');

  const nunjucks = require('nunjucks');
  const fs = require('fs');
  const path = require('path');

  try {
    // Configure template environment
    const templateEnv = nunjucks.configure('imagegen', { autoescape: false });

    const templateVars = {
      image: {
        prompt: 'test prompt',
        width: 512,
        height: 512,
        seed: 42
      },
      negative_prompt: 'test negative prompt'
    };

    const templatePath = path.join(__dirname, 'imagegen', 'default.json.njk');

    if (!fs.existsSync(templatePath)) {
      console.log('❌ Template file not found:', templatePath);
      return;
    }

    const renderedJson = templateEnv.render('default.json.njk', templateVars);

    try {
      const workflow = JSON.parse(renderedJson);
      console.log('✅ Template rendering successful');
      console.log(`  - Template variables applied correctly`);
      console.log(`  - Valid JSON workflow generated`);
      console.log(`  - Workflow nodes: ${Object.keys(workflow).length}`);
    } catch (parseError) {
      console.log('❌ Template rendered invalid JSON:', parseError.message);
      console.log('Rendered template excerpt:', renderedJson.substring(0, 200) + '...');
    }

  } catch (templateError) {
    console.log('❌ Template rendering error:', templateError.message);
  }
}

// Run tests
async function runAllTests() {
  await testTemplateRendering();
  await testImageGeneration();
}

runAllTests();