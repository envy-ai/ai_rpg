const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Import Player class
const Player = require('./Player.js');

// Import Location and LocationExit classes  
const Location = require('./Location.js');
const LocationExit = require('./LocationExit.js');

// Import ComfyUI client
const ComfyUIClient = require('./ComfyUIClient.js');

// Load configuration
let config;
try {
    const configFile = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    config = yaml.load(configFile);
} catch (error) {
    console.error('Error loading config.yaml:', error.message);
    process.exit(1);
}

const app = express();
const PORT = config.server.port;

// Initialize ComfyUI client if image generation is enabled
let comfyUIClient = null;
const generatedImages = new Map(); // Store image metadata by ID

// Image generation job queue and tracking
const imageJobs = new Map(); // Store job status by ID
const jobQueue = []; // Queue of pending jobs
let isProcessingJob = false; // Flag to prevent concurrent processing

// Job status constants
const JOB_STATUS = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    TIMEOUT: 'timeout'
};

// Debouncing for player image regeneration
const playerImageRegenerationTimeouts = new Map(); // Player ID -> timeout ID
const locationImageRegenerationTimeouts = new Map(); // Location ID -> timeout ID
const locationExitImageRegenerationTimeouts = new Map(); // LocationExit ID -> timeout ID
const IMAGE_REGENERATION_DEBOUNCE_MS = 2000; // 2 seconds debounce

// Create a new image generation job
function createImageJob(jobId, payload) {
    const job = {
        id: jobId,
        status: JOB_STATUS.QUEUED,
        payload: payload,
        progress: 0,
        message: 'Job queued for processing',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        timeout: 120000 // 2 minutes timeout
    };

    imageJobs.set(jobId, job);
    return job;
}

// Enhanced error handling wrapper
async function withRetry(operation, maxRetries = 3, delay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            // Don't retry certain types of errors
            if (error.code === 'ENOTFOUND' || error.response?.status === 404 || error.response?.status === 401) {
                throw error;
            }

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    throw lastError;
}

// Process the job queue
async function processJobQueue() {
    if (isProcessingJob || jobQueue.length === 0 || !comfyUIClient) {
        return;
    }

    isProcessingJob = true;

    try {
        const jobId = jobQueue.shift();
        const job = imageJobs.get(jobId);

        if (!job || job.status !== JOB_STATUS.QUEUED) {
            return;
        }

        // Update job status
        job.status = JOB_STATUS.PROCESSING;
        job.startedAt = new Date().toISOString();
        job.progress = 10;
        job.message = 'Starting image generation...';

        // Set timeout
        const timeoutId = setTimeout(() => {
            if (job.status === JOB_STATUS.PROCESSING) {
                job.status = JOB_STATUS.TIMEOUT;
                job.error = 'Job timed out after 2 minutes';
                job.completedAt = new Date().toISOString();
            }
        }, job.timeout);

        try {
            const result = await processImageGeneration(job);

            clearTimeout(timeoutId);

            if (job.status !== JOB_STATUS.TIMEOUT) {
                job.status = JOB_STATUS.COMPLETED;
                job.progress = 100;
                job.result = result;
                job.message = 'Image generation completed successfully';
                job.completedAt = new Date().toISOString();

                // Update player's imageId if this was a player portrait job
                if (job.payload.isPlayerPortrait && job.payload.playerId && result.imageId) {
                    const player = players.get(job.payload.playerId);
                    if (player) {
                        player.imageId = result.imageId;
                        console.log(`🎨 Updated player ${player.name} imageId to: ${result.imageId}`);
                    }
                }

                // Update location's imageId if this was a location scene job
                if (job.payload.isLocationScene && job.payload.locationId && result.imageId) {
                    const location = gameLocations.get(job.payload.locationId);
                    if (location) {
                        location.imageId = result.imageId;
                        console.log(`🏞️ Updated location ${location.id} imageId to: ${result.imageId}`);
                    }
                }

                // Update location exit's imageId if this was a location exit passage job
                if (job.payload.isLocationExitImage && job.payload.locationExitId && result.imageId) {
                    // Find the location exit by searching through all locations
                    let foundExit = null;
                    for (const location of gameLocations.values()) {
                        const exits = location.exits; // This returns a Map copy
                        for (const exit of exits.values()) {
                            if (exit.id === job.payload.locationExitId) {
                                foundExit = exit;
                                break;
                            }
                        }
                        if (foundExit) break;
                    }

                    if (foundExit) {
                        foundExit.imageId = result.imageId;
                        console.log(`🚪 Updated location exit ${foundExit.id} imageId to: ${result.imageId}`);
                    }
                }
            }

        } catch (error) {
            clearTimeout(timeoutId);

            if (job.status !== JOB_STATUS.TIMEOUT) {
                job.status = JOB_STATUS.FAILED;
                job.error = error.message;
                job.message = `Generation failed: ${error.message}`;
                job.completedAt = new Date().toISOString();
            }
        }

    } finally {
        isProcessingJob = false;

        // Process next job if available
        setTimeout(() => processJobQueue(), 100);
    }
}

// Process a single image generation job
async function processImageGeneration(job) {
    const { prompt, width, height, seed, negative_prompt } = job.payload;

    // Generate unique image ID
    const imageId = generateImageId();

    // Prepare template variables
    const templateVars = {
        image: {
            prompt: prompt.trim(),
            width: width || config.imagegen.default_settings.image.width || 1024,
            height: height || config.imagegen.default_settings.image.height || 1024,
            seed: seed || config.imagegen.default_settings.image.seed || Math.floor(Math.random() * 1000000)
        },
        negative_prompt: negative_prompt || 'blurry, low quality, distorted'
    };

    job.progress = 20;
    job.message = 'Rendering workflow template...';

    // Render ComfyUI workflow template with error handling
    let workflowJson;
    try {
        workflowJson = await withRetry(() => {
            return imagePromptEnv.render(config.imagegen.api_template, templateVars);
        });
    } catch (error) {
        throw new Error(`Template rendering failed: ${error.message}`);
    }

    let workflow;
    try {
        workflow = JSON.parse(workflowJson);
    } catch (parseError) {
        throw new Error(`Invalid workflow JSON: ${parseError.message}`);
    }

    job.progress = 30;
    job.message = 'Submitting to ComfyUI...';

    // Queue the prompt with retry logic
    const queueResult = await withRetry(async () => {
        return await comfyUIClient.queuePrompt(workflow);
    });

    if (!queueResult.success) {
        throw new Error(`Failed to queue prompt: ${queueResult.error}`);
    }

    job.progress = 50;
    job.message = 'Waiting for generation to complete...';

    // Wait for completion with enhanced error handling
    const completionResult = await withRetry(async () => {
        return await comfyUIClient.waitForCompletion(queueResult.promptId);
    });

    if (!completionResult.success) {
        throw new Error(`Generation failed: ${completionResult.error}`);
    }

    job.progress = 80;
    job.message = 'Downloading and saving images...';

    // Download and save images with error handling
    const savedImages = [];
    const saveDirectory = path.join(__dirname, 'public', 'generated-images');

    // Ensure directory exists
    if (!fs.existsSync(saveDirectory)) {
        try {
            fs.mkdirSync(saveDirectory, { recursive: true });
        } catch (dirError) {
            throw new Error(`Failed to create images directory: ${dirError.message}`);
        }
    }

    for (const imageInfo of completionResult.images) {
        try {
            // Download image from ComfyUI with retry
            const imageData = await withRetry(async () => {
                return await comfyUIClient.getImage(
                    imageInfo.filename,
                    imageInfo.subfolder,
                    imageInfo.type
                );
            });

            // Save image with unique ID
            const saveResult = await comfyUIClient.saveImage(
                imageData,
                imageId,
                imageInfo.filename,
                saveDirectory
            );

            if (saveResult.success) {
                savedImages.push({
                    imageId: imageId,
                    filename: saveResult.filename,
                    url: `/generated-images/${saveResult.filename}`,
                    size: saveResult.size
                });
            }
        } catch (imageError) {
            console.error(`Failed to process image ${imageInfo.filename}:`, imageError.message);
            // Continue with other images rather than failing completely
        }
    }

    if (savedImages.length === 0) {
        throw new Error('No images were successfully saved');
    }

    // Store image metadata
    const imageMetadata = {
        id: imageId,
        prompt: templateVars.image.prompt,
        negative_prompt: templateVars.negative_prompt,
        width: templateVars.image.width,
        height: templateVars.image.height,
        seed: templateVars.image.seed,
        createdAt: new Date().toISOString(),
        comfyUIPromptId: queueResult.promptId,
        images: savedImages
    };

    generatedImages.set(imageId, imageMetadata);

    return {
        imageId: imageId,
        images: savedImages,
        metadata: imageMetadata
    };
}

// Configuration validation function
async function validateConfiguration() {
    const validationErrors = [];

    // Validate image generation configuration
    if (config.imagegen && config.imagegen.enabled) {
        console.log('🔍 Validating image generation configuration...');

        // Check required configuration fields
        if (!config.imagegen.server) {
            validationErrors.push('Image generation: server configuration missing');
        } else {
            if (!config.imagegen.server.host) {
                validationErrors.push('Image generation: server host not specified');
            }
            if (!config.imagegen.server.port) {
                validationErrors.push('Image generation: server port not specified');
            }
        }

        // Check template file exists
        if (!config.imagegen.api_template) {
            validationErrors.push('Image generation: api_template not specified');
        } else {
            const templatePath = path.join(__dirname, 'imagegen', config.imagegen.api_template);
            if (!fs.existsSync(templatePath)) {
                validationErrors.push(`Image generation: template file not found: ${templatePath}`);
            } else {
                console.log(`✅ Template file found: ${config.imagegen.api_template}`);
            }
        }

        // Validate default settings
        if (!config.imagegen.default_settings || !config.imagegen.default_settings.image) {
            validationErrors.push('Image generation: default_settings.image configuration missing');
        } else {
            const imageSettings = config.imagegen.default_settings.image;
            if (!imageSettings.width || imageSettings.width < 64 || imageSettings.width > 4096) {
                validationErrors.push('Image generation: invalid default width (must be 64-4096)');
            }
            if (!imageSettings.height || imageSettings.height < 64 || imageSettings.height > 4096) {
                validationErrors.push('Image generation: invalid default height (must be 64-4096)');
            }
            if (imageSettings.seed !== undefined && (imageSettings.seed < 0 || imageSettings.seed > 1000000)) {
                validationErrors.push('Image generation: invalid default seed (must be 0-1000000)');
            }
        }

        // Check if generated images directory exists, create if not
        const imagesDir = path.join(__dirname, 'public', 'generated-images');
        if (!fs.existsSync(imagesDir)) {
            try {
                fs.mkdirSync(imagesDir, { recursive: true });
                console.log(`✅ Created images directory: ${imagesDir}`);
            } catch (error) {
                validationErrors.push(`Image generation: failed to create images directory: ${error.message}`);
            }
        } else {
            console.log(`✅ Images directory exists: ${imagesDir}`);
        }
    }

    // Validate AI configuration
    if (!config.ai) {
        validationErrors.push('AI configuration missing');
    } else {
        if (!config.ai.endpoint) {
            validationErrors.push('AI endpoint not specified');
        }
        if (!config.ai.apiKey) {
            validationErrors.push('AI API key not specified');
        }
        if (!config.ai.model) {
            validationErrors.push('AI model not specified');
        }
    }

    // Report validation results
    if (validationErrors.length > 0) {
        console.error('❌ Configuration validation failed:');
        validationErrors.forEach(error => console.error(`   - ${error}`));
        return false;
    } else {
        console.log('✅ Configuration validation passed');
        return true;
    }
}

// Async function to initialize ComfyUI with connectivity test
async function initializeComfyUI() {
    if (!config.imagegen || !config.imagegen.enabled) {
        console.log('🎨 Image generation disabled in configuration');
        return true;
    }

    try {
        comfyUIClient = new ComfyUIClient(config);
        console.log(`🎨 ComfyUI client initialized for ${config.imagegen.server.host}:${config.imagegen.server.port}`);

        // Test connectivity to ComfyUI server
        console.log('🔌 Testing ComfyUI server connectivity...');
        const testResponse = await axios.get(`http://${config.imagegen.server.host}:${config.imagegen.server.port}/queue`, {
            timeout: 5000
        });

        if (testResponse.status === 200) {
            console.log('✅ ComfyUI server is accessible');
            return true;
        } else {
            console.log('⚠️  ComfyUI server returned unexpected status:', testResponse.status);
            return false;
        }

    } catch (error) {
        console.error('❌ ComfyUI server connectivity test failed:', error.message);
        console.log('💡 Image generation will be unavailable until ComfyUI server is running');
        return false;
    }
}

// In-memory chat history storage
let chatHistory = [];

// In-memory player storage (temporary - will be replaced with persistent storage later)
let currentPlayer = null;
const players = new Map(); // Store multiple players by ID

// In-memory game world storage
const gameLocations = new Map(); // Store Location instances by ID
const gameLocationExits = new Map(); // Store LocationExit instances by ID
const HOST = config.server.host;

// Configure Nunjucks for views
const viewsEnv = nunjucks.configure('views', {
    autoescape: true,
    express: app
});

// Configure Nunjucks for prompts (no autoescape for prompts)
const promptEnv = nunjucks.configure('prompts', {
    autoescape: false
});

// Configure Nunjucks for image generation templates (no autoescape)
const imagePromptEnv = nunjucks.configure('imagegen', {
    autoescape: false
});

// Import and add dice filters to both environments
const diceModule = require('./nunjucks_dice.js');

// Add dice filters to both environments
function addDiceFilters(env) {
    env.addFilter('roll', function (notation, seedOrOpts) {
        const opts = typeof seedOrOpts === 'string' ? { seed: seedOrOpts } : (seedOrOpts || {});
        return diceModule.rollDice(notation, opts).total;
    });

    env.addFilter('roll_detail', function (notation, seedOrOpts) {
        const opts = typeof seedOrOpts === 'string' ? { seed: seedOrOpts } : (seedOrOpts || {});
        return diceModule.rollDice(notation, opts).detail;
    });
}

addDiceFilters(viewsEnv);
addDiceFilters(promptEnv);
addDiceFilters(imagePromptEnv);

// Function to render system prompt from template
function renderSystemPrompt() {
    try {
        const templateName = config.gamemaster.promptTemplate;
        const variables = config.gamemaster.promptVariables || {};

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // Log rendered template for debugging
        console.log('Rendered system prompt template:\n', renderedTemplate);

        // If the template is a .yaml.njk file, parse the YAML and extract systemPrompt
        if (templateName.endsWith('.yaml.njk')) {
            const parsedYaml = yaml.load(renderedTemplate);
            return parsedYaml.systemPrompt || renderedTemplate;
        }

        // For regular .njk files, return the rendered content directly
        return renderedTemplate;
    } catch (error) {
        console.error('Error rendering prompt template:', error);
        // Fallback to default prompt
        return "You are a creative and engaging AI Game Master for a text-based RPG. Create immersive adventures, memorable characters, and respond to player actions with creativity and detail. Keep responses engaging but concise.";
    }
}

// Function to render player portrait prompt from template
function renderPlayerPortraitPrompt(player) {
    try {
        const templateName = 'player-portrait.yaml.njk';

        if (!player) {
            throw new Error('Player object is required');
        }

        const variables = {
            playerName: player.name,
            playerDescription: player.description,
            playerLevel: player.level,
            playerAttributes: player.getAttributeNames().reduce((attrs, name) => {
                attrs[name] = player.getAttribute(name);
                return attrs;
            }, {})
        };

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // Parse the YAML and extract imagePrompt
        const parsedYaml = yaml.load(renderedTemplate);
        const imagePrompt = parsedYaml.imagePrompt;

        if (!imagePrompt) {
            throw new Error('No imagePrompt found in player portrait template');
        }

        console.log(`Generated player portrait prompt for ${player.name}:`, imagePrompt);
        return imagePrompt.trim();

    } catch (error) {
        console.error('Error rendering player portrait template:', error);
        // Fallback to simple prompt
        return `Fantasy RPG character portrait of ${player ? player.name : 'unnamed character'}: ${player ? player.description : 'A mysterious adventurer'}, high quality fantasy art, detailed character portrait`;
    }
}

// Function to render location scene prompt from template
function renderLocationImagePrompt(location) {
    try {
        const templateName = 'location-image.yaml.njk';

        if (!location) {
            throw new Error('Location object is required');
        }

        const variables = {
            locationId: location.id,
            locationDescription: location.description,
            locationBaseLevel: location.baseLevel,
            locationExits: location.exits ? Object.fromEntries(location.exits) : {}
        };

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // Parse the YAML and extract imagePrompt
        const parsedYaml = yaml.load(renderedTemplate);
        const imagePrompt = parsedYaml.imagePrompt;

        if (!imagePrompt) {
            throw new Error('No imagePrompt found in location image template');
        }

        console.log(`Generated location scene prompt for ${location.id}:`, imagePrompt);
        return imagePrompt.trim();

    } catch (error) {
        console.error('Error rendering location image template:', error);
        // Fallback to simple prompt
        return `Fantasy RPG location scene: ${location ? location.description : 'A mysterious place'}, high quality fantasy environment art, detailed location scene`;
    }
}

// Function to render location exit image prompt from template
function renderLocationExitImagePrompt(locationExit) {
    try {
        const templateName = 'locationexit-image.yaml.njk';

        if (!locationExit) {
            throw new Error('LocationExit object is required');
        }

        const variables = {
            exitId: locationExit.id,
            exitDescription: locationExit.description,
            exitDestination: locationExit.destination,
            exitBidirectional: locationExit.bidirectional,
            exitType: locationExit.bidirectional ? 'two-way' : 'one-way'
        };

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // Parse the YAML and extract imagePrompt
        const parsedYaml = yaml.load(renderedTemplate);
        const imagePrompt = parsedYaml.imagePrompt;

        if (!imagePrompt) {
            throw new Error('No imagePrompt found in location exit image template');
        }

        console.log(`Generated location exit passage prompt for ${locationExit.id}:`, imagePrompt);
        return imagePrompt.trim();

    } catch (error) {
        console.error('Error rendering location exit image template:', error);
        // Fallback to simple prompt
        return `Fantasy RPG passage scene: ${locationExit ? locationExit.description : 'A mysterious passage'}, high quality fantasy pathway art, detailed exit passage`;
    }
}

// Function to generate player portrait image
async function generatePlayerImage(player) {
    try {
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping player portrait generation');
            return null;
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping player portrait generation');
            return null;
        }

        if (!player) {
            throw new Error('Player object is required');
        }

        // Generate the portrait prompt
        const portraitPrompt = renderPlayerPortraitPrompt(player);

        // Create image generation job with player-specific settings
        const jobId = generateImageId();
        const payload = {
            prompt: portraitPrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, distorted, multiple faces, deformed, ugly, bad anatomy, bad proportions',
            // Track which player this image is for
            playerId: player.id,
            isPlayerPortrait: true
        };

        console.log(`🎨 Generating portrait for player ${player.name} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Set imageId to the job ID temporarily - it will be updated to the final imageId when generation completes
        player.imageId = jobId;
        console.log(`🎨 Queued portrait generation for player ${player.name}, tracking with job ID: ${jobId}`);

        return {
            jobId: jobId,
            status: job.status,
            message: 'Player portrait generation job queued',
            estimatedTime: '30-90 seconds'
        };

    } catch (error) {
        console.error('Error generating player image:', error);
        throw error;
    }
}

// Function to generate location scene image
async function generateLocationImage(location) {
    try {
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping location scene generation');
            return null;
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping location scene generation');
            return null;
        }

        if (!location) {
            throw new Error('Location object is required');
        }

        // Generate the location scene prompt
        const scenePrompt = renderLocationImagePrompt(location);

        // Create image generation job with location-specific settings
        const jobId = generateImageId();
        const payload = {
            prompt: scenePrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, modern elements, cars, technology, people, characters, portraits, indoor scenes only',
            // Track which location this image is for
            locationId: location.id,
            isLocationScene: true
        };

        console.log(`🏞️ Generating scene for location ${location.id} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Set imageId to the job ID temporarily - it will be updated to the final imageId when generation completes
        location.imageId = jobId;
        console.log(`🏞️ Queued scene generation for location ${location.id}, tracking with job ID: ${jobId}`);

        return {
            jobId: jobId,
            status: job.status,
            message: 'Location scene generation job queued',
            estimatedTime: '30-90 seconds'
        };

    } catch (error) {
        console.error('Error generating location image:', error);
        throw error;
    }
}

// Function to generate location exit passage image
async function generateLocationExitImage(locationExit) {
    try {
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping location exit passage generation');
            return null;
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping location exit passage generation');
            return null;
        }

        if (!locationExit) {
            throw new Error('LocationExit object is required');
        }

        // Generate the location exit passage prompt
        const passagePrompt = renderLocationExitImagePrompt(locationExit);

        // Create image generation job with location exit-specific settings
        const jobId = generateImageId();
        const payload = {
            prompt: passagePrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, modern elements, cars, technology, people, characters, blocked passages',
            // Track which location exit this image is for
            locationExitId: locationExit.id,
            isLocationExitImage: true
        };

        console.log(`🚪 Generating passage for location exit ${locationExit.id} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Set imageId to the job ID temporarily - it will be updated to the final imageId when generation completes
        locationExit.imageId = jobId;
        console.log(`🚪 Queued passage generation for location exit ${locationExit.id}, tracking with job ID: ${jobId}`);

        return {
            jobId: jobId,
            status: job.status,
            message: 'Location exit passage generation job queued',
            estimatedTime: '30-90 seconds'
        };

    } catch (error) {
        console.error('Error generating location exit image:', error);
        throw error;
    }
}

// Debounced function to generate player portrait image
function generatePlayerImageDebounced(player) {
    if (!player || !player.id) {
        console.warn('Cannot debounce image generation: invalid player');
        return;
    }

    // Clear existing timeout for this player
    const existingTimeout = playerImageRegenerationTimeouts.get(player.id);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
        try {
            console.log(`🔄 Debounced image regeneration executing for player ${player.name}...`);
            const imageResult = await generatePlayerImage(player);
            console.log(`🎨 Debounced portrait regeneration initiated:`, imageResult);
        } catch (error) {
            console.error('Error in debounced player image generation:', error);
        } finally {
            // Clean up timeout tracking
            playerImageRegenerationTimeouts.delete(player.id);
        }
    }, IMAGE_REGENERATION_DEBOUNCE_MS);

    playerImageRegenerationTimeouts.set(player.id, timeoutId);
    console.log(`⏱️  Debounced image regeneration scheduled for player ${player.name} in ${IMAGE_REGENERATION_DEBOUNCE_MS}ms`);
}

// Debounced function to generate location scene image
function generateLocationImageDebounced(location) {
    if (!location || !location.id) {
        console.warn('Cannot debounce image generation: invalid location');
        return;
    }

    // Clear existing timeout for this location
    const existingTimeout = locationImageRegenerationTimeouts.get(location.id);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
        try {
            console.log(`🔄 Debounced scene regeneration executing for location ${location.id}...`);
            const imageResult = await generateLocationImage(location);
            console.log(`🏞️ Debounced scene regeneration initiated:`, imageResult);
        } catch (error) {
            console.error('Error in debounced location image generation:', error);
        } finally {
            // Clean up timeout tracking
            locationImageRegenerationTimeouts.delete(location.id);
        }
    }, IMAGE_REGENERATION_DEBOUNCE_MS);

    locationImageRegenerationTimeouts.set(location.id, timeoutId);
    console.log(`⏱️  Debounced scene regeneration scheduled for location ${location.id} in ${IMAGE_REGENERATION_DEBOUNCE_MS}ms`);
}

// Debounced function to generate location exit passage image
function generateLocationExitImageDebounced(locationExit) {
    if (!locationExit || !locationExit.id) {
        console.warn('Cannot debounce image generation: invalid location exit');
        return;
    }

    // Clear existing timeout for this location exit
    const existingTimeout = locationExitImageRegenerationTimeouts.get(locationExit.id);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeoutId = setTimeout(async () => {
        try {
            console.log(`🔄 Debounced passage regeneration executing for location exit ${locationExit.id}...`);
            const imageResult = await generateLocationExitImage(locationExit);
            console.log(`🚪 Debounced passage regeneration initiated:`, imageResult);
        } catch (error) {
            console.error('Error in debounced location exit image generation:', error);
        } finally {
            // Clean up timeout tracking
            locationExitImageRegenerationTimeouts.delete(locationExit.id);
        }
    }, IMAGE_REGENERATION_DEBOUNCE_MS);

    locationExitImageRegenerationTimeouts.set(locationExit.id, timeoutId);
    console.log(`⏱️  Debounced passage regeneration scheduled for location exit ${locationExit.id} in ${IMAGE_REGENERATION_DEBOUNCE_MS}ms`);
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Route for AI RPG Chat Interface
app.get('/', (req, res) => {
    const systemPrompt = renderSystemPrompt();
    res.render('index.njk', {
        title: 'AI RPG Chat Interface',
        systemPrompt: systemPrompt,
        chatHistory: chatHistory,
        currentPage: 'chat'
    });
});

// Configuration page routes
app.get('/config', (req, res) => {
    res.render('config.njk', {
        title: 'AI RPG Configuration',
        config: config,
        currentPage: 'config'
    });
});

app.post('/config', (req, res) => {
    try {
        // Update configuration with form data
        const updatedConfig = { ...config };

        // Parse nested form data (e.g., "server.host" -> config.server.host)
        for (const [key, value] of Object.entries(req.body)) {
            const keys = key.split('.');
            let current = updatedConfig;

            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }

            // Convert numeric values
            const finalKey = keys[keys.length - 1];
            if (finalKey === 'port' || finalKey === 'maxTokens') {
                current[finalKey] = parseInt(value);
            } else if (finalKey === 'temperature') {
                current[finalKey] = parseFloat(value);
            } else {
                current[finalKey] = value;
            }
        }

        // Save to config.yaml file
        const yamlString = yaml.dump(updatedConfig, {
            defaultFlowStyle: false,
            quotingType: '"',
            forceQuotes: false
        });

        fs.writeFileSync(path.join(__dirname, 'config.yaml'), yamlString, 'utf8');

        // Update in-memory config
        config = updatedConfig;

        res.json({
            success: true,
            message: 'Configuration saved successfully! Restart the server for all changes to take effect.'
        });

    } catch (error) {
        console.error('Error saving configuration:', error);
        res.status(500).json({
            success: false,
            message: `Error saving configuration: ${error.message}`
        });
    }
});

// Chat API endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!messages) {
            return res.status(400).json({ error: 'Missing messages parameter' });
        }

        // Store user message in history (last message from the request)
        const userMessage = messages[messages.length - 1];
        if (userMessage && userMessage.role === 'user') {
            chatHistory.push({
                role: 'user',
                content: userMessage.content,
                timestamp: new Date().toISOString()
            });
        }

        let finalMessages = messages;
        let debugInfo = null;

        // If we have a current player, use the player action template for the system message
        if (currentPlayer && userMessage && userMessage.role === 'user') {
            try {
                // Render the player action template
                const playerActionPrompt = promptEnv.render('player-action.yaml.njk', {
                    player: currentPlayer.getStatus(),
                    actionText: userMessage.content
                });

                // Parse the rendered YAML
                const promptData = yaml.load(playerActionPrompt);

                // Create system message from the template
                const systemMessage = {
                    role: 'system',
                    content: promptData.systemPrompt + '\\n\\nPlayer Context:\\n' +
                        JSON.stringify(promptData.player, null, 2) +
                        '\\n\\nAction: ' + promptData.action +
                        '\\n\\nGuidelines:\\n' + promptData.guidelines.join('\\n') +
                        (promptData.context ? '\\n\\nContext: ' + promptData.context : '')
                };

                // Replace any existing system message or add new one
                finalMessages = [systemMessage, ...messages.filter(msg => msg.role !== 'system')];

                // Store debug information
                debugInfo = {
                    usedPlayerTemplate: true,
                    playerName: currentPlayer.name,
                    playerDescription: currentPlayer.description,
                    systemMessage: systemMessage.content,
                    rawTemplate: playerActionPrompt
                };

                console.log('Using player action template for:', currentPlayer.name);
            } catch (templateError) {
                console.error('Error rendering player action template:', templateError);
                // Fall back to original messages if template fails
                finalMessages = messages;
                debugInfo = {
                    usedPlayerTemplate: false,
                    error: templateError.message
                };
            }
        } else {
            debugInfo = {
                usedPlayerTemplate: false,
                reason: currentPlayer ? 'No user message detected' : 'No current player set'
            };
        }

        // Use configuration from config.yaml
        const endpoint = config.ai.endpoint;
        const apiKey = config.ai.apiKey;
        const model = config.ai.model;

        // Prepare the request to the OpenAI-compatible API
        const chatEndpoint = endpoint.endsWith('/') ?
            endpoint + 'chat/completions' :
            endpoint + '/chat/completions';

        const requestData = {
            model: model,
            messages: finalMessages,
            max_tokens: config.ai.maxTokens || 1000,
            temperature: config.ai.temperature || 0.7
        };

        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            const aiResponse = response.data.choices[0].message.content;

            // Store AI response in history
            chatHistory.push({
                role: 'assistant',
                content: aiResponse,
                timestamp: new Date().toISOString()
            });

            // Include debug information in response for development
            const responseData = {
                response: aiResponse
            };

            // Add debug info if available
            if (debugInfo) {
                responseData.debug = debugInfo;
            }

            res.json(responseData);
        } else {
            res.status(500).json({ error: 'Invalid response from AI API' });
        }

    } catch (error) {
        console.error('Chat API error:', error);

        if (error.response) {
            // API returned an error
            const statusCode = error.response.status;
            const errorMessage = error.response.data?.error?.message || 'API request failed';
            res.status(statusCode).json({ error: `API Error (${statusCode}): ${errorMessage}` });
        } else if (error.code === 'ECONNABORTED') {
            // Timeout
            res.status(408).json({ error: 'Request timeout - AI API took too long to respond' });
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            // Connection issues
            res.status(503).json({ error: 'Cannot connect to AI API - check your endpoint URL' });
        } else {
            // Other errors
            res.status(500).json({ error: `Request failed: ${error.message}` });
        }
    }
});

// Chat history API endpoint
app.get('/api/chat/history', (req, res) => {
    res.json({
        history: chatHistory,
        count: chatHistory.length
    });
});

// Clear chat history API endpoint (for testing/reset)
app.delete('/api/chat/history', (req, res) => {
    chatHistory = [];
    res.json({
        message: 'Chat history cleared',
        count: chatHistory.length
    });
});

// Player management API endpoints

// Create a new player
app.post('/api/player', async (req, res) => {
    try {
        const { name, attributes, level } = req.body;

        const player = new Player({
            name: name || 'New Player',
            attributes: attributes || {},
            level: level || 1
        });

        players.set(player.id, player);
        currentPlayer = player;

        // Automatically generate player portrait if image generation is enabled
        try {
            const imageResult = await generatePlayerImage(player);
            console.log(`🎨 Player portrait generation initiated for ${player.name}:`, imageResult);
        } catch (imageError) {
            console.warn('Failed to generate player portrait:', imageError.message);
            // Don't fail player creation if image generation fails
        }

        res.json({
            success: true,
            player: player.getStatus(),
            message: 'Player created successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get current player status
app.get('/api/player', (req, res) => {
    if (!currentPlayer) {
        return res.status(404).json({
            success: false,
            error: 'No current player found'
        });
    }

    res.json({
        success: true,
        player: currentPlayer.getStatus()
    });
});

// Update player attributes
app.put('/api/player/attributes', (req, res) => {
    if (!currentPlayer) {
        return res.status(404).json({
            success: false,
            error: 'No current player found'
        });
    }

    try {
        const { attributes } = req.body;

        for (const [attrName, value] of Object.entries(attributes || {})) {
            currentPlayer.setAttribute(attrName, value);
        }

        res.json({
            success: true,
            player: currentPlayer.getStatus(),
            message: 'Attributes updated successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Modify player health
app.put('/api/player/health', (req, res) => {
    if (!currentPlayer) {
        return res.status(404).json({
            success: false,
            error: 'No current player found'
        });
    }

    try {
        const { amount, reason } = req.body;

        if (typeof amount !== 'number') {
            throw new Error('Health amount must be a number');
        }

        const result = currentPlayer.modifyHealth(amount, reason || '');

        res.json({
            success: true,
            healthChange: result,
            player: currentPlayer.getStatus(),
            message: `Health ${amount > 0 ? 'increased' : 'decreased'} by ${Math.abs(amount)}`
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Level up player
app.post('/api/player/levelup', (req, res) => {
    if (!currentPlayer) {
        return res.status(404).json({
            success: false,
            error: 'No current player found'
        });
    }

    try {
        const oldLevel = currentPlayer.level;
        currentPlayer.levelUp();

        res.json({
            success: true,
            player: currentPlayer.getStatus(),
            message: `Player leveled up from ${oldLevel} to ${currentPlayer.level}!`
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get all players (for future multi-player support)
app.get('/api/players', (req, res) => {
    const playerList = Array.from(players.values()).map(player => player.getStatus());

    res.json({
        success: true,
        players: playerList,
        count: playerList.length,
        currentPlayer: currentPlayer ? currentPlayer.id : null
    });
});

// Set current player
app.post('/api/player/set-current', (req, res) => {
    try {
        const { playerId } = req.body;

        if (!playerId) {
            return res.status(400).json({
                success: false,
                error: 'Player ID is required'
            });
        }

        const player = players.get(playerId);
        if (!player) {
            return res.status(404).json({
                success: false,
                error: `Player with ID '${playerId}' not found`
            });
        }

        currentPlayer = player;

        res.json({
            success: true,
            currentPlayer: currentPlayer.getStatus(),
            message: `Current player set to: ${currentPlayer.name}`
        });
    } catch (error) {
        console.error('Error setting current player:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get attribute definitions
app.get('/api/attributes', (req, res) => {
    if (!currentPlayer) {
        // Create a temporary player to get definitions
        const tempPlayer = new Player();
        res.json({
            success: true,
            attributes: tempPlayer.attributeDefinitions,
            generationMethods: tempPlayer.getGenerationMethods(),
            systemConfig: tempPlayer.systemConfig
        });
    } else {
        res.json({
            success: true,
            attributes: currentPlayer.attributeDefinitions,
            generationMethods: currentPlayer.getGenerationMethods(),
            systemConfig: currentPlayer.systemConfig
        });
    }
});

// Generate new attributes for current player
app.post('/api/player/generate-attributes', (req, res) => {
    if (!currentPlayer) {
        return res.status(404).json({
            success: false,
            error: 'No current player found'
        });
    }

    try {
        const { method } = req.body;
        const availableMethods = Object.keys(currentPlayer.getGenerationMethods());

        if (method && !availableMethods.includes(method)) {
            return res.status(400).json({
                success: false,
                error: `Invalid generation method. Available: ${availableMethods.join(', ')}`
            });
        }

        const diceModule = require('./nunjucks_dice.js');
        const newAttributes = currentPlayer.generateAttributes(method || 'standard', diceModule);

        res.json({
            success: true,
            player: currentPlayer.getStatus(),
            generatedAttributes: newAttributes,
            method: method || 'standard',
            message: `Attributes generated using ${method || 'standard'} method`
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Player Stats Configuration Routes

// Get player stats page
app.get('/player-stats', (req, res) => {
    res.render('player-stats.njk', {
        title: 'Player Stats Configuration',
        player: currentPlayer ? currentPlayer.getStatus() : null,
        currentPage: 'player-stats'
    });
});

// Debug page - shows current player information
app.get('/debug', (req, res) => {
    // Collect all players data
    const allPlayersData = {};
    for (const [playerId, player] of players) {
        allPlayersData[playerId] = player.toJSON();
    }

    // Load locations from defs/locations.yaml if it exists
    let locationsData = {};
    try {
        const locationsPath = path.join(__dirname, 'defs', 'locations.yaml');
        if (fs.existsSync(locationsPath)) {
            const locationsFile = fs.readFileSync(locationsPath, 'utf8');
            if (locationsFile.trim()) {
                locationsData = yaml.load(locationsFile) || {};
            }
        }
    } catch (error) {
        console.error('Error loading locations data:', error.message);
        locationsData = { error: 'Failed to load locations data' };
    }

    // Convert game world Maps to objects for display
    const gameWorldData = {
        locations: Object.fromEntries(
            Array.from(gameLocations.entries()).map(([id, location]) => [id, location.toJSON()])
        ),
        locationExits: Object.fromEntries(
            Array.from(gameLocationExits.entries()).map(([id, exit]) => [id, exit.toJSON()])
        )
    };

    const debugData = {
        title: 'Debug: Player Information',
        player: currentPlayer ? currentPlayer.getStatus() : null,
        playerStatus: currentPlayer ? currentPlayer.getStatus() : null,
        playerJson: currentPlayer ? currentPlayer.toJSON() : null,
        totalPlayers: players.size,
        currentPlayerId: currentPlayer ? currentPlayer.toJSON().id : null,
        allPlayers: allPlayersData,
        allLocations: locationsData, // YAML-loaded locations for reference
        gameWorld: gameWorldData, // In-memory game world data
        gameWorldCounts: {
            locations: gameLocations.size,
            locationExits: gameLocationExits.size
        },
        currentPage: 'debug'
    };

    res.render('debug.njk', debugData);
});

// Update player stats
app.post('/api/player/update-stats', (req, res) => {
    try {
        const { name, description, level, health, maxHealth, attributes } = req.body;

        if (!currentPlayer) {
            return res.status(404).json({
                success: false,
                error: 'No current player found. Please create a player first.'
            });
        }

        // Track if description changed for image regeneration
        const originalDescription = currentPlayer.description;
        let descriptionChanged = false;

        // Update basic information
        if (name && name.trim()) {
            currentPlayer.setName(name.trim());
        }

        if (description !== undefined) {
            const newDescription = description.trim();
            if (originalDescription !== newDescription) {
                descriptionChanged = true;
            }
            currentPlayer.setDescription(newDescription);
        }

        if (level && !isNaN(level) && level >= 1 && level <= 20) {
            currentPlayer.setLevel(parseInt(level));
        }

        if (health !== undefined && !isNaN(health) && health >= 0) {
            currentPlayer.setHealth(parseInt(health));
        }

        if (maxHealth && !isNaN(maxHealth) && maxHealth >= 1) {
            currentPlayer.setMaxHealth(parseInt(maxHealth));
        }

        // Update attributes
        if (attributes && typeof attributes === 'object') {
            for (const [attrName, value] of Object.entries(attributes)) {
                if (!isNaN(value) && value >= 3 && value <= 18) {
                    currentPlayer.setAttribute(attrName, parseInt(value));
                }
            }
        }

        // Trigger image regeneration if description changed
        if (descriptionChanged) {
            generatePlayerImageDebounced(currentPlayer);
        }

        res.json({
            success: true,
            player: currentPlayer.getStatus(),
            message: 'Player stats updated successfully'
        });

    } catch (error) {
        console.error('Error updating player stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create new player from stats form
app.post('/api/player/create-from-stats', async (req, res) => {
    try {
        const { name, description, level, health, maxHealth, attributes } = req.body;

        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Player name is required'
            });
        }

        // Create player data object
        const playerData = {
            name: name.trim(),
            description: description ? description.trim() : '',
            level: level && !isNaN(level) ? Math.max(1, Math.min(20, parseInt(level))) : 1,
            health: health && !isNaN(health) ? Math.max(1, parseInt(health)) : 25,
            maxHealth: maxHealth && !isNaN(maxHealth) ? Math.max(1, parseInt(maxHealth)) : 25,
            attributes: {}
        };

        // Process attributes
        if (attributes && typeof attributes === 'object') {
            for (const [attrName, value] of Object.entries(attributes)) {
                if (!isNaN(value)) {
                    playerData.attributes[attrName] = Math.max(3, Math.min(18, parseInt(value)));
                }
            }
        }

        // Create the player
        const player = new Player(playerData);
        players.set(player.id, player);
        currentPlayer = player;

        // Automatically generate player portrait if image generation is enabled
        try {
            const imageResult = await generatePlayerImage(player);
            console.log(`🎨 Player portrait generation initiated for ${player.name}:`, imageResult);
        } catch (imageError) {
            console.warn('Failed to generate player portrait:', imageError.message);
            // Don't fail player creation if image generation fails
        }

        res.json({
            success: true,
            player: player.getStatus(),
            message: 'Player created successfully from stats'
        });

    } catch (error) {
        console.error('Error creating player from stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generate player portrait manually
app.post('/api/players/:id/portrait', async (req, res) => {
    try {
        const playerId = req.params.id;

        // Find the player by ID
        const player = players.get(playerId);
        if (!player) {
            return res.status(404).json({
                success: false,
                error: `Player with ID '${playerId}' not found`
            });
        }

        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            return res.status(503).json({
                success: false,
                error: 'Image generation is not enabled'
            });
        }

        if (!comfyUIClient) {
            return res.status(503).json({
                success: false,
                error: 'ComfyUI client not initialized or unavailable'
            });
        }

        // Generate the portrait
        const imageResult = await generatePlayerImage(player);

        res.json({
            success: true,
            player: {
                id: player.id,
                name: player.name,
                imageId: player.imageId
            },
            imageGeneration: imageResult,
            message: `Portrait regeneration initiated for ${player.name}`
        });

    } catch (error) {
        console.error('Error generating player portrait:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== SAVE/LOAD FUNCTIONALITY ====================

// Save current game state
app.post('/api/save', (req, res) => {
    try {
        if (!currentPlayer) {
            return res.status(400).json({
                success: false,
                error: 'No current player to save'
            });
        }

        // Create save directory name with timestamp and player name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const playerName = currentPlayer.name.replace(/[^a-zA-Z0-9]/g, '_');
        const saveName = `${timestamp}_${playerName}`;
        const saveDir = path.join(__dirname, 'saves', saveName);

        // Create save directory
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        // Save game world data (locations and exits)
        const gameWorldData = {
            locations: Object.fromEntries(
                Array.from(gameLocations.entries()).map(([id, location]) => [id, location.toJSON()])
            ),
            locationExits: Object.fromEntries(
                Array.from(gameLocationExits.entries()).map(([id, exit]) => [id, exit.toJSON()])
            )
        };
        fs.writeFileSync(
            path.join(saveDir, 'gameWorld.json'),
            JSON.stringify(gameWorldData, null, 2)
        );

        // Save chat history
        fs.writeFileSync(
            path.join(saveDir, 'chatHistory.json'),
            JSON.stringify(chatHistory, null, 2)
        );

        // Save generated images metadata
        const imagesData = Object.fromEntries(generatedImages);
        fs.writeFileSync(
            path.join(saveDir, 'images.json'),
            JSON.stringify(imagesData, null, 2)
        );

        // Save all players data
        const allPlayersData = Object.fromEntries(
            Array.from(players.entries()).map(([id, player]) => [id, player.toJSON()])
        );
        fs.writeFileSync(
            path.join(saveDir, 'allPlayers.json'),
            JSON.stringify(allPlayersData, null, 2)
        );

        // Save metadata about the save
        const metadata = {
            saveName: saveName,
            timestamp: new Date().toISOString(),
            playerName: currentPlayer.name,
            playerId: currentPlayer.toJSON().id,
            playerLevel: currentPlayer.level,
            gameVersion: '1.0.0',
            chatHistoryLength: chatHistory.length,
            totalPlayers: players.size,
            totalLocations: gameLocations.size,
            totalLocationExits: gameLocationExits.size,
            totalGeneratedImages: generatedImages.size
        };
        fs.writeFileSync(
            path.join(saveDir, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );

        res.json({
            success: true,
            saveName: saveName,
            saveDir: saveDir,
            metadata: metadata,
            message: `Game saved successfully as: ${saveName}`
        });

    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Load game state from a save
app.post('/api/load', (req, res) => {
    try {
        const { saveName } = req.body;

        if (!saveName) {
            return res.status(400).json({
                success: false,
                error: 'Save name is required'
            });
        }

        const saveDir = path.join(__dirname, 'saves', saveName);

        // Check if save directory exists
        if (!fs.existsSync(saveDir)) {
            return res.status(404).json({
                success: false,
                error: `Save '${saveName}' not found`
            });
        }

        // Load metadata
        const metadataPath = path.join(saveDir, 'metadata.json');
        let metadata = {};
        if (fs.existsSync(metadataPath)) {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        }

        // Load all players first
        const allPlayersPath = path.join(saveDir, 'allPlayers.json');
        if (fs.existsSync(allPlayersPath)) {
            players.clear();
            const allPlayersData = JSON.parse(fs.readFileSync(allPlayersPath, 'utf8')) || {};
            for (const [id, playerData] of Object.entries(allPlayersData)) {
                const player = Player.fromJSON(playerData);
                players.set(id, player);
            }
        }

        // Set current player from metadata
        if (metadata.playerId && players.has(metadata.playerId)) {
            currentPlayer = players.get(metadata.playerId);
        } else {
            currentPlayer = null;
        }

        // Load game world data
        const gameWorldPath = path.join(saveDir, 'gameWorld.json');
        if (fs.existsSync(gameWorldPath)) {
            const gameWorldData = JSON.parse(fs.readFileSync(gameWorldPath, 'utf8'));

            // Clear existing game world
            gameLocations.clear();
            gameLocationExits.clear();

            // Recreate Location instances
            for (const [id, locationData] of Object.entries(gameWorldData.locations || {})) {
                const location = new Location({
                    description: locationData.description,
                    baseLevel: locationData.baseLevel,
                    id: locationData.id
                });
                gameLocations.set(id, location);
            }

            // Recreate LocationExit instances
            for (const [id, exitData] of Object.entries(gameWorldData.locationExits || {})) {
                const exit = new LocationExit({
                    description: exitData.description,
                    destination: exitData.destination,
                    bidirectional: exitData.bidirectional,
                    id: exitData.id
                });
                gameLocationExits.set(id, exit);
            }
        }

        // Load chat history
        const chatHistoryPath = path.join(saveDir, 'chatHistory.json');
        if (fs.existsSync(chatHistoryPath)) {
            chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf8')) || [];
        }

        // Load generated images
        const imagesPath = path.join(saveDir, 'images.json');
        if (fs.existsSync(imagesPath)) {
            generatedImages.clear();
            const imagesData = JSON.parse(fs.readFileSync(imagesPath, 'utf8')) || {};
            for (const [id, imageData] of Object.entries(imagesData)) {
                generatedImages.set(id, imageData);
            }
        }

        res.json({
            success: true,
            saveName: saveName,
            metadata: metadata,
            loadedData: {
                currentPlayer: currentPlayer ? currentPlayer.getStatus() : null,
                totalPlayers: players.size,
                totalLocations: gameLocations.size,
                totalLocationExits: gameLocationExits.size,
                chatHistoryLength: chatHistory.length,
                totalGeneratedImages: generatedImages.size
            },
            message: `Game loaded successfully from: ${saveName}`
        });

    } catch (error) {
        console.error('Error loading game:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// List available saves
app.get('/api/saves', (req, res) => {
    try {
        const savesDir = path.join(__dirname, 'saves');

        if (!fs.existsSync(savesDir)) {
            return res.json({
                success: true,
                saves: [],
                message: 'No saves directory found'
            });
        }

        const saveDirectories = fs.readdirSync(savesDir)
            .filter(item => {
                const itemPath = path.join(savesDir, item);
                return fs.statSync(itemPath).isDirectory();
            });

        const saves = saveDirectories.map(saveName => {
            const saveDir = path.join(savesDir, saveName);
            const metadataPath = path.join(saveDir, 'metadata.json');

            let metadata = {
                saveName: saveName,
                timestamp: 'Unknown',
                playerName: 'Unknown',
                playerLevel: 'Unknown'
            };

            if (fs.existsSync(metadataPath)) {
                try {
                    const metadataContent = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                    metadata = { ...metadata, ...metadataContent };
                } catch (error) {
                    console.error(`Error reading metadata for save ${saveName}:`, error);
                }
            }

            return metadata;
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by newest first

        res.json({
            success: true,
            saves: saves,
            count: saves.length,
            message: `Found ${saves.length} save(s)`
        });

    } catch (error) {
        console.error('Error listing saves:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a save
app.delete('/api/save/:saveName', (req, res) => {
    try {
        const { saveName } = req.params;
        const saveDir = path.join(__dirname, 'saves', saveName);

        if (!fs.existsSync(saveDir)) {
            return res.status(404).json({
                success: false,
                error: `Save '${saveName}' not found`
            });
        }

        // Remove the save directory and all its contents
        fs.rmSync(saveDir, { recursive: true, force: true });

        res.json({
            success: true,
            saveName: saveName,
            message: `Save '${saveName}' deleted successfully`
        });

    } catch (error) {
        console.error('Error deleting save:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Additional API endpoint for JSON response
app.get('/api/hello', (req, res) => {
    res.json({
        message: 'Hello World!',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// API endpoint to test configuration without saving
app.post('/api/test-config', async (req, res) => {
    try {
        const { endpoint, apiKey, model } = req.body;

        if (!endpoint || !apiKey || !model) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Test the configuration by making a simple request
        const chatEndpoint = endpoint.endsWith('/') ?
            endpoint + 'chat/completions' :
            endpoint + '/chat/completions';

        const requestData = {
            model: model,
            messages: [{ role: 'user', content: 'Hello, this is a test.' }],
            max_tokens: 50,
            temperature: 0.7
        };

        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout for test
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            res.json({ success: true, message: 'Configuration test successful' });
        } else {
            res.status(500).json({ error: 'Invalid response from AI API' });
        }

    } catch (error) {
        console.error('Config test error:', error);

        if (error.response) {
            const statusCode = error.response.status;
            const errorMessage = error.response.data?.error?.message || 'API request failed';
            res.status(statusCode).json({ error: `API Error (${statusCode}): ${errorMessage}` });
        } else if (error.code === 'ECONNABORTED') {
            res.status(408).json({ error: 'Request timeout' });
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            res.status(503).json({ error: 'Cannot connect to API endpoint' });
        } else {
            res.status(500).json({ error: `Test failed: ${error.message}` });
        }
    }
});

// Image generation functionality
function generateImageId() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/T/, '_').replace(/\..+/, '');
    const random = Math.random().toString(36).substr(2, 8);
    return `img_${timestamp}_${random}`;
}

// API endpoint for async image generation
app.post('/api/generate-image', async (req, res) => {
    try {
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            return res.status(503).json({
                success: false,
                error: 'Image generation is not enabled'
            });
        }

        if (!comfyUIClient) {
            return res.status(503).json({
                success: false,
                error: 'ComfyUI client not initialized or unavailable'
            });
        }

        const { prompt, width, height, seed, negative_prompt, async: isAsync } = req.body;

        // Enhanced parameter validation
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required and must be a non-empty string'
            });
        }

        if (prompt.trim().length > 1000) {
            return res.status(400).json({
                success: false,
                error: 'Prompt must be less than 1000 characters'
            });
        }

        // Validate dimensions
        const validatedWidth = width ? parseInt(width) : config.imagegen.default_settings.image.width || 1024;
        const validatedHeight = height ? parseInt(height) : config.imagegen.default_settings.image.height || 1024;

        if (validatedWidth < 64 || validatedWidth > 4096 || validatedHeight < 64 || validatedHeight > 4096) {
            return res.status(400).json({
                success: false,
                error: 'Image dimensions must be between 64 and 4096 pixels'
            });
        }

        // Validate seed
        const validatedSeed = seed !== undefined ? parseInt(seed) : Math.floor(Math.random() * 1000000);
        if (validatedSeed < 0 || validatedSeed > 1000000) {
            return res.status(400).json({
                success: false,
                error: 'Seed must be between 0 and 1000000'
            });
        }

        const jobId = generateImageId();
        const payload = {
            prompt: prompt.trim(),
            width: validatedWidth,
            height: validatedHeight,
            seed: validatedSeed,
            negative_prompt: negative_prompt || 'blurry, low quality, distorted'
        };

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Return job ID for async tracking, or wait for completion if sync
        if (isAsync !== false) {
            return res.json({
                success: true,
                jobId: jobId,
                status: job.status,
                message: 'Image generation job queued. Use /api/jobs/:jobId to track progress.',
                estimatedTime: '30-90 seconds'
            });
        } else {
            // Legacy sync mode - wait for completion
            return new Promise((resolve) => {
                const checkJob = () => {
                    const currentJob = imageJobs.get(jobId);

                    if (currentJob.status === JOB_STATUS.COMPLETED) {
                        resolve(res.json({
                            success: true,
                            imageId: currentJob.result.imageId,
                            images: currentJob.result.images,
                            metadata: currentJob.result.metadata,
                            processingTime: new Date(currentJob.completedAt) - new Date(currentJob.createdAt)
                        }));
                    } else if (currentJob.status === JOB_STATUS.FAILED || currentJob.status === JOB_STATUS.TIMEOUT) {
                        resolve(res.status(500).json({
                            success: false,
                            error: currentJob.error || 'Image generation failed'
                        }));
                    } else {
                        setTimeout(checkJob, 1000);
                    }
                };

                checkJob();
            });
        }

    } catch (error) {
        console.error('Image generation request error:', error.message);
        return res.status(500).json({
            success: false,
            error: `Request failed: ${error.message}`
        });
    }
});

// API endpoint for job status tracking
app.get('/api/jobs/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = imageJobs.get(jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Job not found'
        });
    }

    const response = {
        success: true,
        job: {
            id: job.id,
            status: job.status,
            progress: job.progress,
            message: job.message,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt
        }
    };

    // Include result if completed
    if (job.status === JOB_STATUS.COMPLETED && job.result) {
        response.result = {
            imageId: job.result.imageId,
            images: job.result.images,
            metadata: job.result.metadata
        };
    }

    // Include error if failed
    if (job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
        response.error = job.error;
    }

    res.json(response);
});

// API endpoint to cancel a job
app.delete('/api/jobs/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = imageJobs.get(jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Job not found'
        });
    }

    if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
        return res.status(400).json({
            success: false,
            error: 'Cannot cancel completed job'
        });
    }

    // Remove from queue if queued
    const queueIndex = jobQueue.indexOf(jobId);
    if (queueIndex > -1) {
        jobQueue.splice(queueIndex, 1);
    }

    // Mark as failed
    job.status = JOB_STATUS.FAILED;
    job.error = 'Job cancelled by user';
    job.completedAt = new Date().toISOString();

    res.json({
        success: true,
        message: 'Job cancelled successfully'
    });
});

// API endpoint to list all jobs
app.get('/api/jobs', (req, res) => {
    const jobs = Array.from(imageJobs.values()).map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        prompt: job.payload.prompt.substring(0, 50) + (job.payload.prompt.length > 50 ? '...' : '')
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
        success: true,
        jobs: jobs,
        queue: {
            pending: jobQueue.length,
            processing: isProcessingJob ? 1 : 0
        }
    });
});

// API endpoint to get image metadata
app.get('/api/images/:imageId', (req, res) => {
    const imageId = req.params.imageId;
    const metadata = generatedImages.get(imageId);

    if (!metadata) {
        return res.status(404).json({
            success: false,
            error: 'Image not found'
        });
    }

    res.json({
        success: true,
        metadata: metadata
    });
});

// API endpoint to list all generated images
app.get('/api/images', (req, res) => {
    const allImages = Array.from(generatedImages.values());
    res.json({
        success: true,
        images: allImages,
        count: allImages.length
    });
});

// Create default dummy player on startup
function createDefaultPlayer() {
    try {
        const defaultPlayer = new Player({
            name: 'Adventurer',
            description: 'A mysterious adventurer.',
            level: 1,
            health: 25,
            maxHealth: 25,
            attributes: {
                strength: 10,
                dexterity: 10,
                constitution: 10,
                intelligence: 10,
                wisdom: 10,
                charisma: 10
            }
        });

        players.set(defaultPlayer.id, defaultPlayer);
        currentPlayer = defaultPlayer;

        console.log('🎲 Created default player "Adventurer" with default stats');
    } catch (error) {
        console.error('Error creating default player:', error.message);
    }
}

// Initialize default player
createDefaultPlayer();

// Async server initialization
async function startServer() {
    console.log('🔧 Starting server initialization...');

    // Step 1: Validate configuration
    const configValid = await validateConfiguration();
    if (!configValid) {
        console.error('❌ Server startup aborted due to configuration errors');
        process.exit(1);
    }

    // Step 2: Initialize ComfyUI client
    const comfyUIReady = await initializeComfyUI();
    if (!comfyUIReady && config.imagegen && config.imagegen.enabled) {
        console.log('⚠️  Continuing without ComfyUI - image generation will be disabled');
        // Don't exit, just disable the client
        comfyUIClient = null;
    }

    // Step 3: Start the server
    app.listen(PORT, HOST, () => {
        console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
        console.log(`📡 API endpoint available at http://${HOST}:${PORT}/api/hello`);
        console.log(`🎮 Using AI model: ${config.ai.model}`);
        console.log(`🤖 AI endpoint: ${config.ai.endpoint}`);

        if (config.imagegen && config.imagegen.enabled) {
            if (comfyUIClient) {
                console.log(`🎨 Image generation ready (ComfyUI: ${config.imagegen.server.host}:${config.imagegen.server.port})`);
            } else {
                console.log(`🎨 Image generation disabled (ComfyUI not available)`);
            }
        } else {
            console.log(`🎨 Image generation disabled in configuration`);
        }

        console.log(`\n🌟 AI RPG Game Master is ready!`);
    });
}

// Start the server
startServer().catch(error => {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
});
