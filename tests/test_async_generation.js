// Test Async Image Generation Functionality
const axios = require('axios');

async function testAsyncImageGeneration() {
  const baseURL = 'http://localhost:7777';

  try {
    console.log('=== Testing Async Image Generation System ===\n');

    // Test 1: Submit async job
    console.log('1. Submitting async image generation job...');
    const jobPayload = {
      prompt: 'a futuristic city with flying cars, cyberpunk style, digital art',
      width: 512,
      height: 512,
      seed: 98765,
      async: true // Enable async mode
    };

    const jobResponse = await axios.post(`${baseURL}/api/generate-image`, jobPayload);

    if (jobResponse.data.success) {
      console.log('✅ Job submitted successfully');
      console.log(`  - Job ID: ${jobResponse.data.jobId}`);
      console.log(`  - Status: ${jobResponse.data.status}`);
      console.log(`  - Message: ${jobResponse.data.message}`);
      console.log(`  - Estimated time: ${jobResponse.data.estimatedTime}`);

      const jobId = jobResponse.data.jobId;

      // Test 2: Track job progress
      console.log('\n2. Tracking job progress...');
      let completed = false;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes max

      while (!completed && attempts < maxAttempts) {
        attempts++;

        try {
          const statusResponse = await axios.get(`${baseURL}/api/jobs/${jobId}`);

          if (statusResponse.data.success) {
            const job = statusResponse.data.job;
            console.log(`  [${attempts}] Status: ${job.status} | Progress: ${job.progress}% | ${job.message}`);

            if (job.status === 'completed') {
              console.log('✅ Job completed successfully!');
              console.log(`  - Processing time: ${new Date(job.completedAt) - new Date(job.createdAt)}ms`);

              if (statusResponse.data.result) {
                console.log(`  - Image ID: ${statusResponse.data.result.imageId}`);
                console.log(`  - Generated images: ${statusResponse.data.result.images.length}`);

                for (const image of statusResponse.data.result.images) {
                  console.log(`  - Image URL: ${image.url}`);
                  console.log(`  - File size: ${image.size} bytes`);
                }
              }

              completed = true;

              // Test 3: Verify image is accessible
              console.log('\n3. Verifying generated image...');
              if (statusResponse.data.result && statusResponse.data.result.images.length > 0) {
                const imageUrl = statusResponse.data.result.images[0].url;

                try {
                  const imageResponse = await axios.get(`${baseURL}${imageUrl}`, {
                    responseType: 'arraybuffer'
                  });

                  console.log('✅ Image accessible via URL');
                  console.log(`  - Content-Type: ${imageResponse.headers['content-type']}`);
                  console.log(`  - File size: ${imageResponse.data.length} bytes`);
                } catch (imageError) {
                  console.log('❌ Failed to access image:', imageError.message);
                }
              }

            } else if (job.status === 'failed' || job.status === 'timeout') {
              console.log(`❌ Job failed with status: ${job.status}`);
              if (statusResponse.data.error) {
                console.log(`  - Error: ${statusResponse.data.error}`);
              }
              completed = true;
            }
          }
        } catch (statusError) {
          console.log(`  [${attempts}] Error checking status: ${statusError.message}`);
        }

        if (!completed) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        }
      }

      if (!completed) {
        console.log('⚠️  Job tracking timed out after 2 minutes');
      }

      // Test 4: List all jobs
      console.log('\n4. Testing job listing...');
      try {
        const jobsResponse = await axios.get(`${baseURL}/api/jobs`);

        if (jobsResponse.data.success) {
          console.log('✅ Job listing successful');
          console.log(`  - Total jobs: ${jobsResponse.data.jobs.length}`);
          console.log(`  - Pending in queue: ${jobsResponse.data.queue.pending}`);
          console.log(`  - Currently processing: ${jobsResponse.data.queue.processing}`);

          // Show recent jobs
          const recentJobs = jobsResponse.data.jobs.slice(0, 3);
          console.log('  - Recent jobs:');
          recentJobs.forEach((job, index) => {
            console.log(`    ${index + 1}. ${job.id} - ${job.status} - "${job.prompt}"`);
          });
        }
      } catch (listError) {
        console.log('❌ Failed to list jobs:', listError.message);
      }

      // Test 5: Test sync mode (legacy)
      console.log('\n5. Testing legacy sync mode...');
      try {
        const syncPayload = {
          prompt: 'a simple red apple on a white background',
          width: 256,
          height: 256,
          seed: 12345,
          async: false // Force sync mode
        };

        console.log('  Submitting sync request (this will take 30-60 seconds)...');
        const syncResponse = await axios.post(`${baseURL}/api/generate-image`, syncPayload, {
          timeout: 120000 // 2 minute timeout
        });

        if (syncResponse.data.success) {
          console.log('✅ Sync generation successful');
          console.log(`  - Image ID: ${syncResponse.data.imageId}`);
          console.log(`  - Processing time: ${syncResponse.data.processingTime}ms`);
        }
      } catch (syncError) {
        console.log('❌ Sync generation failed:', syncError.message);
      }

    } else {
      console.log('❌ Failed to submit job:', jobResponse.data.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('  Server response:', error.response.data);
    }
  }

  console.log('\n🎉 Async image generation testing completed!');
}

// Run the test
testAsyncImageGeneration();