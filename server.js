const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('xmldom');
const Utils = require('./Utils.js');

// Import Player class
const Player = require('./Player.js');

// Import Location and LocationExit classes  
const Location = require('./Location.js');
const LocationExit = require('./LocationExit.js');

// Import Thing class
const Thing = require('./Thing.js');

// Import Skill class
const Skill = require('./Skill.js');

// Import SettingInfo class
const SettingInfo = require('./SettingInfo.js');

// Import Region class
const Region = require('./Region.js');

// Import ComfyUI client
const ComfyUIClient = require('./ComfyUIClient.js');
const Events = require('./Events.js');

const BANNED_NPC_NAMES_PATH = path.join(__dirname, 'defs', 'banned_npc_names.yaml');
let cachedBannedNpcWords = null;

// On run, remove ./logs_prev/*.log and move ./logs/*.log to ./logs_prev
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
const logsPrevDir = path.join(__dirname, 'logs_prev');
if (!fs.existsSync(logsPrevDir)) {
    fs.mkdirSync(logsPrevDir, { recursive: true });
}
fs.readdirSync(logsPrevDir)
    .filter(file => file.endsWith('.log'))
    .forEach(file => {
        fs.unlinkSync(path.join(logsPrevDir, file));
    });
fs.readdirSync(logsDir)
    .filter(file => file.endsWith('.log'))
    .forEach(file => {
        fs.renameSync(path.join(logsDir, file), path.join(logsPrevDir, file));
    });

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

// If --port is provided, override config.server.port
const args = process.argv.slice(2);
const portArgIndex = args.indexOf('--port');
if (portArgIndex !== -1 && args.length > portArgIndex + 1) {
    const portArgValue = parseInt(args[portArgIndex + 1], 10);
    if (!isNaN(portArgValue)) {
        config.server.port = portArgValue;
    }
}

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

const KNOWN_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const entityImageJobs = new Map(); // Track active jobs per entity key

function getJobSnapshot(jobId) {
    if (!jobId) {
        return null;
    }

    const job = imageJobs.get(jobId);
    if (!job) {
        return null;
    }

    return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt || null
    };
}

function makeEntityJobKey(type, id) {
    if (!type || !id) {
        return null;
    }
    return `${type}:${id}`;
}

function setEntityJob(type, id, jobId) {
    const key = makeEntityJobKey(type, id);
    if (!key || !jobId) {
        return;
    }
    entityImageJobs.set(key, jobId);
}

function getEntityJob(type, id) {
    const key = makeEntityJobKey(type, id);
    if (!key) {
        return null;
    }
    const jobId = entityImageJobs.get(key);
    if (!jobId) {
        return null;
    }
    if (hasActiveImageJob(jobId)) {
        return jobId;
    }
    entityImageJobs.delete(key);
    return null;
}

function clearEntityJob(type, id, jobId = null) {
    const key = makeEntityJobKey(type, id);
    if (!key) {
        return;
    }
    if (jobId) {
        const current = entityImageJobs.get(key);
        if (current && current !== jobId) {
            return;
        }
    }
    entityImageJobs.delete(key);
}

function hasActiveImageJob(imageId) {
    if (!imageId) {
        return false;
    }
    const job = imageJobs.get(imageId);
    if (!job) {
        return false;
    }
    return job.status === JOB_STATUS.QUEUED || job.status === JOB_STATUS.PROCESSING;
}

function imageFileExists(imageId) {
    if (!imageId) {
        return false;
    }
    try {
        const imagesDir = path.join(__dirname, 'public', 'generated-images');
        for (const ext of KNOWN_IMAGE_EXTENSIONS) {
            const candidate = path.join(imagesDir, `${imageId}${ext}`);
            if (fs.existsSync(candidate)) {
                return true;
            }
        }
    } catch (error) {
        console.warn(`Failed to check image files for ${imageId}:`, error.message);
    }
    return false;
}

function hasExistingImage(imageId) {
    console.log('Checking existing image for ID:', imageId);
    if (!imageId) {
        console.warn('No image ID provided');
        return false;
    }
    if (generatedImages.has(imageId)) {
        console.log(`Found existing image in cache for ID: ${imageId}`);
        return true;
    }
    console.log(`No existing image found for ID: ${imageId}`);
    if (imageFileExists(imageId)) {
        console.log(`Found existing image file for ID: ${imageId}`);
        generatedImages.set(imageId, { id: imageId });
        return true;
    }
    return false;
}

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

    let jobId = null;
    let job = null;

    try {
        jobId = jobQueue.shift();
        job = imageJobs.get(jobId);

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
                        delete player.pendingImageJobId;
                        console.log(`🎨 Updated player ${player.name} imageId to: ${result.imageId}`);
                    }
                    clearEntityJob('player', job.payload.playerId, job.id);
                }

                // Update location's imageId if this was a location scene job
                if (job.payload.isLocationScene && job.payload.locationId && result.imageId) {
                    const location = gameLocations.get(job.payload.locationId);
                    if (location) {
                        location.imageId = result.imageId;
                        delete location.pendingImageJobId;
                        console.log(`🏞️ Updated location ${location.id} imageId to: ${result.imageId}`);
                    }
                    pendingLocationImages.delete(job.payload.locationId);
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
                        delete foundExit.pendingImageJobId;
                        console.log(`🚪 Updated location exit ${foundExit.id} imageId to: ${result.imageId}`);
                    }
                    clearEntityJob('location-exit', job.payload.locationExitId, job.id);
                }

                // Update thing's imageId if this was a thing image job
                if (job.payload.isThingImage && job.payload.thingId && result.imageId) {
                    const thing = things.get(job.payload.thingId);
                    if (thing) {
                        thing.imageId = result.imageId;
                        delete thing.pendingImageJobId;
                        console.log(`🎨 Updated thing ${thing.name} (${thing.thingType}) imageId to: ${result.imageId}`);
                    }
                    clearEntityJob('thing', job.payload.thingId, job.id);
                }
            }

        } catch (error) {
            clearTimeout(timeoutId);

            if (job.status !== JOB_STATUS.TIMEOUT) {
                job.status = JOB_STATUS.FAILED;
                job.error = error.message;
                job.message = `Generation failed: ${error.message}`;
                job.completedAt = new Date().toISOString();
                if (job.payload.isLocationScene && job.payload.locationId) {
                    pendingLocationImages.delete(job.payload.locationId);
                }
            }
        }

    } finally {
        isProcessingJob = false;

        const currentJob = job && job.id ? job : (jobId ? imageJobs.get(jobId) : null);
        if (currentJob?.payload?.isLocationScene && currentJob.payload.locationId && currentJob.status !== JOB_STATUS.PROCESSING) {
            pendingLocationImages.delete(currentJob.payload.locationId);
        }

        if (currentJob && currentJob.status !== JOB_STATUS.PROCESSING) {
            const payload = currentJob.payload || {};

            if (payload.isPlayerPortrait && payload.playerId) {
                clearEntityJob('player', payload.playerId, currentJob.id);
                const player = players.get(payload.playerId);
                if (player && currentJob.status !== JOB_STATUS.COMPLETED) {
                    delete player.pendingImageJobId;
                }
            }

            if (payload.isThingImage && payload.thingId) {
                clearEntityJob('thing', payload.thingId, currentJob.id);
                const thing = things.get(payload.thingId);
                if (thing && currentJob.status !== JOB_STATUS.COMPLETED) {
                    delete thing.pendingImageJobId;
                }
            }

            if (payload.isLocationExitImage && payload.locationExitId) {
                clearEntityJob('location-exit', payload.locationExitId, currentJob.id);
                if (currentJob.status !== JOB_STATUS.COMPLETED) {
                    for (const location of gameLocations.values()) {
                        const exits = location.exits;
                        for (const exit of exits.values()) {
                            if (exit.id === payload.locationExitId) {
                                delete exit.pendingImageJobId;
                                break;
                            }
                        }
                    }
                }
            }

            if (payload.isLocationScene && payload.locationId && currentJob.status !== JOB_STATUS.COMPLETED) {
                const location = gameLocations.get(payload.locationId);
                if (location) {
                    delete location.pendingImageJobId;
                }
            }
        }

        if (jobQueue.length > 0) {
            setTimeout(() => processJobQueue(), 100);
        }
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
            timeout: 15000 // 15 second timeout
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
let currentSetting = null; // Current game setting

Player.setCurrentPlayerResolver(() => currentPlayer);

function getActiveSettingSnapshot() {
    if (currentSetting && typeof currentSetting.toJSON === 'function') {
        return currentSetting.toJSON();
    }
    return null;
}

function buildNewGameDefaults(settingSnapshot = null) {
    const defaults = {
        playerName: '',
        playerDescription: '',
        startingLocation: '',
        numSkills: 20,
        existingSkills: [],
        availableClasses: [],
        availableRaces: [],
        playerClass: '',
        playerRace: ''
    };

    if (!settingSnapshot) {
        return defaults;
    }

    defaults.playerName = typeof settingSnapshot.defaultPlayerName === 'string'
        ? settingSnapshot.defaultPlayerName.trim()
        : '';

    defaults.playerDescription = typeof settingSnapshot.defaultPlayerDescription === 'string'
        ? settingSnapshot.defaultPlayerDescription.trim()
        : '';

    defaults.startingLocation = typeof settingSnapshot.defaultStartingLocation === 'string'
        ? settingSnapshot.defaultStartingLocation.trim()
        : '';

    const parsedSkillCount = Number.parseInt(settingSnapshot.defaultNumSkills, 10);
    defaults.numSkills = Number.isFinite(parsedSkillCount)
        ? Math.max(1, Math.min(100, parsedSkillCount))
        : defaults.numSkills;

    const existingSkills = Array.isArray(settingSnapshot.defaultExistingSkills)
        ? settingSnapshot.defaultExistingSkills
        : (typeof settingSnapshot.defaultExistingSkills === 'string'
            ? settingSnapshot.defaultExistingSkills.split(/\r?\n/)
            : []);

    defaults.existingSkills = existingSkills
        .map(skill => (typeof skill === 'string' ? skill.trim() : ''))
        .filter(skill => skill.length > 0);

    const normalizeList = (value) => {
        const rawEntries = Array.isArray(value)
            ? value
            : (typeof value === 'string' ? value.split(/\r?\n/) : []);

        const seen = new Set();
        const result = [];

        for (const entry of rawEntries) {
            if (typeof entry !== 'string') {
                continue;
            }
            const trimmed = entry.trim();
            if (!trimmed) {
                continue;
            }
            const lower = trimmed.toLowerCase();
            if (seen.has(lower)) {
                continue;
            }
            seen.add(lower);
            result.push(trimmed);
        }

        return result;
    };

    const classList = normalizeList(settingSnapshot.availableClasses);
    const raceList = normalizeList(settingSnapshot.availableRaces);

    defaults.availableClasses = classList;
    defaults.availableRaces = raceList;
    defaults.playerClass = classList.length ? classList[0] : '';
    defaults.playerRace = raceList.length ? raceList[0] : '';

    return defaults;
}

function describeSettingForPrompt(settingSnapshot = null) {
    const fallbackSetting = config.gamemaster?.promptVariables?.setting;

    if (!settingSnapshot) {
        if (typeof fallbackSetting === 'string' && fallbackSetting.trim()) {
            return fallbackSetting.trim();
        }
        return 'A rich fantasy world filled with adventure.';
    }

    const sections = [];
    const titleParts = [];

    if (settingSnapshot.name) {
        titleParts.push(settingSnapshot.name);
    }

    const themeGenre = [settingSnapshot.theme, settingSnapshot.genre]
        .filter(part => typeof part === 'string' && part.trim())
        .map(part => part.trim())
        .join(' / ');

    if (themeGenre) {
        titleParts.push(themeGenre);
    }

    if (titleParts.length) {
        sections.push(titleParts.join(' - '));
    }

    if (settingSnapshot.description) {
        sections.push(settingSnapshot.description);
    }

    const traitParts = [];
    if (settingSnapshot.tone) traitParts.push(`tone ${settingSnapshot.tone}`);
    if (settingSnapshot.difficulty) traitParts.push(`difficulty ${settingSnapshot.difficulty}`);
    if (settingSnapshot.magicLevel) traitParts.push(`magic ${settingSnapshot.magicLevel}`);
    if (settingSnapshot.techLevel) traitParts.push(`technology ${settingSnapshot.techLevel}`);

    if (traitParts.length) {
        sections.push(`Key traits: ${traitParts.join(', ')}.`);
    }

    if (settingSnapshot.startingLocationType) {
        sections.push(`Common starting location: ${settingSnapshot.startingLocationType}.`);
    }

    const description = sections.join(' ').trim();
    if (description) {
        return description;
    }

    if (typeof fallbackSetting === 'string' && fallbackSetting.trim()) {
        return fallbackSetting.trim();
    }

    return 'A rich fantasy world filled with adventure.';
}

function resolveLocationStyle(requestedStyle, settingSnapshot = null) {
    const trimmedRequested = typeof requestedStyle === 'string' ? requestedStyle.trim() : '';
    if (trimmedRequested) {
        return trimmedRequested;
    }

    const fromSetting = settingSnapshot?.startingLocationType;
    if (typeof fromSetting === 'string' && fromSetting.trim()) {
        return fromSetting.trim();
    }

    return 'village';
}

function buildLocationShortDescription(style, settingSnapshot = null, override = '') {
    const trimmedOverride = typeof override === 'string' ? override.trim() : '';
    if (trimmedOverride) {
        return trimmedOverride;
    }

    const settingName = settingSnapshot?.name;
    if (style && settingName) {
        return `A ${style} that fits the themes of ${settingName}.`;
    }

    if (style) {
        return `A ${style} that reflects the current game setting.`;
    }

    return settingSnapshot?.description || 'An evocative location within the current setting.';
}

function buildLocationPurpose(style, settingSnapshot = null, override = '') {
    const trimmedOverride = typeof override === 'string' ? override.trim() : '';
    if (trimmedOverride) {
        return trimmedOverride;
    }

    if (style) {
        return `Expand the world with a ${style} aligned with the setting's tone.`;
    }

    if (settingSnapshot?.name) {
        return `Expand the world of ${settingSnapshot.name}.`;
    }

    return 'Expand the world with a new distinctive location.';
}

function getSuggestedPlayerLevel(settingSnapshot = null) {
    if (currentPlayer && typeof currentPlayer.level === 'number') {
        return currentPlayer.level;
    }

    if (settingSnapshot?.playerStartingLevel) {
        return settingSnapshot.playerStartingLevel;
    }

    return 1;
}
const players = new Map(); // Store multiple players by ID
const things = new Map(); // Store things (items and scenery) by ID
const skills = new Map(); // Store skill definitions by name

// In-memory game world storage
const gameLocations = new Map(); // Store Location instances by ID
const gameLocationExits = new Map(); // Store LocationExit instances by ID
const regions = new Map(); // Store Region instances by ID
const pendingRegionStubs = new Map(); // Store region definitions awaiting full generation
const pendingLocationImages = new Map(); // Store active image job IDs per location
const npcGenerationPromises = new Map(); // Track in-flight NPC generations by normalized name

function shouldGenerateNpcImage(npc) {
    if (!npc) {
        return false;
    }

    const activeJobId = getEntityJob('player', npc.id);
    if (activeJobId) {
        return false;
    }
    if (npc.imageId && hasExistingImage(npc.imageId)) {
        return false;
    }

    if (!npc.isNPC) {
        return true;
    }
    if (!currentPlayer) {
        return false;
    }

    const sameLocation = npc.currentLocation && currentPlayer.currentLocation
        ? npc.currentLocation === currentPlayer.currentLocation
        : false;

    let inParty = false;
    if (typeof currentPlayer.getPartyMembers === 'function') {
        const members = currentPlayer.getPartyMembers();
        inParty = Array.isArray(members) && members.includes(npc.id);
    }

    return Boolean(sameLocation || inParty);
}

function shouldGenerateThingImage(thing) {
    if (!thing) {
        return false;
    }

    if (getEntityJob('thing', thing.id)) {
        return false;
    }

    if (thing.imageId && hasExistingImage(thing.imageId)) {
        return false;
    }

    if (thing.thingType !== 'item') {
        return true;
    }

    if (!currentPlayer) {
        return false;
    }

    const playerHasItem = typeof currentPlayer.hasInventoryItem === 'function'
        ? currentPlayer.hasInventoryItem(thing)
        : false;
    if (playerHasItem) {
        return true;
    }

    const thingMetadata = thing.metadata || {};
    const itemLocationId = thingMetadata.locationId || null;
    if (itemLocationId && currentPlayer.currentLocation && itemLocationId === currentPlayer.currentLocation) {
        return true;
    }

    return false;
}

function queueNpcAssetsForLocation(location) {
    if (!location) {
        return;
    }

    try {
        const npcIds = Array.isArray(location.npcIds) ? location.npcIds : [];
        for (const npcId of npcIds) {
            const npc = players.get(npcId);
            if (!npc || !npc.isNPC) {
                continue;
            }

            if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
                npc.imageId = null;
            }

            const npcItems = typeof npc.getInventoryItems === 'function' ? npc.getInventoryItems() : [];
            for (const item of npcItems) {
                if (!shouldGenerateThingImage(item)) {
                    continue;
                }
                // Items owned by NPCs do not need pre-rendered images; skip the generation.
            }
        }
    } catch (error) {
        console.warn(`Failed to queue NPC assets for ${location.name || location.id}:`, error.message);
    }
}

function queueLocationThingImages(location) {
    if (!location || !currentPlayer || currentPlayer.currentLocation !== location.id) {
        return;
    }

    try {
        const candidateIds = new Set();
        const locationThingIds = Array.isArray(location.thingIds)
            ? location.thingIds
            : (typeof location.getThingIds === 'function' ? Array.from(location.getThingIds()) : []);

        for (const thingId of locationThingIds) {
            if (thingId) {
                candidateIds.add(thingId);
            }
        }

        /*
        for (const thing of things.values()) {
            if (!thing || thing.thingType !== 'item') {
                continue;
            }

            const metadata = thing.metadata || {};
            const ownerId = metadata.ownerId || null;
            const locationId = metadata.locationId || null;

            if (ownerId && ownerId !== currentPlayer.id) {
                continue;
            }

            if (locationId === location.id) {
                candidateIds.add(thing.id);
            }
        }
        */

        if (!candidateIds.size) {
            return;
        }

        for (const thingId of candidateIds) {
            const thing = things.get(thingId) || (typeof Thing.getById === 'function' ? Thing.getById(thingId) : null);
            if (!thing || thing.thingType !== 'item') {
                continue;
            }

            const metadata = thing.metadata || {};
            if (metadata.ownerId && metadata.ownerId !== currentPlayer.id) {
                continue;
            }

            if (!shouldGenerateThingImage(thing)) {
                continue;
            }

            if (!thing.imageId || !hasExistingImage(thing.imageId)) {
                thing.imageId = null;
            }
        }
    } catch (error) {
        console.warn(`Failed to queue thing images for ${location.name || location.id}:`, error.message);
    }
}

function serializeNpcForClient(npc) {
    if (!npc) {
        return null;
    }

    let skills = {};
    try {
        const skillSource = typeof npc.getSkills === 'function' ? npc.getSkills() : null;
        if (skillSource instanceof Map) {
            skills = Object.fromEntries(skillSource);
        } else if (skillSource && typeof skillSource === 'object') {
            skills = { ...skillSource };
        }
    } catch (_) {
        skills = {};
    }

    let abilities = [];
    try {
        abilities = typeof npc.getAbilities === 'function' ? npc.getAbilities() : [];
    } catch (_) {
        abilities = [];
    }

    let statusEffects = [];
    try {
        statusEffects = typeof npc.getStatusEffects === 'function' ? npc.getStatusEffects() : [];
    } catch (_) {
        statusEffects = [];
    }

    let attributes = {};
    try {
        attributes = npc.attributes ? { ...npc.attributes } : {};
    } catch (_) {
        attributes = {};
    }

    let unspentSkillPoints = null;
    try {
        if (typeof npc.getUnspentSkillPoints === 'function') {
            unspentSkillPoints = npc.getUnspentSkillPoints();
        }
    } catch (_) {
        unspentSkillPoints = null;
    }

    let inventory = [];
    try {
        if (typeof npc.getInventoryItems === 'function') {
            inventory = npc.getInventoryItems().map(item => typeof item.toJSON === 'function' ? item.toJSON() : item);
        }
    } catch (_) {
        inventory = [];
    }

    return {
        id: npc.id,
        name: npc.name,
        description: npc.description,
        shortDescription: npc.shortDescription,
        class: npc.class,
        race: npc.race,
        level: npc.level,
        health: npc.health,
        maxHealth: npc.maxHealth,
        healthAttribute: npc.healthAttribute,
        imageId: npc.imageId,
        isNPC: Boolean(npc.isNPC),
        locationId: npc.currentLocation,
        attributes,
        skills,
        abilities,
        statusEffects,
        unspentSkillPoints,
        inventory,
        createdAt: npc.createdAt,
        lastUpdated: npc.lastUpdated
    };
}

function buildNpcProfiles(location) {
    if (!location || typeof location.npcIds !== 'object') {
        return [];
    }
    return location.npcIds
        .map(id => players.get(id))
        .map(serializeNpcForClient)
        .filter(Boolean);
}

function buildThingProfiles(location) {
    if (!location) {
        return [];
    }

    const thingIds = Array.isArray(location.thingIds)
        ? location.thingIds
        : (typeof location.getThingIds === 'function' ? Array.from(location.getThingIds()) : []);

    const profiles = [];
    for (const thingId of thingIds) {
        if (!thingId) continue;
        const thing = things.get(thingId) || Thing.getById(thingId);
        if (!thing) {
            continue;
        }

        const metadata = thing.metadata || {};
        const statusEffects = typeof thing.getStatusEffects === 'function' ? thing.getStatusEffects() : [];

        profiles.push({
            id: thing.id,
            name: thing.name,
            description: thing.description,
            thingType: thing.thingType,
            imageId: thing.imageId,
            rarity: thing.rarity || null,
            itemTypeDetail: thing.itemTypeDetail || null,
            slot: thing.slot || null,
            attributeBonuses: thing.attributeBonuses || [],
            causeStatusEffect: thing.causeStatusEffect || null,
            metadata: metadata || {},
            statusEffects
        });
    }

    return profiles;
}

function findActorByName(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (currentPlayer) {
        const playerAliases = [
            currentPlayer.name?.trim().toLowerCase(),
            'player',
            'the player',
            'you',
            'self'
        ].filter(Boolean);

        if (playerAliases.includes(normalized)) {
            return currentPlayer;
        }
    }

    for (const actor of players.values()) {
        if (actor && typeof actor.name === 'string' && actor.name.trim().toLowerCase() === normalized) {
            return actor;
        }
    }

    return null;
}

async function ensureNpcByName(name, context = {}) {
    const existing = findActorByName(name);
    if (existing) {
        return existing;
    }

    let resolvedLocation = context.location || null;
    if (!resolvedLocation && context.player?.currentLocation) {
        try {
            resolvedLocation = Location.get(context.player.currentLocation);
        } catch (_) {
            resolvedLocation = null;
        }
    }

    const resolvedRegion = context.region || (resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null);

    const generated = await generateNpcFromEvent({
        name,
        location: resolvedLocation,
        region: resolvedRegion
    });

    if (generated) {
        return generated;
    }

    const fallbackNpc = new Player({
        name,
        description: `${name} emerges in the scene.`,
        level: 1,
        location: resolvedLocation?.id || null,
        isNPC: true
    });
    players.set(fallbackNpc.id, fallbackNpc);
    if (resolvedLocation && typeof resolvedLocation.addNpcId === 'function') {
        resolvedLocation.addNpcId(fallbackNpc.id);
    }
    return fallbackNpc;
}

function findThingByName(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    for (const thing of things.values()) {
        if (thing && typeof thing.name === 'string' && thing.name.trim().toLowerCase() === normalized) {
            return thing;
        }
    }
    return null;
}

function findLocationByNameLoose(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }
    let location = null;
    try {
        location = Location.findByName(trimmed);
    } catch (_) {
        location = null;
    }
    if (location) {
        return location;
    }

    const normalized = trimmed.toLowerCase();
    for (const loc of gameLocations.values()) {
        if (!loc) continue;
        if (loc.id === trimmed) {
            return loc;
        }
        if (typeof loc.name === 'string' && loc.name.trim().toLowerCase() === normalized) {
            return loc;
        }
    }
    return null;
}

function findRegionByNameLoose(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    for (const region of regions.values()) {
        if (!region) continue;
        if (region.name && region.name.trim().toLowerCase() === normalized) {
            return region;
        }
    }
    return null;
}

function pruneAndDecrementStatusEffects(entity) {
    if (!entity) {
        return;
    }

    try {
        if (typeof entity.clearExpiredStatusEffects === 'function') {
            entity.clearExpiredStatusEffects();
        } else if (typeof entity.getStatusEffects === 'function' && typeof entity.setStatusEffects === 'function') {
            const filtered = entity.getStatusEffects().filter(effect => !Number.isFinite(effect.duration) || effect.duration > 0);
            entity.setStatusEffects(filtered);
        }

        if (typeof entity.tickStatusEffects === 'function') {
            entity.tickStatusEffects();
        } else if (typeof entity.getStatusEffects === 'function' && typeof entity.setStatusEffects === 'function') {
            const ticked = entity.getStatusEffects().map(effect => {
                if (!Number.isFinite(effect.duration)) {
                    return effect;
                }
                return { ...effect, duration: effect.duration - 1 };
            });
            entity.setStatusEffects(ticked);
        }
    } catch (error) {
        console.warn('Failed to update status effects:', error.message);
    }
}

function tickStatusEffectsForAction({ player = currentPlayer, location = null } = {}) {
    if (!player) {
        return { location: null, region: null };
    }

    let resolvedLocation = location;
    if (!resolvedLocation && player.currentLocation) {
        try {
            resolvedLocation = Location.get(player.currentLocation);
        } catch (error) {
            console.warn('Failed to resolve player location for status tick:', error.message);
        }
    }

    const region = resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null;

    const processed = new Set();
    const processEntity = entity => {
        if (!entity || processed.has(entity)) {
            return;
        }
        processed.add(entity);
        pruneAndDecrementStatusEffects(entity);
    };

    processEntity(player);
    processEntity(resolvedLocation);
    processEntity(region);

    if (player && typeof player.getInventoryItems === 'function') {
        for (const thing of player.getInventoryItems()) {
            processEntity(thing);
        }
    }

    if (player && typeof player.getPartyMembers === 'function') {
        for (const memberId of player.getPartyMembers()) {
            const member = players.get(memberId);
            if (member) {
                processEntity(member);
            }
        }
    }

    if (resolvedLocation) {
        if (Array.isArray(resolvedLocation.npcIds)) {
            for (const npcId of resolvedLocation.npcIds) {
                const npc = players.get(npcId);
                if (npc) {
                    processEntity(npc);
                }
            }
        }
        for (const thing of things.values()) {
            const metadata = thing.metadata || {};
            if (metadata.locationId === resolvedLocation.id && !metadata.ownerId) {
                processEntity(thing);
            }
        }
    }

    return { location: resolvedLocation, region };
}

function getEventPromptTemplates() {
    try {
        const eventsDir = path.join(__dirname, 'prompts', 'events');
        if (!fs.existsSync(eventsDir)) {
            return [];
        }
        return fs.readdirSync(eventsDir)
            .filter(file => file.toLowerCase().endsWith('.njk'))
            .sort()
            .map(file => path.posix.join('events', file));
    } catch (error) {
        console.warn('Failed to load event prompt templates:', error.message);
        return [];
    }
}

function buildBasePromptContext({ locationOverride = null } = {}) {
    const activeSetting = getActiveSettingSnapshot();
    const settingDescription = describeSettingForPrompt(activeSetting);

    let location = locationOverride;
    if (!location && currentPlayer && currentPlayer.currentLocation) {
        try {
            location = Location.get(currentPlayer.currentLocation);
        } catch (error) {
            console.warn('Failed to resolve current player location for prompt context:', error.message);
        }
    }

    let region = null;
    if (location) {
        try {
            region = findRegionByLocationId(location.id);
        } catch (error) {
            console.warn('Failed to resolve region by location id:', error.message);
        }

        if (!region && location.stubMetadata?.regionId && regions.has(location.stubMetadata.regionId)) {
            region = regions.get(location.stubMetadata.regionId);
        }
    }

    const locationDetails = location ? location.getDetails?.() : null;
    const playerStatus = currentPlayer && typeof currentPlayer.getStatus === 'function'
        ? currentPlayer.getStatus()
        : null;

    const normalizeStatusEffects = value => {
        let source = [];
        if (!value) {
            return [];
        }

        if (typeof value.getStatusEffects === 'function') {
            source = value.getStatusEffects();
        } else if (Array.isArray(value.statusEffects)) {
            source = value.statusEffects;
        } else if (Array.isArray(value)) {
            source = value;
        }

        const normalized = [];
        for (const entry of source) {
            if (!entry) continue;

            if (typeof entry === 'string') {
                const description = entry.trim();
                if (!description) continue;
                normalized.push({ description, duration: 1 });
                continue;
            }

            if (typeof entry === 'object') {
                const descriptionValue = typeof entry.description === 'string'
                    ? entry.description.trim()
                    : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
                if (!descriptionValue) {
                    continue;
                }

                const rawDuration = entry.duration;
                let duration = null;
                if (Number.isFinite(rawDuration)) {
                    duration = Math.floor(rawDuration);
                } else if (Number.isFinite(Number(rawDuration))) {
                    duration = Math.floor(Number(rawDuration));
                } else if (rawDuration === null) {
                    duration = null;
                } else {
                    duration = 1;
                }

                normalized.push({
                    description: descriptionValue,
                    duration: duration === null ? null : Math.max(0, duration)
                });
            }
        }

        return normalized;
    };

    const currentLocationContext = {
        name: locationDetails?.name || location?.name || 'Unknown Location',
        description: locationDetails?.description || location?.description || 'No description available.',
        statusEffects: normalizeStatusEffects(location || locationDetails)
    };

    const regionStatus = region && typeof region.toJSON === 'function' ? region.toJSON() : null;
    const regionLocations = [];

    if (regionStatus && Array.isArray(regionStatus.locationIds)) {
        for (const locId of regionStatus.locationIds) {
            if (!locId) continue;
            const regionLocation = gameLocations.get(locId);
            const regionLocationDetails = regionLocation?.getDetails?.();
            const regionLocationName = regionLocationDetails?.name || regionLocation?.name || locId;
            const regionLocationDescription = regionLocationDetails?.description
                || regionLocation?.description
                || regionLocation?.stubMetadata?.blueprintDescription
                || '';

            regionLocations.push({
                id: locId,
                name: regionLocationName,
                description: regionLocationDescription
            });
        }
    }

    if (!regionLocations.length && regionStatus && Array.isArray(regionStatus.locationBlueprints)) {
        for (const blueprint of regionStatus.locationBlueprints) {
            if (!blueprint || !blueprint.name) continue;
            regionLocations.push({
                id: blueprint.name,
                name: blueprint.name,
                description: blueprint.description || ''
            });
        }
    }

    const currentRegionContext = {
        name: regionStatus?.name || location?.stubMetadata?.regionName || 'Unknown Region',
        description: regionStatus?.description || location?.stubMetadata?.regionDescription || 'No region description available.',
        statusEffects: normalizeStatusEffects(region || regionStatus),
        locations: regionLocations
    };

    const mapItemContext = (item, equippedSlot = null) => {
        if (!item) {
            return null;
        }

        const name = item.name || item.title || 'Unknown Item';
        const description = item.description || item.summary || '';
        const statusEffects = normalizeStatusEffects(item);
        const equipped = equippedSlot || null;

        return {
            name,
            description,
            statusEffects,
            equippedSlot: equipped
        };
    };

    const mapSkillContext = () => {
        if (!playerStatus || !playerStatus.skills) {
            return [];
        }

        const entries = [];
        for (const [skillName, rank] of Object.entries(playerStatus.skills)) {
            if (!skillName) {
                continue;
            }
            const skillDef = skills.get(skillName) || skills.get(skillName.toLowerCase());
            const description = skillDef?.description || skillDef?.details || '';
            entries.push({
                name: skillName,
                rank,
                description
            });
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    };

    const currentPlayerInventory = Array.isArray(playerStatus?.inventory)
        ? playerStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
        : [];

    const currentPlayerSkills = mapSkillContext();

    const gearSnapshot = playerStatus?.gear && typeof playerStatus.gear === 'object'
        ? Object.entries(playerStatus.gear).map(([slotName, slotData]) => ({
            slot: slotName,
            itemId: slotData?.itemId || null
        }))
        : [];

    const currentPlayerContext = {
        name: playerStatus?.name || currentPlayer?.name || 'Unknown Adventurer',
        description: playerStatus?.description || currentPlayer?.description || '',
        health: playerStatus?.health ?? 'Unknown',
        maxHealth: playerStatus?.maxHealth ?? 'Unknown',
        level: playerStatus?.level ?? currentPlayer?.level ?? 'Unknown',
        class: playerStatus?.class || currentPlayer?.class || 'Adventurer',
        race: playerStatus?.race || currentPlayer?.race || 'Unknown',
        statusEffects: normalizeStatusEffects(currentPlayer || playerStatus),
        inventory: currentPlayerInventory,
        skills: currentPlayerSkills,
        gear: gearSnapshot
    };

    const npcs = [];
    const dispositionDefinitions = Player.getDispositionDefinitions();
    const dispositionTypes = Object.values(dispositionDefinitions?.types || {});
    const dispositionTypesForPrompt = dispositionTypes.map((type) => ({
        key: type.key,
        name: type.label || type.key,
        description: type.description || '',
        move_up: Array.isArray(type.moveUp) ? type.moveUp : [],
        move_down: Array.isArray(type.moveDown) ? type.moveDown : [],
        move_way_down: Array.isArray(type.moveWayDown) ? type.moveWayDown : []
    }));
    if (location) {
        const npcIds = Array.isArray(location.npcIds)
            ? location.npcIds
            : (Array.isArray(locationDetails?.npcIds) ? locationDetails.npcIds : []);
        for (const npcId of npcIds) {
            const npc = players.get(npcId);
            if (!npc) {
                continue;
            }
            const npcStatus = typeof npc.getStatus === 'function' ? npc.getStatus() : null;
            const npcInventory = Array.isArray(npcStatus?.inventory)
                ? npcStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
                : [];

            const dispositionsTowardsPlayer = [];
            if (currentPlayer && typeof currentPlayer.id === 'string' && currentPlayer.id && dispositionTypes.length) {
                for (const dispositionType of dispositionTypes) {
                    if (!dispositionType || !dispositionType.key) {
                        continue;
                    }
                    const typeKey = dispositionType.key;
                    const typeLabel = dispositionType.label || typeKey;
                    let value = 0;
                    if (typeof npc.getDispositionTowardsCurrentPlayer === 'function') {
                        value = npc.getDispositionTowardsCurrentPlayer(typeKey) ?? 0;
                    } else if (typeof npc.getDisposition === 'function') {
                        value = npc.getDisposition(currentPlayer.id, typeKey) ?? 0;
                    }
                    const intensityName = Player.resolveDispositionIntensity(typeKey, value);
                    dispositionsTowardsPlayer.push({
                        type: typeLabel,
                        value,
                        intensityName
                    });
                }
            }

            npcs.push({
                name: npcStatus?.name || npc.name || 'Unknown NPC',
                description: npcStatus?.description || npc.description || '',
                class: npcStatus?.class || npc.class || null,
                race: npcStatus?.race || npc.race || null,
                level: npcStatus?.level || npc.level || null,
                statusEffects: normalizeStatusEffects(npc || npcStatus),
                inventory: npcInventory,
                dispositionsTowardsPlayer
            });
        }
    }

    const party = [];
    if (currentPlayer && typeof currentPlayer.getPartyMembers === 'function') {
        const memberIds = currentPlayer.getPartyMembers();
        for (const memberId of memberIds) {
            const member = players.get(memberId);
            if (!member) {
                continue;
            }
            const memberStatus = typeof member.getStatus === 'function' ? member.getStatus() : null;
            const memberInventory = Array.isArray(memberStatus?.inventory)
                ? memberStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
                : [];
            party.push({
                name: memberStatus?.name || member.name || 'Unknown Ally',
                description: memberStatus?.description || member.description || '',
                class: memberStatus?.class || member.class || null,
                race: memberStatus?.race || member.race || null,
                level: memberStatus?.level || member.level || null,
                statusEffects: normalizeStatusEffects(member || memberStatus),
                inventory: memberInventory
            });
        }
    }

    const itemsInScene = [];
    if (location) {
        for (const thing of things.values()) {
            const metadata = thing.metadata || {};
            if (metadata.locationId === location.id && !metadata.ownerId) {
                itemsInScene.push({
                    name: thing.name || 'Unnamed Item',
                    description: thing.description || '',
                    statusEffects: normalizeStatusEffects(thing)
                });
            }
        }
    }

    const historyEntries = chatHistory.slice(-10);
    const gameHistory = historyEntries.length
        ? historyEntries.map(entry => `[${entry.role}] ${entry.content}`).join('\n')
        : 'No significant prior events.';

    return {
        setting: settingDescription,
        gameHistory,
        currentRegion: currentRegionContext,
        currentLocation: currentLocationContext,
        currentPlayer: currentPlayerContext,
        npcs,
        party,
        itemsInScene,
        dispositionTypes: dispositionTypesForPrompt,
        dispositionRange: dispositionDefinitions?.range || {}
    };
}

function parsePlausibilityOutcome(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return null;
    }

    try {
        const trimmed = xmlSnippet.trim();
        const match = trimmed.match(/<plausibility[\s\S]*?<\/plausibility>/i);
        const targetXml = match ? match[0] : `<wrapper>${trimmed}</wrapper>`;

        const parser = new DOMParser();
        const doc = parser.parseFromString(targetXml, 'text/xml');

        const errorNode = doc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            throw new Error(errorNode.textContent || 'Unknown XML parsing error');
        }

        const root = doc.getElementsByTagName('plausibility')[0] || doc.documentElement;
        if (!root) {
            return null;
        }

        const getText = (parent, tag) => {
            const node = parent?.getElementsByTagName(tag)?.[0];
            return node && typeof node.textContent === 'string' ? node.textContent.trim() : null;
        };

        const type = getText(root, 'type');
        const reason = getText(root, 'reason');

        const skillCheckNode = root.getElementsByTagName('skillCheck')[0] || null;
        let skillCheck = null;
        if (skillCheckNode) {
            const skill = getText(skillCheckNode, 'skill');
            const attribute = getText(skillCheckNode, 'attribute');
            const difficulty = getText(skillCheckNode, 'difficulty');
            const skillReason = getText(skillCheckNode, 'reason');

            if (skill || attribute || difficulty || skillReason) {
                skillCheck = {
                    skill: skill && skill.toLowerCase() !== 'n/a' ? skill : null,
                    attribute: attribute && attribute.toLowerCase() !== 'n/a' ? attribute : null,
                    difficulty: difficulty && difficulty.toLowerCase() !== 'n/a' ? difficulty : null,
                    reason: skillReason
                };
            }
        }

        return {
            type: type,
            reason,
            skillCheck
        };
    } catch (error) {
        console.warn('Failed to parse plausibility outcome:', error.message);
        return null;
    }
}

function difficultyToDC(label) {
    if (!label || typeof label !== 'string') {
        return null;
    }

    const normalized = label.trim().toLowerCase();
    switch (normalized) {
        case 'trivial':
            return 5;
        case 'easy':
            return 10;
        case 'medium':
            return 15;
        case 'hard':
            return 20;
        case 'very hard':
            return 25;
        case 'legendary':
            return 30;
        default:
            return null;
    }
}

function classifyOutcomeMargin(margin) {
    if (margin >= 10) {
        return { label: 'critical success', degree: 'critical_success' };
    }
    if (margin >= 6) {
        return { label: 'major success', degree: 'major_success' };
    }
    if (margin >= 3) {
        return { label: 'success', degree: 'success' };
    }
    if (margin >= 0) {
        return { label: 'barely succeeded', degree: 'barely_succeeded' };
    }
    if (margin <= -10) {
        return { label: 'critical failure', degree: 'critical_failure' };
    }
    if (margin <= -6) {
        return { label: 'major failure', degree: 'major_failure' };
    }
    if (margin <= -3) {
        return { label: 'minor failure', degree: 'minor_failure' };
    }
    return { label: 'barely failed', degree: 'barely_failed' };
}

function findAttributeKey(player, attributeName) {
    if (!player || typeof player.getAttributeNames !== 'function' || !attributeName) {
        return null;
    }

    const normalized = attributeName.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    for (const name of player.getAttributeNames()) {
        if (typeof name === 'string' && name.toLowerCase() === normalized) {
            return name;
        }
    }
    return null;
}

function resolvePlayerSkillValue(player, skillName) {
    if (!player || typeof skillName !== 'string' || typeof player.getSkillValue !== 'function') {
        return { key: null, value: 0 };
    }

    const trimmed = skillName.trim();
    if (!trimmed) {
        return { key: null, value: 0 };
    }

    const directValue = player.getSkillValue(trimmed);
    if (Number.isFinite(directValue)) {
        return { key: trimmed, value: directValue };
    }

    if (typeof player.getSkills === 'function') {
        const normalized = trimmed.toLowerCase();
        const skillsMap = player.getSkills();
        if (skillsMap && typeof skillsMap.entries === 'function') {
            for (const [name, value] of skillsMap.entries()) {
                if (typeof name === 'string' && name.toLowerCase() === normalized && Number.isFinite(value)) {
                    return { key: name, value };
                }
            }
        }
    }

    let canonicalName = trimmed;
    let registered = false;

    if (Player && Player.availableSkills instanceof Map && Player.availableSkills.size > 0) {
        for (const existingName of Player.availableSkills.keys()) {
            if (typeof existingName === 'string' && existingName.toLowerCase() === trimmed.toLowerCase()) {
                canonicalName = existingName;
                registered = true;
                break;
            }
        }
    } else {
        registered = true;
    }

    if (!registered && Player && Player.availableSkills instanceof Map) {
        Player.availableSkills.set(canonicalName, { label: canonicalName, description: '' });
        registered = true;
    }

    if (typeof player.setSkillValue === 'function' && registered) {
        const success = player.setSkillValue(canonicalName, 0);
        if (success) {
            return { key: canonicalName, value: 0 };
        }
    }

    return { key: canonicalName, value: 0 };
}

function resolveActionOutcome({ plausibility, player }) {
    if (!plausibility || !player) {
        return null;
    }

    const type = typeof plausibility.type === 'string' ? plausibility.type.trim() : '';
    if (!type) {
        return null;
    }

    const normalizedType = type.toLowerCase();

    if (normalizedType === 'trivial') {
        return {
            label: 'automatic success',
            degree: 'automatic_success',
            type: type,
            reason: plausibility.reason || null,
            roll: null,
            difficulty: null,
            skill: null,
            attribute: null,
            margin: null
        };
    }

    if (normalizedType === 'implausible') {
        return {
            label: 'critical failure',
            degree: 'implausible_failure',
            type: type,
            reason: plausibility.reason || null,
            roll: null,
            difficulty: null,
            skill: null,
            attribute: null,
            margin: null
        };
    }

    if (normalizedType !== 'plausible') {
        return null;
    }

    const skillCheck = plausibility.skillCheck || {};
    const resolvedSkill = skillCheck.skill || null;
    const resolvedAttributeName = skillCheck.attribute || null;
    const resolvedDifficulty = skillCheck.difficulty || null;

    const dc = difficultyToDC(resolvedDifficulty);
    if (!dc) {
        return {
            label: 'success',
            degree: 'success',
            type: type,
            reason: plausibility.reason || skillCheck.reason || null,
            roll: null,
            difficulty: {
                label: resolvedDifficulty,
                dc: null
            },
            skill: resolvedSkill,
            attribute: resolvedAttributeName,
            margin: null
        };
    }

    const skillValueInfo = resolvePlayerSkillValue(player, resolvedSkill || '');
    const skillValue = Number.isFinite(skillValueInfo.value) ? skillValueInfo.value : 0;

    const attributeKey = findAttributeKey(player, resolvedAttributeName || '');
    //const attributeValue = attributeKey ? player.getModifiedAttribute(attributeKey) : null;
    const attributeBonus = player.getAttributeBonus(attributeKey);

    const rollResult = diceModule.rollDice('1d20');
    const dieRoll = rollResult.total;
    const total = dieRoll + skillValue + attributeBonus;
    const margin = total - dc;
    const outcome = classifyOutcomeMargin(margin);

    console.log(`🎲 Skill check result: d20(${dieRoll}) + skill(${skillValue}) + attribute(${attributeBonus}) = ${total} vs DC ${dc} (${resolvedDifficulty || 'Unknown'}). Outcome: ${outcome.label}`);

    return {
        label: outcome.label,
        degree: outcome.degree,
        type: type,
        reason: plausibility.reason || skillCheck.reason || null,
        roll: {
            die: dieRoll,
            detail: rollResult.detail,
            skillValue,
            attributeBonus,
            total
        },
        difficulty: {
            label: resolvedDifficulty,
            dc
        },
        skill: skillValueInfo.key,
        attribute: attributeKey,
        margin
    };
}

function logPlausibilityCheck({ systemPrompt, generationPrompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `plausibility_check_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== PLAUSIBILITY SYSTEM PROMPT ===',
            systemPrompt || '(none)',
            '',
            '=== PLAUSIBILITY GENERATION PROMPT ===',
            generationPrompt || '(none)',
            '',
            '=== PLAUSIBILITY RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log plausibility check:', error.message);
    }
}

async function runPlausibilityCheck({ actionText, locationId, attackContext = null }) {
    if (!actionText || !actionText.trim()) {
        return null;
    }

    const trimmedAction = typeof actionText === 'string' ? actionText.trimStart() : '';
    if (trimmedAction.startsWith('!!')) {
        return null;
    }

    if (!currentPlayer) {
        return null;
    }

    try {
        const location = locationId ? Location.get(locationId) : (currentPlayer.currentLocation ? Location.get(currentPlayer.currentLocation) : null);

        const baseContext = buildBasePromptContext({ locationOverride: location });

        const isAttack = Boolean(attackContext && attackContext.isAttack);
        const attackerTemplate = {
            level: attackContext?.attacker?.level ?? 'unknown',
            weapon: attackContext?.attacker?.weapon ?? 'N/A',
            ability: attackContext?.attacker?.ability ?? 'N/A',
            statusEffects: Array.isArray(attackContext?.attacker?.statusEffects)
                ? attackContext.attacker.statusEffects
                : []
        };

        const targetTemplate = {
            level: attackContext?.target?.level ?? 'unknown',
            gear: Array.isArray(attackContext?.target?.gear)
                ? attackContext.target.gear
                : [],
            statusEffects: Array.isArray(attackContext?.target?.statusEffects)
                ? attackContext.target.statusEffects
                : []
        };

        const renderedTemplate = promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'plausibility-check',
            actionText,
            isAttack,
            attacker: attackerTemplate,
            target: targetTemplate
        });

        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
            console.warn('Plausibility template missing prompts, skipping plausibility analysis.');
            return null;
        }

        const messages = [
            { role: 'system', content: parsedTemplate.systemPrompt },
            { role: 'user', content: parsedTemplate.generationPrompt }
        ];

        const endpoint = config.ai.endpoint;
        const apiKey = config.ai.apiKey;
        const chatEndpoint = endpoint.endsWith('/') ?
            endpoint + 'chat/completions' :
            endpoint + '/chat/completions';

        const requestData = {
            model: config.ai.model,
            messages,
            max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 200,
            temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.2
        };

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        const plausibilityResponse = response.data?.choices?.[0]?.message?.content || '';

        logPlausibilityCheck({
            systemPrompt: parsedTemplate.systemPrompt,
            generationPrompt: parsedTemplate.generationPrompt,
            responseText: plausibilityResponse,
            durationSeconds: (Date.now() - requestStart) / 1000
        });

        const structured = parsePlausibilityOutcome(plausibilityResponse);
        if (!plausibilityResponse.trim()) {
            return null;
        }

        const safeResponse = Events.escapeHtml(plausibilityResponse.trim());
        return {
            raw: plausibilityResponse,
            html: safeResponse.replace(/\n/g, '<br>'),
            structured
        };
    } catch (error) {
        console.warn('Plausibility check failed:', error.message);
        return null;
    }
}

const attributeDefinitionsForPrompt = (() => {
    try {
        const template = new Player({ name: 'Attribute Template', description: 'Template loader' });
        const defs = template.attributeDefinitions || {};
        const context = {};
        for (const [attrName, def] of Object.entries(defs)) {
            context[attrName] = {
                description: def.description || def.label || attrName
            };
        }
        return context;
    } catch (error) {
        console.warn('Failed to load attribute definitions for NPC prompt:', error.message);
        return {};
    }
})();

const NPC_RATING_MAP = {
    'terrible': { base: 1, spread: 1 },
    'poor': { base: 4, spread: 1 },
    'below average': { base: 7, spread: 1 },
    'average': { base: 10, spread: 1 },
    'above average': { base: 13, spread: 1 },
    'excellent': { base: 16, spread: 1 },
    'legendary': { base: 19, spread: 1 }
};

function mapNpcRatingToValue(rating) {
    let normalized = 'average';
    if (rating && typeof rating === 'string') {
        normalized = rating.trim().toLowerCase();
    }

    for (const [key, config] of Object.entries(NPC_RATING_MAP)) {
        if (normalized.includes(key)) {
            return clampAttributeValue(config.base + randomIntInclusive(-config.spread, config.spread));
        }
    }

    const fallback = NPC_RATING_MAP['average'];
    return clampAttributeValue(fallback.base + randomIntInclusive(-fallback.spread, fallback.spread));
}

function clampAttributeValue(value) {
    return Math.max(1, Math.min(20, value));
}

const PRIMARY_DIRECTIONS = ['north', 'east', 'south', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest', 'in', 'out', 'forward', 'back'];
const OPPOSITE_DIRECTION_MAP = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
    up: 'down',
    down: 'up',
    northeast: 'southwest',
    southwest: 'northeast',
    northwest: 'southeast',
    southeast: 'northwest',
    in: 'out',
    out: 'in',
    forward: 'back',
    back: 'forward'
};

function normalizeDirection(direction) {
    return typeof direction === 'string' ? direction.toLowerCase().trim() : null;
}

function getOppositeDirection(direction) {
    const normalized = normalizeDirection(direction);
    if (!normalized) {
        return null;
    }
    return OPPOSITE_DIRECTION_MAP[normalized] || null;
}

function randomIntInclusive(min, max) {
    const safeMin = Math.ceil(min);
    const safeMax = Math.floor(max);
    return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function directionKeyFromName(name, fallback = null) {
    if (!name || typeof name !== 'string') {
        return fallback || `path_${randomIntInclusive(100, 999)}`;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return slug || fallback || `path_${randomIntInclusive(100, 999)}`;
}

function generateStubName(baseLocation, direction) {
    const baseName = baseLocation?.name || 'Uncharted';
    const normalizedDirection = normalizeDirection(direction);
    const directionLabel = normalizedDirection ? normalizedDirection.charAt(0).toUpperCase() + normalizedDirection.slice(1) : 'Adjacent';

    let candidate = `${baseName} ${directionLabel}`.trim();

    if (typeof Location.findByName === 'function' && Location.findByName(candidate)) {
        candidate = `${candidate} ${randomIntInclusive(2, 99)}`;
    }

    return candidate;
}

function normalizeRegionLocationName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function ensureExitConnection(fromLocation, direction, toLocation, { description, bidirectional = false, destinationRegion } = {}) {
    if (!fromLocation || !toLocation) {
        return null;
    }

    const normalizedDirection = normalizeDirection(direction) || directionKeyFromName(toLocation.name) || `path_${randomIntInclusive(100, 999)}`;
    let exit = typeof fromLocation.getExit === 'function' ? fromLocation.getExit(normalizedDirection) : null;

    if (exit) {
        if (description) {
            try {
                exit.description = description;
            } catch (_) {
                // Fallback for immutable description errors
                exit.update({ description });
            }
        }
        try {
            exit.destination = toLocation.id;
        } catch (_) {
            exit.update({ destination: toLocation.id });
        }
        try {
            exit.bidirectional = Boolean(bidirectional);
        } catch (_) {
            exit.update({ bidirectional: Boolean(bidirectional) });
        }
        if (destinationRegion !== undefined) {
            try {
                exit.destinationRegion = destinationRegion;
            } catch (_) {
                exit.destinationRegion = destinationRegion;
            }
        }
        if (bidirectional) {
            const reverseKey = getOppositeDirection(normalizedDirection) || `return_${directionKeyFromName(fromLocation.name || fromLocation.id)}`;
            let reverseDestinationRegion = null;
            const reverseRegion = findRegionByLocationId(fromLocation.id);
            if (reverseRegion) {
                reverseDestinationRegion = reverseRegion.id;
            } else if (fromLocation.stubMetadata?.regionId) {
                reverseDestinationRegion = fromLocation.stubMetadata.regionId;
            }

            ensureExitConnection(
                toLocation,
                reverseKey,
                fromLocation,
                {
                    description: `Path back to ${fromLocation.name || fromLocation.id}`,
                    bidirectional: false,
                    destinationRegion: reverseDestinationRegion
                }
            );
        }
        return exit;
    }

    const exitDescription = description || `Path to ${toLocation.name || 'an unknown location'}`;
    const newExit = new LocationExit({
        description: exitDescription,
        destination: toLocation.id,
        destinationRegion: destinationRegion !== undefined ? destinationRegion : null,
        bidirectional: Boolean(bidirectional)
    });

    if (typeof fromLocation.addExit === 'function') {
        fromLocation.addExit(normalizedDirection, newExit);
    }
    gameLocationExits.set(newExit.id, newExit);

    if (bidirectional) {
        const reverseKey = getOppositeDirection(normalizedDirection) || `return_${directionKeyFromName(fromLocation.name || fromLocation.id)}`;
        let reverseDestinationRegion = null;
        const reverseRegion = findRegionByLocationId(fromLocation.id);
        if (reverseRegion) {
            reverseDestinationRegion = reverseRegion.id;
        } else if (fromLocation.stubMetadata?.regionId) {
            reverseDestinationRegion = fromLocation.stubMetadata.regionId;
        }

        ensureExitConnection(
            toLocation,
            reverseKey,
            fromLocation,
            {
                description: `Path back to ${fromLocation.name || fromLocation.id}`,
                bidirectional: false,
                destinationRegion: reverseDestinationRegion
            }
        );
    }
    return newExit;
}

async function createLocationFromEvent({ name, originLocation = null, descriptionHint = null, directionHint = null } = {}) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
        return null;
    }

    let existing = findLocationByNameLoose(trimmedName);
    if (existing) {
        if (originLocation && directionHint) {
            ensureExitConnection(originLocation, directionHint, existing, {
                description: descriptionHint || `Path to ${existing.name || trimmedName}`,
                bidirectional: false
            });
        }
        return existing;
    }

    const settingSnapshot = getActiveSettingSnapshot();
    const stub = new Location({
        name: trimmedName,
        description: null,
        isStub: true,
        stubMetadata: {
            originLocationId: originLocation?.id || null,
            originDirection: directionHint || null,
            shortDescription: descriptionHint || `An unexplored area referred to as ${trimmedName}.`,
            locationPurpose: 'Area referenced during event-driven travel.',
            settingDescription: describeSettingForPrompt(settingSnapshot),
            allowRename: false
        }
    });

    gameLocations.set(stub.id, stub);

    if (originLocation) {
        const inferredDirection = normalizeDirection(directionHint) || directionKeyFromName(trimmedName);
        ensureExitConnection(originLocation, inferredDirection, stub, {
            description: descriptionHint || `Path to ${trimmedName}`,
            bidirectional: false
        });
    }

    const region = originLocation ? findRegionByLocationId(originLocation.id) : null;
    if (region && Array.isArray(region.locationIds) && !region.locationIds.includes(stub.id)) {
        region.locationIds.push(stub.id);
    }

    try {
        const expansion = await scheduleStubExpansion(stub);
        if (expansion?.location) {
            return expansion.location;
        }
    } catch (error) {
        console.warn(`Failed to expand event-created stub "${stub.name}":`, error.message);
    }

    return stub;
}

function pickAvailableDirections(location, exclude = []) {
    const exclusions = new Set();
    (exclude || []).map(normalizeDirection).filter(Boolean).forEach(dir => exclusions.add(dir));

    if (typeof location.getAvailableDirections === 'function') {
        for (const existingDirection of location.getAvailableDirections()) {
            const normalized = normalizeDirection(existingDirection);
            if (normalized) {
                exclusions.add(normalized);
            }
        }
    }

    return PRIMARY_DIRECTIONS.filter(direction => !exclusions.has(direction));
}

function createStubNeighbors(location, context = {}) {
    if (!location || typeof location.id !== 'string') {
        return [];
    }

    if (typeof location.hasGeneratedStubs === 'boolean' && location.hasGeneratedStubs) {
        return [];
    }

    const excludeDirections = Array.isArray(context.excludeDirections) ? context.excludeDirections : [];
    const available = pickAvailableDirections(location, excludeDirections);

    if (available.length === 0) {
        if (typeof location.markStubsGenerated === 'function') {
            location.markStubsGenerated();
        }
        return [];
    }

    const minStubs = context.minStubs || 1;
    const maxStubs = Math.max(minStubs, Math.min(context.maxStubs || 3, available.length));
    const stubCount = randomIntInclusive(minStubs, maxStubs);
    const created = [];

    for (let i = 0; i < stubCount && available.length > 0; i++) {
        const randomIndex = randomIntInclusive(0, available.length - 1);
        const direction = available.splice(randomIndex, 1)[0];
        const stubName = generateStubName(location, direction);
        const stubShortDescription = context.shortDescription
            ? `${context.shortDescription} (${direction} approach)`
            : `An unexplored area ${direction} of ${location.name || 'this location'}.`;
        const stubPurpose = context.locationPurpose || 'Extend the surrounding region for future exploration.';
        const stub = new Location({
            name: stubName,
            description: null,
            baseLevel: null,
            isStub: true,
            stubMetadata: {
                originLocationId: location.id,
                originDirection: direction,
                themeHint: context.themeHint || null,
                shortDescription: stubShortDescription,
                locationPurpose: stubPurpose,
                settingDescription: context.settingDescription || null,
                allowRename: false
            }
        });

        gameLocations.set(stub.id, stub);
        const exitDescription = `Unexplored path leading ${direction} toward ${stub.name}`;
        ensureExitConnection(location, direction, stub, { description: exitDescription, bidirectional: false });

        console.log(`🌱 Created stub location ${stub.name} (${stub.id}) to the ${direction} of ${location.name || location.id}`);
        created.push({
            id: stub.id,
            name: stub.name,
            direction
        });
    }

    if (typeof location.markStubsGenerated === 'function') {
        location.markStubsGenerated();
    }

    return created;
}

const stubExpansionPromises = new Map();

function scheduleStubExpansion(location) {
    if (!location || !location.isStub) {
        return null;
    }

    if (location.stubMetadata?.isRegionEntryStub) {
        return null;
    }

    if (stubExpansionPromises.has(location.id)) {
        return stubExpansionPromises.get(location.id);
    }

    const metadata = location.stubMetadata || {};
    const originLocation = metadata.originLocationId ? Location.get(metadata.originLocationId) : null;
    const expansionPromise = generateLocationFromPrompt({
        stubLocation: location,
        originLocation,
        locationTheme: metadata.themeHint || null,
        shortDescription: metadata.shortDescription || null,
        locationPurpose: metadata.locationPurpose || null,
        setting: metadata.settingDescription || null
    }).catch(error => {
        console.error(`Failed to expand stub location ${location.id}:`, error.message);
        throw error;
    });

    stubExpansionPromises.set(location.id, expansionPromise);

    expansionPromise.finally(() => {
        stubExpansionPromises.delete(location.id);
    });

    return expansionPromise;
}

async function expandRegionEntryStub(stubLocation) {
    if (!stubLocation || !stubLocation.isStub) {
        return null;
    }

    const metadata = stubLocation.stubMetadata || {};
    const targetRegionId = metadata.targetRegionId || null;
    if (!targetRegionId) {
        return null;
    }

    const endpoint = config.ai.endpoint;
    const apiKey = config.ai.apiKey;
    const model = config.ai.model;
    const chatEndpoint = endpoint.endsWith('/')
        ? endpoint + 'chat/completions'
        : endpoint + '/chat/completions';

    const settingDescription = metadata.settingDescription || describeSettingForPrompt(getActiveSettingSnapshot());
    const themeHint = metadata.themeHint || null;
    let regionAverageLevel = Number.isFinite(metadata.regionAverageLevel) ? metadata.regionAverageLevel : null;

    let region = regions.get(targetRegionId) || null;
    const pendingInfo = pendingRegionStubs.get(targetRegionId) || null;

    if (pendingInfo?.parentRegionId && region && !region.parentRegionId) {
        region.parentRegionId = pendingInfo.parentRegionId;
    }

    let stubPrompt = null;
    let stubResponse = null;

    if (!region || !Array.isArray(region.locationIds) || region.locationIds.length === 0) {
        const regionName = pendingInfo?.name || metadata.targetRegionName || 'Uncharted Region';
        const regionDescription = pendingInfo?.description || metadata.targetRegionDescription || 'No description available.';
        const parentRegionId = pendingInfo?.parentRegionId || metadata.targetRegionParentId || null;

        stubPrompt = renderRegionStubPrompt({
            settingDescription,
            region: {
                name: regionName,
                description: regionDescription
            }
        });

        if (!stubPrompt) {
            return null;
        }

        const messages = [
            { role: 'system', content: stubPrompt.systemPrompt },
            { role: 'user', content: stubPrompt.generationPrompt }
        ];

        const requestData = {
            model,
            messages,
            max_tokens: 4000,
            temperature: config.ai.temperature || 0.7
        };

        try {
            console.log(`🌐 Generating locations for region stub ${regionName} (${targetRegionId})...`);
            const requestStart = Date.now();
            const response = await axios.post(chatEndpoint, requestData, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 90000
            });

            stubResponse = response.data?.choices?.[0]?.message?.content || '';
            const durationSeconds = (Date.now() - requestStart) / 1000;

            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
                const logPath = path.join(logDir, `region_stub_${targetRegionId}_${timestamp}.log`);
                const logParts = [
                    formatDurationLine(durationSeconds),
                    '=== REGION STUB PROMPT ===',
                    stubPrompt.generationPrompt,
                    '\n=== REGION STUB RESPONSE ===',
                    stubResponse,
                    '\n'
                ];
                fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
            } catch (logError) {
                console.warn('Failed to log region stub generation:', logError.message);
            }
        } catch (error) {
            console.warn('Failed to generate region stub locations:', error.message);
            return null;
        }

        const locationDefinitions = parseRegionStubLocations(stubResponse);
        if (!locationDefinitions.length) {
            console.warn('Region stub generation returned no locations.');
            return null;
        }

        regionAverageLevel = regionAverageLevel ?? (Number.isFinite(pendingInfo?.relativeLevel)
            ? clampLevel((metadata.regionAverageLevel || 1) + pendingInfo.relativeLevel, metadata.regionAverageLevel || 1)
            : (metadata.regionAverageLevel || 1));

        region = new Region({
            id: targetRegionId,
            name: pendingInfo?.name || metadata.targetRegionName || 'Uncharted Region',
            description: pendingInfo?.description || metadata.targetRegionDescription || 'No description available.',
            locations: locationDefinitions.map(def => ({
                name: def.name,
                description: def.description,
                exits: def.exits,
                relativeLevel: def.relativeLevel
            })),
            locationIds: [],
            entranceLocationId: null,
            parentRegionId: parentRegionId,
            averageLevel: Number.isFinite(regionAverageLevel) ? regionAverageLevel : null
        });

        regions.set(region.id, region);

        let stubMap = new Map();
        try {
            stubMap = await instantiateRegionLocations({
                region,
                themeHint,
                regionAverageLevel,
                settingDescription,
                chatEndpoint,
                model,
                apiKey
            });
        } catch (instantiationError) {
            console.warn('Failed to instantiate region from stub:', instantiationError.message);
        }

        const entranceInfo = await chooseRegionEntrance({
            region,
            stubMap,
            systemPrompt: stubPrompt.systemPrompt,
            generationPrompt: stubPrompt.generationPrompt,
            aiResponse: stubResponse,
            chatEndpoint,
            model,
            apiKey
        });

        const entranceLocation = entranceInfo.location || (entranceInfo.locationId ? gameLocations.get(entranceInfo.locationId) : null);
        if (!entranceLocation) {
            return null;
        }

        await finalizeRegionEntry({
            stubLocation,
            entranceLocation,
            region,
            originDescription: metadata.shortDescription || stubLocation.description || `Path to ${region.name}`
        });

        pendingRegionStubs.delete(targetRegionId);
        return entranceLocation;
    }

    // Region already exists
    const entranceLocationId = region.entranceLocationId || null;
    let entranceLocation = entranceLocationId ? gameLocations.get(entranceLocationId) : null;
    if (!entranceLocation) {
        entranceLocation = region.locationIds
            .map(id => gameLocations.get(id))
            .find(Boolean);
        if (entranceLocation) {
            region.entranceLocationId = entranceLocation.id;
        }
    }

    if (!entranceLocation) {
        return null;
    }

    await finalizeRegionEntry({
        stubLocation,
        entranceLocation,
        region,
        originDescription: metadata.shortDescription || stubLocation.description || `Path to ${region.name}`
    });

    pendingRegionStubs.delete(targetRegionId);
    return entranceLocation;
}

async function finalizeRegionEntry({ stubLocation, entranceLocation, region, originDescription }) {
    if (!stubLocation || !entranceLocation) {
        return;
    }

    const metadata = stubLocation.stubMetadata || {};
    const originLocation = metadata.originLocationId ? gameLocations.get(metadata.originLocationId) : null;
    const originDirection = metadata.originDirection || null;

    if (originLocation) {
        ensureExitConnection(originLocation, originDirection || directionKeyFromName(entranceLocation.name), entranceLocation, {
            description: originDescription,
            bidirectional: true,
            destinationRegion: region.id
        });
    }

    if (originLocation && typeof originLocation.removeExit === 'function' && originDirection) {
        // ensureExitConnection already handled replacement; no explicit removal required.
    }

    const entranceMetadata = entranceLocation.stubMetadata ? { ...entranceLocation.stubMetadata } : {};
    if (metadata.originLocationId) {
        entranceMetadata.originLocationId = metadata.originLocationId;
    }
    if (metadata.originDirection) {
        entranceMetadata.originDirection = metadata.originDirection;
    }
    if (metadata.settingDescription && !entranceMetadata.settingDescription) {
        entranceMetadata.settingDescription = metadata.settingDescription;
    }
    entranceLocation.stubMetadata = entranceMetadata;

    const stubDirections = typeof stubLocation.getAvailableDirections === 'function'
        ? stubLocation.getAvailableDirections()
        : [];

    for (const direction of stubDirections) {
        const exit = stubLocation.getExit(direction);
        if (!exit) {
            continue;
        }

        if (originLocation && exit.destination === originLocation.id) {
            continue;
        }

        const targetLocation = gameLocations.get(exit.destination);
        if (!targetLocation) {
            continue;
        }

        const description = exit.description || `Path to ${targetLocation.name || exit.destination}`;
        ensureExitConnection(entranceLocation, direction, targetLocation, {
            description,
            bidirectional: exit.bidirectional !== false,
            destinationRegion: exit.destinationRegion || null
        });
    }

    for (const direction of stubDirections) {
        const exit = stubLocation.getExit(direction);
        if (exit) {
            gameLocationExits.delete(exit.id);
        }
    }

    gameLocations.delete(stubLocation.id);

    const currentRegionLocationIds = region.locationIds || [];
    if (Array.isArray(currentRegionLocationIds) && currentRegionLocationIds.includes(stubLocation.id)) {
        region.locationIds = currentRegionLocationIds.filter(id => id !== stubLocation.id);
    }

    if (originLocation && typeof originLocation.removeNpcId === 'function') {
        // no-op, placeholder in case stub stored NPCs
    }
}

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
const e = require('express');

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

// Add JSON escape filter for ComfyUI templates
imagePromptEnv.addFilter('json', function (str) {
    if (typeof str !== 'string') {
        str = String(str);
    }
    // Properly escape for JSON without surrounding quotes
    return JSON.stringify(str).slice(1, -1);
});

// Function to parse XML template and extract prompts
function parseXMLTemplate(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        // Check for parsing errors
        const errorNode = doc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            throw new Error('XML parsing error: ' + errorNode.textContent);
        }

        const result = {};

        // Extract systemPrompt as raw inner XML/text (do not parse child nodes)
        const systemPromptNode = doc.getElementsByTagName('systemPrompt')[0];
        if (systemPromptNode) {
            result.systemPrompt = Utils.innerXML(systemPromptNode).trim();
        }

        // Extract generationPrompt as raw inner XML/text
        let generationPromptNode = doc.getElementsByTagName('generationPrompt')[0];

        if (generationPromptNode) {
            result.generationPrompt = Utils.innerXML(generationPromptNode).trim();
        }

        const maxTokensNode = doc.getElementsByTagName('maxTokens')[0];
        if (maxTokensNode) {
            const value = parseInt(maxTokensNode.textContent.trim(), 10);
            if (!Number.isNaN(value)) {
                result.maxTokens = value;
            }
        }

        const temperatureNode = doc.getElementsByTagName('temperature')[0];
        if (temperatureNode) {
            const value = parseFloat(temperatureNode.textContent.trim());
            if (!Number.isNaN(value)) {
                result.temperature = value;
            }
        }

        // Extract role (optional)
        const roleNode = doc.getElementsByTagName('role')[0];
        if (roleNode) {
            result.role = roleNode.textContent.trim();
        }

        // Extract description (optional)
        const descriptionNode = doc.getElementsByTagName('description')[0];
        if (descriptionNode) {
            result.description = descriptionNode.textContent.trim();
        }

        return result;
    } catch (error) {
        console.error('Error parsing XML template:', error);
        throw error;
    }
}

// Function to render system prompt from template
function renderSystemPrompt(settingInfo = null) {
    try {
        const templateName = config.gamemaster.promptTemplate;
        let variables = { ...config.gamemaster.promptVariables } || {};

        // If a SettingInfo object is provided, merge its prompt variables
        if (settingInfo && typeof settingInfo.getPromptVariables === 'function') {
            const settingVariables = settingInfo.getPromptVariables();
            variables = { ...variables, ...settingVariables };

            //console.log('Using SettingInfo variables:', settingVariables);
        }

        // Add current player information if available
        if (currentPlayer) {
            variables.playerName = currentPlayer.name;
            variables.playerLevel = currentPlayer.level;
            variables.playerDescription = currentPlayer.description;
        }

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // If the template is a .xml.njk file, parse the XML and extract systemPrompt
        if (templateName.endsWith('.xml.njk')) {
            const parsedXML = parseXMLTemplate(renderedTemplate);
            return parsedXML.systemPrompt || renderedTemplate;
        }

        // If the template is a .yaml.njk file, parse the YAML and extract systemPrompt (backward compatibility)
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
        const templateName = 'player-portrait.xml.njk';
        const activeSetting = getActiveSettingSnapshot();

        if (!player) {
            throw new Error('Player object is required');
        }

        const settingDescription = describeSettingForPrompt(activeSetting);
        const attributeLines = player.getAttributeNames().map(name => {
            const value = player.getAttributeTextValue(name);
            const label = name.charAt(0).toUpperCase() + name.slice(1);
            return `${label}: ${value}`;
        }).join('\n');

        const characterDescription = [
            `${player.name || 'Unknown'} (Level ${player.level || 1})`,
            player.description || 'No description provided.',
            attributeLines ? `Attributes:\n${attributeLines}` : ''
        ].filter(Boolean).join('\n\n');

        const variables = {
            setting: settingDescription,
            characterDescription
        };

        const renderedTemplate = promptEnv.render(templateName, variables);
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedXML.systemPrompt;
        const generationPrompt = parsedXML.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Missing portrait system or generation prompt');
        }

        return {
            systemPrompt: systemPrompt.trim(),
            generationPrompt: generationPrompt.trim()
        };

    } catch (error) {
        console.error('Error rendering player portrait template:', error);
        return {
            systemPrompt: 'You are a specialized prompt generator for creating fantasy RPG character portraits.',
            generationPrompt: `Create an image prompt for ${player ? player.name : 'an unnamed character'}: ${player ? player.description : 'A mysterious adventurer.'}`
        };
    }
}

function getAllPlayers(ids) {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.map(id => players.get(id)).filter(Boolean);
}

function findRegionByLocationId(locationId) {
    if (!locationId) {
        return null;
    }
    for (const region of regions.values()) {
        if (Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) {
            return region;
        }
    }
    return null;
}

async function generateInventoryForCharacter({ character, characterDescriptor = {}, region = null, location = null, chatEndpoint, model, apiKey }) {
    try {
        const settingSnapshot = getActiveSettingSnapshot();
        if (!settingSnapshot) {
            if (!character || !character.isNPC) {
                console.log('🧺 Skipping player inventory generation - no active setting configured.');
                return [];
            }
        }
        const settingDescription = describeSettingForPrompt(settingSnapshot);

        const renderedTemplate = renderInventoryPrompt({
            setting: settingDescription,
            region: region ? { name: region.name, description: region.description } : null,
            location: location ? { name: location.name, description: location.description || location.stubMetadata?.blueprintDescription } : null,
            character: {
                name: character.name,
                role: characterDescriptor.role || characterDescriptor.class || 'citizen',
                description: character.description,
                class: characterDescriptor.class || characterDescriptor.role || 'citizen',
                level: character.level || 1,
                race: characterDescriptor.race || 'human'
            }
        });

        if (!renderedTemplate) {
            return [];
        }

        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedTemplate.systemPrompt;
        const generationPrompt = parsedTemplate.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Inventory template missing prompts');
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        const resolvedModel = model || config.ai.model;
        const resolvedApiKey = apiKey || config.ai.apiKey;
        const resolvedEndpoint = chatEndpoint || (config.ai.endpoint.endsWith('/')
            ? `${config.ai.endpoint}chat/completions`
            : `${config.ai.endpoint}/chat/completions`);

        if (!resolvedModel || !resolvedApiKey || !resolvedEndpoint) {
            throw new Error('Missing AI configuration for inventory generation');
        }

        const requestData = {
            model: resolvedModel,
            messages,
            max_tokens: 1200,
            temperature: config.ai.temperature || 0.7
        };

        const requestStart = Date.now();
        const response = await axios.post(resolvedEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${resolvedApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const inventoryContent = response.data?.choices?.[0]?.message?.content;
        if (!inventoryContent) {
            throw new Error('Empty inventory response from AI');
        }

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        const items = parseInventoryItems(inventoryContent);

        const createdThings = [];
        for (const item of items) {
            if (!item.name) continue;
            const detailParts = [];
            if (item.type) detailParts.push(`Type: ${item.type}`);
            if (item.slot && item.slot.toLowerCase() !== 'n/a') detailParts.push(`Slot: ${item.slot}`);
            if (item.rarity) detailParts.push(`Rarity: ${item.rarity}`);
            if (item.value) detailParts.push(`Value: ${item.value}`);
            if (item.weight) detailParts.push(`Weight: ${item.weight}`);
            if (item.attributeBonuses?.length) {
                const bonusSummary = item.attributeBonuses
                    .map(bonus => {
                        const attr = bonus.attribute || 'Attribute';
                        const value = Number.isFinite(bonus.bonus) ? bonus.bonus : 0;
                        const sign = value >= 0 ? `+${value}` : `${value}`;
                        return `${attr} ${sign}`;
                    })
                    .join(', ');
                if (bonusSummary) {
                    detailParts.push(`Bonuses: ${bonusSummary}`);
                }
            }
            if (item.causeStatusEffect) {
                const effectName = item.causeStatusEffect.name || 'Status Effect';
                const effectDetail = item.causeStatusEffect.description || '';
                const combined = [effectName, effectDetail].filter(Boolean).join(' - ');
                detailParts.push(`Status Effect: ${combined}`);
            }
            const relativeLevel = Number.isFinite(item.relativeLevel)
                ? Math.max(-10, Math.min(10, Math.round(item.relativeLevel)))
                : 0;
            const ownerLevel = Number.isFinite(character?.level) ? character.level : startingPlayerLevel;
            const computedLevel = clampLevel(ownerLevel + relativeLevel, ownerLevel);
            if (item.properties) detailParts.push(`Properties: ${item.properties}`);
            const extendedDescription = [item.description, detailParts.join(' | ')].filter(Boolean).join(' ');

            try {
                const metadata = sanitizeMetadataObject({
                    rarity: item.rarity || null,
                    itemType: item.type || null,
                    value: item.value || null,
                    weight: item.weight || null,
                    properties: item.properties || null,
                    slot: item.slot || null,
                    attributeBonuses: item.attributeBonuses && item.attributeBonuses.length ? item.attributeBonuses : null,
                    causeStatusEffect: item.causeStatusEffect || null,
                    relativeLevel,
                    level: computedLevel
                });

                const thing = new Thing({
                    name: item.name,
                    description: extendedDescription || item.description || 'Inventory item',
                    thingType: 'item',
                    rarity: item.rarity || null,
                    itemTypeDetail: item.type || null,
                    slot: item.slot || null,
                    attributeBonuses: item.attributeBonuses,
                    causeStatusEffect: item.causeStatusEffect,
                    level: computedLevel,
                    relativeLevel,
                    metadata
                });
                things.set(thing.id, thing);
                character.addInventoryItem(thing, { suppressNpcEquip: true });
                try {
                    const metadata = thing.metadata || {};
                    let metadataChanged = false;
                    if (character?.id && metadata.ownerId !== character.id) {
                        metadata.ownerId = character.id;
                        metadataChanged = true;
                    }
                    const locationId = location?.id || null;
                    if (locationId && metadata.locationId !== locationId) {
                        metadata.locationId = locationId;
                        metadataChanged = true;
                    }
                    if (metadataChanged) {
                        thing.metadata = metadata;
                    }

                    if (shouldGenerateThingImage(thing)) {
                        if (!thing.imageId || !hasExistingImage(thing.imageId)) {
                            thing.imageId = null;
                        }
                    } else {
                        console.log(`🎒 Skipping image generation for item ${thing.name} (${thing.id}) - not in player inventory`);
                    }
                } catch (imageError) {
                    console.warn('Failed to schedule thing image generation:', imageError.message);
                }
                createdThings.push(thing);
            } catch (error) {
                console.warn(`Failed to create Thing for inventory item "${item.name}":`, error.message);
            }
        }

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `inventory_${character.id}.log`);
            const logParts = [
                formatDurationLine(apiDurationSeconds),
                '=== INVENTORY PROMPT ===',
                generationPrompt,
                '\n=== INVENTORY RESPONSE ===',
                inventoryContent,
                '\n=== PARSED ITEMS ===',
                JSON.stringify(items, null, 2),
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
        } catch (logErr) {
            console.warn('Failed to write inventory log:', logErr.message);
        }

        try {
            await equipBestGearForCharacter({
                character,
                characterDescriptor,
                region,
                location,
                settingDescription,
                endpoint: resolvedEndpoint,
                model: resolvedModel,
                apiKey: resolvedApiKey
            });
        } catch (equipError) {
            console.warn('Failed to run equip-best flow:', equipError.message);
        }

        return createdThings;
    } catch (error) {
        console.warn(`Inventory generation failed for character ${character?.name || 'unknown'}:`, error);
        return [];
    }
}

async function generateItemsByNames({ itemNames = [], location = null, owner = null, region = null } = {}) {
    try {
        const normalized = Array.from(new Set(
            (itemNames || [])
                .map(name => typeof name === 'string' ? name.trim() : '')
                .filter(Boolean)
        ));

        if (!normalized.length) {
            return [];
        }

        const missing = normalized.filter(name => !findThingByName(name));
        if (!missing.length) {
            return [];
        }

        const settingSnapshot = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(settingSnapshot);
        let resolvedLocation = location || null;
        if (!resolvedLocation && owner?.currentLocation) {
            try {
                resolvedLocation = Location.get(owner.currentLocation);
            } catch (_) {
                resolvedLocation = null;
            }
        }
        const resolvedRegion = region || (resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null);

        const characterDescriptor = owner ? {
            name: owner.name,
            role: owner.class || owner.race || 'adventurer',
            description: owner.description,
            class: owner.class || owner.race || 'adventurer',
            level: owner.level || 1,
            race: owner.race || 'human'
        } : {
            name: resolvedLocation ? `${resolvedLocation.name} cache` : 'Scene cache',
            role: 'environmental stash',
            description: resolvedLocation?.description || 'Items discovered during the current scene.',
            class: 'location',
            level: currentPlayer?.level || 1,
            race: resolvedRegion?.name || 'n/a'
        };

        const renderedTemplate = renderInventoryPrompt({
            setting: settingDescription,
            region: resolvedRegion ? { name: resolvedRegion.name, description: resolvedRegion.description } : null,
            location: resolvedLocation ? { name: resolvedLocation.name, description: resolvedLocation.description || resolvedLocation.stubMetadata?.blueprintDescription } : null,
            character: characterDescriptor
        });

        if (!renderedTemplate) {
            throw new Error('Inventory prompt template could not be rendered');
        }

        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedTemplate.systemPrompt;
        let generationPrompt = parsedTemplate.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Inventory template missing prompts');
        }

        const quotedNames = missing.map(name => `"${name}"`).join(', ');
        generationPrompt += `\nOnly generate detailed entries for the following item names and keep the spelling exactly as provided: ${quotedNames}.`;
        generationPrompt += `\nOutput exactly ${missing.length} <item> entries using the same XML structure and do not invent additional items.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        const endpoint = config.ai.endpoint;
        const apiKey = config.ai.apiKey;
        const model = config.ai.model;

        const chatEndpoint = endpoint.endsWith('/') ?
            `${endpoint}chat/completions` :
            `${endpoint}/chat/completions`;

        const requestData = {
            model,
            messages,
            max_tokens: 900,
            temperature: config.ai.temperature || 0.7
        };

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const inventoryContent = response.data?.choices?.[0]?.message?.content;
        if (!inventoryContent || !inventoryContent.trim()) {
            throw new Error('Empty item generation response from AI');
        }

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        const parsedItems = parseInventoryItems(inventoryContent) || [];
        const itemsByName = new Map();
        for (const item of parsedItems) {
            if (!item?.name) continue;
            itemsByName.set(item.name.trim().toLowerCase(), item);
        }

        const created = [];
        for (const name of missing) {
            const lookupKey = name.trim().toLowerCase();
            const itemData = itemsByName.get(lookupKey) || parsedItems.find(it => it?.name) || null;
            const descriptionParts = [];
            if (itemData?.description) {
                descriptionParts.push(itemData.description.trim());
            }
            const detailParts = [];
            if (itemData?.type) detailParts.push(`Type: ${itemData.type}`);
            if (itemData?.rarity) detailParts.push(`Rarity: ${itemData.rarity}`);
            if (itemData?.value) detailParts.push(`Value: ${itemData.value}`);
            if (itemData?.weight) detailParts.push(`Weight: ${itemData.weight}`);
            if (itemData?.slot && itemData.slot.toLowerCase() !== 'n/a') detailParts.push(`Slot: ${itemData.slot}`);
            if (itemData?.properties) detailParts.push(`Properties: ${itemData.properties}`);
            if (itemData?.attributeBonuses?.length) {
                const bonusSummary = itemData.attributeBonuses
                    .map(bonus => {
                        const attr = bonus.attribute || 'Attribute';
                        const value = Number.isFinite(bonus.bonus) ? bonus.bonus : 0;
                        const sign = value >= 0 ? `+${value}` : `${value}`;
                        return `${attr} ${sign}`;
                    })
                    .join(', ');
                if (bonusSummary) {
                    detailParts.push(`Bonuses: ${bonusSummary}`);
                }
            }
            if (itemData?.causeStatusEffect) {
                const effectName = itemData.causeStatusEffect.name || 'Status Effect';
                const effectDescription = itemData.causeStatusEffect.description || '';
                const effectCombined = [effectName, effectDescription].filter(Boolean).join(' - ');
                detailParts.push(`Status Effect: ${effectCombined}`);
            }
            if (detailParts.length) {
                descriptionParts.push(detailParts.join(' | '));
            }
            const composedDescription = descriptionParts.join(' ') || `An item named ${name}.`;

            const relativeLevel = Number.isFinite(itemData?.relativeLevel)
                ? Math.max(-10, Math.min(10, Math.round(itemData.relativeLevel)))
                : 0;
            const baseReference = owner?.level
                ? owner.level
                : (location?.baseLevel
                    ? location.baseLevel
                    : (region?.averageLevel || currentPlayer?.level || 1));
            const computedLevel = clampLevel(baseReference + relativeLevel, baseReference);

            const metadata = sanitizeMetadataObject({
                rarity: itemData?.rarity || null,
                itemType: itemData?.type || null,
                value: itemData?.value || null,
                weight: itemData?.weight || null,
                properties: itemData?.properties || null,
                slot: itemData?.slot || null,
                attributeBonuses: itemData?.attributeBonuses && itemData.attributeBonuses.length ? itemData.attributeBonuses : null,
                causeStatusEffect: itemData?.causeStatusEffect || null,
                relativeLevel,
                level: computedLevel
            });

            const thing = new Thing({
                name,
                description: composedDescription,
                thingType: 'item',
                rarity: itemData?.rarity || null,
                itemTypeDetail: itemData?.type || null,
                slot: itemData?.slot || null,
                attributeBonuses: itemData?.attributeBonuses,
                causeStatusEffect: itemData?.causeStatusEffect,
                level: computedLevel,
                relativeLevel,
                metadata
            });
            things.set(thing.id, thing);
            created.push(thing);
        }

        for (const thing of created) {
            const metadata = thing.metadata || {};
            if (owner && typeof owner.addInventoryItem === 'function') {
                owner.addInventoryItem(thing);
                metadata.ownerId = owner.id;
                delete metadata.locationId;
                thing.metadata = metadata;
            } else if (resolvedLocation) {
                metadata.locationId = resolvedLocation.id;
                delete metadata.ownerId;
                thing.metadata = metadata;
                if (typeof resolvedLocation.addThingId === 'function') {
                    resolvedLocation.addThingId(thing.id);
                }
            }

            if (shouldGenerateThingImage(thing)) {
                if (!thing.imageId || !hasExistingImage(thing.imageId)) {
                    thing.imageId = null;
                }
            }
        }

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `event_items_${Date.now()}.log`);
            const logParts = [
                formatDurationLine(apiDurationSeconds),
                '=== ITEM GENERATION PROMPT ===',
                generationPrompt,
                '\n=== ITEM GENERATION RESPONSE ===',
                inventoryContent,
                '\n=== GENERATED ITEMS ===',
                JSON.stringify(created.map(item => item.toJSON ? item.toJSON() : { id: item.id, name: item.name }), null, 2),
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log item generation:', logError.message);
        }

        return created;
    } catch (error) {
        console.warn('Failed to generate detailed items from event:', error.message);

        const fallbacks = [];
        for (const name of itemNames || []) {
            if (!name || findThingByName(name)) {
                continue;
            }
            try {
                const thing = new Thing({
                    name,
                    description: `An item called ${name}.`,
                    thingType: 'item',
                    metadata: {}
                });
                things.set(thing.id, thing);
                const fallbackMetadata = thing.metadata || {};
                if (owner && typeof owner.addInventoryItem === 'function') {
                    owner.addInventoryItem(thing);
                    fallbackMetadata.ownerId = owner.id;
                    delete fallbackMetadata.locationId;
                } else if (resolvedLocation) {
                    fallbackMetadata.locationId = resolvedLocation.id;
                    delete fallbackMetadata.ownerId;
                }
                thing.metadata = fallbackMetadata;
                if (!fallbackMetadata.ownerId && fallbackMetadata.locationId && typeof resolvedLocation?.addThingId === 'function') {
                    resolvedLocation.addThingId(thing.id);
                }
                fallbacks.push(thing);
            } catch (creationError) {
                console.warn(`Failed to create fallback item for "${name}":`, creationError.message);
            }
        }
        return fallbacks;
    }
}

function renderLocationNpcPrompt(location, options = {}) {
    try {
        const templateName = 'location-generator-npcs.xml.njk';
        return promptEnv.render(templateName, {
            locationName: location.name || 'Unknown Location',
            locationDescription: location.description || 'No description provided.',
            regionTheme: options.regionTheme || null,
            desiredCount: options.desiredCount || 3,
            existingNpcsInThisLocation: options.existingNpcsInThisLocation || [],
            existingNpcsInOtherLocations: options.existingNpcsInOtherLocations || [],
            existingNpcsInOtherRegions: options.existingNpcsInOtherRegions || [],
            attributeDefinitions: options.attributeDefinitions || attributeDefinitionsForPrompt,
            bannedWords: options.bannedWords || getBannedNpcWords()
        });
    } catch (error) {
        console.error('Error rendering location NPC template:', error);
        return null;
    }
}

function renderRegionNpcPrompt(region, options = {}) {
    try {
        const templateName = 'region-generator-important-npcs.njk';
        const safeRegion = region ? {
            id: region.id,
            name: region.name,
            description: region.description
        } : { id: null, name: 'Unknown Region', description: '' };

        return promptEnv.render(templateName, {
            region: safeRegion,
            allLocationsInRegion: options.allLocationsInRegion || [],
            existingNpcsInOtherRegions: options.existingNpcsInOtherRegions || [],
            attributeDefinitions: options.attributeDefinitions || attributeDefinitionsForPrompt,
            bannedWords: options.bannedWords || getBannedNpcWords()
        });
    } catch (error) {
        console.error('Error rendering region NPC template:', error);
        return null;
    }
}

function renderSingleNpcPrompt({ npcName, settingDescription, location = null, region = null, existingNpcSummaries = [] } = {}) {
    try {
        const safeRegion = region ? {
            name: region.name || 'Unknown Region',
            description: region.description || 'No description provided.'
        } : { name: 'Unknown Region', description: 'No description provided.' };

        const safeLocation = location ? {
            name: location.name || 'Unknown Location',
            description: location.description || location.stubMetadata?.blueprintDescription || 'No description provided.'
        } : { name: 'Unknown Location', description: 'No description provided.' };

        return promptEnv.render('npc-generator-single.xml.njk', {
            npcName,
            settingDescription: settingDescription || describeSettingForPrompt(getActiveSettingSnapshot()),
            region: safeRegion,
            location: safeLocation,
            existingNpcSummaries: existingNpcSummaries || [],
            attributeDefinitions: attributeDefinitionsForPrompt
        });
    } catch (error) {
        console.error('Error rendering single NPC template:', error);
        return null;
    }
}

function summarizeNpcForPrompt(npc) {
    if (!npc) {
        return null;
    }
    const short = npc.shortDescription && npc.shortDescription.trim()
        ? npc.shortDescription.trim()
        : (npc.description ? npc.description.split(/[.!?]/)[0]?.trim() || '' : '');
    return {
        name: npc.name,
        shortDescription: short
    };
}

async function generateNpcFromEvent({ name, location = null, region = null } = {}) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
        return null;
    }

    const normalizedKey = trimmedName.toLowerCase();
    if (npcGenerationPromises.has(normalizedKey)) {
        return npcGenerationPromises.get(normalizedKey);
    }

    const generationPromise = (async () => {
        const existing = findActorByName(trimmedName);
        if (existing) {
            return existing;
        }

        let resolvedLocation = location || null;
        if (!resolvedLocation && currentPlayer?.currentLocation) {
            try {
                resolvedLocation = Location.get(currentPlayer.currentLocation);
            } catch (_) {
                resolvedLocation = null;
            }
        }

        const resolvedRegion = region || (resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null);
        const settingSnapshot = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(settingSnapshot);

        const locationNpcIds = Array.isArray(resolvedLocation?.npcIds) ? resolvedLocation.npcIds : [];
        const existingNpcSummaries = [];
        for (const npcId of locationNpcIds) {
            const npc = players.get(npcId);
            const summary = summarizeNpcForPrompt(npc);
            if (summary) {
                existingNpcSummaries.push(summary);
            }
        }

        if (resolvedRegion && Array.isArray(resolvedRegion.locationIds)) {
            for (const locId of resolvedRegion.locationIds) {
                if (resolvedLocation && locId === resolvedLocation.id) {
                    continue;
                }
                const loc = gameLocations.get(locId);
                if (!loc || !Array.isArray(loc.npcIds)) {
                    continue;
                }
                for (const npcId of loc.npcIds) {
                    const npc = players.get(npcId);
                    const summary = summarizeNpcForPrompt(npc);
                    if (summary) {
                        existingNpcSummaries.push(summary);
                    }
                }
            }
        }

        const renderedTemplate = renderSingleNpcPrompt({
            npcName: trimmedName,
            settingDescription,
            location: resolvedLocation,
            region: resolvedRegion,
            existingNpcSummaries: existingNpcSummaries.slice(0, 25)
        });

        if (!renderedTemplate) {
            throw new Error('Failed to render single NPC prompt');
        }

        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedTemplate.systemPrompt;
        const generationPrompt = parsedTemplate.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Single NPC template missing prompts');
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        const endpoint = config.ai.endpoint;
        const apiKey = config.ai.apiKey;
        const model = config.ai.model;
        const chatEndpoint = endpoint.endsWith('/') ?
            `${endpoint}chat/completions` :
            `${endpoint}/chat/completions`;

        const requestData = {
            model,
            messages,
            max_tokens: 1600,
            temperature: config.ai.temperature || 0.7
        };

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 35000
        });

        const npcResponse = response.data?.choices?.[0]?.message?.content;
        if (!npcResponse || !npcResponse.trim()) {
            throw new Error('Empty NPC generation response');
        }

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `npc_single_${Date.now()}.log`);
            const logParts = [
                formatDurationLine(apiDurationSeconds),
                '=== SINGLE NPC PROMPT ===',
                generationPrompt,
                '\n=== SINGLE NPC RESPONSE ===',
                npcResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log single NPC generation:', logError.message);
        }

        const parsedNpcs = parseLocationNpcs(npcResponse);
        const npcData = parsedNpcs && parsedNpcs.length ? parsedNpcs[0] : {
            description: `${trimmedName} steps into the scene with purpose.`,
            shortDescription: '',
            role: 'mysterious figure'
        };

        const attributes = {};
        const attrSource = npcData?.attributes || {};
        for (const attrName of Object.keys(attributeDefinitionsForPrompt)) {
            const lowerKey = attrName.toLowerCase();
            const rating = attrSource[attrName] ?? attrSource[lowerKey];
            attributes[attrName] = mapNpcRatingToValue(rating);
        }

        const npc = new Player({
            name: trimmedName,
            description: npcData?.description || `${trimmedName} is drawn into the story.`,
            shortDescription: npcData?.shortDescription || '',
            class: npcData?.class || npcData?.role || 'citizen',
            race: npcData?.race || 'human',
            level: 1,
            location: resolvedLocation?.id || null,
            attributes,
            isNPC: true,
            healthAttribute: npcData?.healthAttribute
        });

        const locationBaseLevel = Number.isFinite(resolvedLocation?.baseLevel)
            ? resolvedLocation.baseLevel
            : (Number.isFinite(resolvedRegion?.averageLevel) ? resolvedRegion.averageLevel : (currentPlayer?.level || 1));
        const relativeLevel = Number.isFinite(npcData?.relativeLevel) ? npcData.relativeLevel : 0;
        const npcLevel = clampLevel(locationBaseLevel + relativeLevel, locationBaseLevel);
        try {
            npc.setLevel(npcLevel);
        } catch (_) {
            // ignore failures to adjust level
        }

        players.set(npc.id, npc);

        if (resolvedLocation && typeof resolvedLocation.addNpcId === 'function') {
            resolvedLocation.addNpcId(npc.id);
        }

        const inventoryDescriptor = {
            role: npcData?.role || npcData?.class || 'citizen',
            class: npcData?.class || npcData?.role || 'citizen',
            race: npcData?.race || 'human'
        };

        try {
            await generateInventoryForCharacter({
                character: npc,
                characterDescriptor: inventoryDescriptor,
                region: resolvedRegion,
                location: resolvedLocation,
                chatEndpoint,
                model,
                apiKey
            });
        } catch (inventoryError) {
            console.warn('Failed to generate inventory for new NPC:', inventoryError.message);
        }

        if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
            npc.imageId = null;
        }

        if (resolvedLocation) {
            queueNpcAssetsForLocation(resolvedLocation);
        }

        return npc;
    })().catch(error => {
        console.warn(`NPC generation failed for ${name}:`, error.message);

        const fallbackExisting = findActorByName(name);
        if (fallbackExisting) {
            return fallbackExisting;
        }

        try {
            const fallbackNpc = new Player({
                name,
                description: `${name} arrives on the scene.`,
                level: 1,
                location: location?.id || null,
                isNPC: true
            });
            players.set(fallbackNpc.id, fallbackNpc);
            if (location && typeof location.addNpcId === 'function') {
                location.addNpcId(fallbackNpc.id);
            }
            return fallbackNpc;
        } catch (creationError) {
            console.warn('Failed to create fallback NPC:', creationError.message);
            return null;
        }
    }).finally(() => {
        npcGenerationPromises.delete(normalizedKey);
    });

    npcGenerationPromises.set(normalizedKey, generationPromise);
    return generationPromise;
}

function renderInventoryPrompt(context = {}) {
    try {
        const templateName = 'inventory-generator.njk';
        const gearSlotTypes = getGearSlotTypes();
        const attributeNames = Object.keys(attributeDefinitionsForPrompt || {})
            .filter(name => typeof name === 'string' && name.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return promptEnv.render(templateName, {
            setting: context.setting || 'A mysterious fantasy realm.',
            region: {
                regionName: context.region?.name || 'Unknown Region',
                regionDescription: context.region?.description || 'No description provided.'
            },
            location: {
                name: context.location?.name || 'Unknown Location',
                description: context.location?.description || 'No description provided.'
            },
            character: {
                name: context.character?.name || 'Unnamed Character',
                role: context.character?.role || context.character?.class || 'citizen',
                description: context.character?.description || 'No description available.',
                class: context.character?.class || 'citizen',
                level: context.character?.level || 1,
                race: context.character?.race || 'human'
            },
            gearSlots: gearSlotTypes,
            equipmentSlots: gearSlotTypes,
            attributeDefinitions: attributeDefinitionsForPrompt,
            attributes: attributeNames
        });
    } catch (error) {
        console.error('Error rendering inventory template:', error);
        return null;
    }
}

function getGearSlotTypes() {
    try {
        const definitions = Player.gearSlotDefinitions;
        if (!definitions || !(definitions.byType instanceof Map)) {
            return [];
        }
        const types = Array.from(definitions.byType.keys())
            .filter(type => typeof type === 'string' && type.trim())
            .map(type => type.trim());
        return types.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        console.warn('Failed to resolve gear slot types:', error.message);
        return [];
    }
}

function getGearSlotNames() {
    try {
        const definitions = Player.gearSlotDefinitions;
        if (!definitions) {
            return [];
        }
        const slotSet = new Set();

        if (definitions.byType instanceof Map) {
            for (const names of definitions.byType.values()) {
                if (Array.isArray(names)) {
                    names.forEach(name => {
                        if (typeof name === 'string' && name.trim()) {
                            slotSet.add(name.trim());
                        }
                    });
                }
            }
        }

        if (definitions.byName instanceof Map) {
            for (const name of definitions.byName.keys()) {
                if (typeof name === 'string' && name.trim()) {
                    slotSet.add(name.trim());
                }
            }
        }

        return Array.from(slotSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
        console.warn('Failed to resolve gear slot names:', error.message);
        return [];
    }
}

function renderEquipBestPrompt(context = {}) {
    try {
        const templateName = 'player-equipbest.xml.njk';
        return promptEnv.render(templateName, {
            setting: context.setting || 'A mysterious fantasy realm.',
            region: {
                regionName: context.region?.name || 'Unknown Region',
                regionDescription: context.region?.description || 'No description provided.'
            },
            location: {
                name: context.location?.name || 'Unknown Location',
                description: context.location?.description || 'No description provided.'
            },
            character: {
                name: context.character?.name || 'Unnamed Character',
                role: context.character?.role || context.character?.class || 'adventurer',
                description: context.character?.description || 'No description available.',
                class: context.character?.class || context.character?.role || 'adventurer',
                level: context.character?.level || 1,
                race: context.character?.race || 'human',
                equippableItems: Array.isArray(context.character?.equippableItems)
                    ? context.character.equippableItems
                    : [],
                gearSlots: Array.isArray(context.character?.gearSlots)
                    ? context.character.gearSlots
                    : []
            }
        });
    } catch (error) {
        console.error('Error rendering equip-best template:', error);
        return null;
    }
}

function parseEquipBestAssignments(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return [];
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const errorNode = doc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            throw new Error(errorNode.textContent || 'XML parsing error');
        }

        const itemNodes = Array.from(doc.getElementsByTagName('item'));
        const assignments = [];

        const extract = (node, tag) => {
            const child = node.getElementsByTagName(tag)[0];
            if (!child || typeof child.textContent !== 'string') {
                return null;
            }
            const value = child.textContent.trim();
            return value || null;
        };

        for (const itemNode of itemNodes) {
            const itemName = extract(itemNode, 'itemName');
            const slotName = extract(itemNode, 'slotName');
            if (itemName && slotName) {
                assignments.push({ itemName, slotName });
            }
        }

        return assignments;
    } catch (error) {
        console.warn('Failed to parse equip-best response:', error.message);
        return [];
    }
}

async function equipBestGearForCharacter({
    character,
    characterDescriptor = {},
    region = null,
    location = null,
    settingDescription = '',
    endpoint,
    model,
    apiKey
}) {
    if (!character || typeof character.getInventoryItems !== 'function' || typeof character.getGear !== 'function') {
        return;
    }

    const gearMap = character.getGear();
    const gearSlots = Object.entries(gearMap || {}).map(([slotName, slotData]) => ({
        name: slotName,
        type: slotData?.slotType || 'unknown'
    }));

    if (!gearSlots.length) {
        return;
    }

    const inventoryItems = character.getInventoryItems();
    if (!Array.isArray(inventoryItems) || !inventoryItems.length) {
        return;
    }

    const equippableThings = inventoryItems.filter(item => {
        if (!item) {
            return false;
        }
        const slot = (typeof item.slot === 'string' ? item.slot : (item.metadata?.slot ?? null));
        if (!slot || typeof slot !== 'string') {
            return false;
        }
        return slot.trim().length > 0 && slot.trim().toLowerCase() !== 'n/a';
    });

    if (!equippableThings.length) {
        return;
    }

    const equippableItems = equippableThings.map(item => {
        const metadata = item.metadata || {};
        const slotValue = typeof item.slot === 'string' ? item.slot : metadata.slot;
        const normalizedSlot = slotValue && typeof slotValue === 'string'
            ? slotValue.trim()
            : null;

        return {
            name: item.name,
            description: item.description,
            itemOrScenery: 'item',
            type: item.itemTypeDetail || metadata.itemTypeDetail || metadata.itemType || 'item',
            slot: normalizedSlot ? [normalizedSlot] : [],
            rarity: item.rarity || metadata.rarity || 'Common',
            value: metadata.value ?? '',
            weight: metadata.weight ?? '',
            relativeLevel: metadata.relativeLevel ?? item.relativeLevel ?? 0,
            attributeBonuses: Array.isArray(item.attributeBonuses) && item.attributeBonuses.length
                ? item.attributeBonuses
                : (Array.isArray(metadata.attributeBonuses) ? metadata.attributeBonuses : []),
            causeStatusEffect: item.causeStatusEffect || metadata.causeStatusEffect || null,
            properties: metadata.properties || ''
        };
    });

    if (!equippableItems.length) {
        return;
    }

    const promptVariables = {
        setting: settingDescription,
        region,
        location,
        character: {
            name: character.name,
            role: characterDescriptor.role || characterDescriptor.class || character.class || 'adventurer',
            description: character.description,
            class: characterDescriptor.class || character.class || 'adventurer',
            level: character.level || 1,
            race: characterDescriptor.race || character.race || 'human',
            equippableItems,
            gearSlots
        }
    };

    const renderedTemplate = renderEquipBestPrompt(promptVariables);
    if (!renderedTemplate) {
        return;
    }

    const parsedTemplate = parseXMLTemplate(renderedTemplate);
    const systemPrompt = parsedTemplate.systemPrompt;
    const generationPrompt = parsedTemplate.generationPrompt;

    if (!systemPrompt || !generationPrompt) {
        console.warn('Equip-best template missing prompts, skipping equip phase.');
        return;
    }

    const resolvedModel = model || config.ai.model;
    const resolvedApiKey = apiKey || config.ai.apiKey;
    const resolvedEndpoint = endpoint || (config.ai.endpoint.endsWith('/')
        ? `${config.ai.endpoint}chat/completions`
        : `${config.ai.endpoint}/chat/completions`);

    if (!resolvedModel || !resolvedApiKey || !resolvedEndpoint) {
        console.warn('Missing AI configuration for equip-best prompt.');
        return;
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    const requestData = {
        model: resolvedModel,
        messages,
        max_tokens: 600,
        temperature: config.ai.temperature || 0.7
    };

    let equipResponse = '';
    const requestStart = Date.now();
    try {
        const response = await axios.post(resolvedEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${resolvedApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        equipResponse = response.data?.choices?.[0]?.message?.content || '';
    } catch (error) {
        console.warn('Equip-best API call failed:', error.message || error);
        return;
    }

    const durationSeconds = (Date.now() - requestStart) / 1000;
    const assignments = parseEquipBestAssignments(equipResponse);

    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.join(logDir, `equip_best_${character.id}.log`);
        const logParts = [
            formatDurationLine(durationSeconds),
            '=== EQUIP-BEST PROMPT ===',
            generationPrompt,
            '\n=== EQUIP-BEST RESPONSE ===',
            equipResponse,
            '\n=== PARSED ASSIGNMENTS ===',
            JSON.stringify(assignments, null, 2),
            '\n'
        ];
        fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
    } catch (logError) {
        console.warn('Failed to log equip-best response:', logError.message);
    }

    if (!assignments.length) {
        return;
    }

    const inventoryByName = new Map();
    for (const item of inventoryItems) {
        if (item && typeof item.name === 'string') {
            inventoryByName.set(item.name.toLowerCase(), item);
        }
    }

    assignments.forEach(({ itemName, slotName }) => {
        if (!itemName || !slotName) {
            return;
        }
        const normalizedName = itemName.trim().toLowerCase();
        const item = inventoryByName.get(normalizedName) || findThingByName(itemName);
        if (!item) {
            console.warn(`Equip-best assignment skipped - item "${itemName}" not found in inventory.`);
            return;
        }
        const success = character.equipItemInSlot(item, slotName);
        if (!success === true) {
            console.warn(`Failed to equip ${item.name} to slot ${slotName} for ${character.name}: "${success}"`);
        } else {
            console.log(`Equipped ${item.name} to slot ${slotName} for ${character.name}`);
        }
    });
}

Player.setNpcInventoryChangeHandler(async ({ character }) => {
    if (!character) {
        return;
    }

    try {
        const settingSnapshot = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(settingSnapshot);

        let locationObj = null;
        if (character.currentLocation) {
            try {
                locationObj = Location.get(character.currentLocation);
            } catch (_) {
                locationObj = null;
            }
        }

        const regionObj = locationObj ? findRegionByLocationId(locationObj.id) : null;

        const descriptor = {
            role: character.class || 'npc',
            class: character.class || 'npc',
            description: character.description,
            race: character.race || 'unknown'
        };

        await equipBestGearForCharacter({
            character,
            characterDescriptor: descriptor,
            region: regionObj,
            location: locationObj,
            settingDescription
        });
    } catch (error) {
        console.warn('Automatic NPC equip failed:', error?.message || error);
    }
});

function parseLocationNpcs(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const npcNodes = Array.from(doc.getElementsByTagName('npc'));
        const npcs = [];

        for (const node of npcNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            const descriptionNode = node.getElementsByTagName('description')[0];
            const roleNode = node.getElementsByTagName('role')[0];
            const attributesNode = node.getElementsByTagName('attributes')[0];
            const classNode = node.getElementsByTagName('class')[0];
            const raceNode = node.getElementsByTagName('race')[0];
            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const healthAttributeNode = node.getElementsByTagName('healthAttribute')[0];

            const className = classNode ? classNode.textContent.trim() : null;
            const race = raceNode ? raceNode.textContent.trim() : null;
            const name = nameNode ? nameNode.textContent.trim() : null;
            const description = descriptionNode ? descriptionNode.textContent.trim() : '';
            const role = roleNode ? roleNode.textContent.trim() : null;
            const attributes = {};
            const relativeLevel = relativeLevelNode ? Number(relativeLevelNode.textContent.trim()) : null;
            const healthAttribute = healthAttributeNode ? healthAttributeNode.textContent.trim() : null;

            if (attributesNode) {
                const attrNodes = Array.from(attributesNode.getElementsByTagName('attribute'));
                for (const attrNode of attrNodes) {
                    const attrName = attrNode.getAttribute('name');
                    const rating = attrNode.textContent ? attrNode.textContent.trim() : '';
                    if (attrName) {
                        attributes[attrName] = rating;
                    }
                }
            }

            if (name) {
                npcs.push({
                    name,
                    description,
                    role,
                    class: className,
                    race,
                    attributes,
                    relativeLevel: Number.isFinite(relativeLevel) ? Math.max(-10, Math.min(10, Math.round(relativeLevel))) : null,
                    healthAttribute: healthAttribute && healthAttribute.toLowerCase() !== 'n/a' ? healthAttribute : null
                });
            }
        }

        return npcs;
    } catch (error) {
        console.warn('Failed to parse NPC XML:', error.message);
        return [];
    }
}

function parseRegionNpcs(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const npcNodes = Array.from(doc.getElementsByTagName('npc'));
        const npcs = [];

        for (const node of npcNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            const descriptionNode = node.getElementsByTagName('description')[0];
            const shortDescriptionNode = node.getElementsByTagName('shortDescription')[0];
            const roleNode = node.getElementsByTagName('role')[0];
            const classNode = node.getElementsByTagName('class')[0];
            const raceNode = node.getElementsByTagName('race')[0];
            const locationNode = node.getElementsByTagName('location')[0];
            const attributesNode = node.getElementsByTagName('attributes')[0];
            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const healthAttributeNode = node.getElementsByTagName('healthAttribute')[0];

            const name = nameNode ? nameNode.textContent.trim() : null;
            if (!name) {
                continue;
            }

            const description = descriptionNode ? descriptionNode.textContent.trim() : '';
            const shortDescription = shortDescriptionNode ? shortDescriptionNode.textContent.trim() : '';
            const role = roleNode ? roleNode.textContent.trim() : null;
            const className = classNode ? classNode.textContent.trim() : null;
            const race = raceNode ? raceNode.textContent.trim() : null;
            const locationName = locationNode ? locationNode.textContent.trim() : null;

            const attributes = {};
            if (attributesNode) {
                const attrNodes = Array.from(attributesNode.getElementsByTagName('attribute'));
                for (const attrNode of attrNodes) {
                    const attrName = attrNode.getAttribute('name');
                    const rating = attrNode.textContent ? attrNode.textContent.trim() : '';
                    if (attrName) {
                        attributes[attrName] = rating;
                    }
                }
            }

            const relativeLevel = relativeLevelNode ? Number(relativeLevelNode.textContent.trim()) : null;
            const healthAttribute = healthAttributeNode ? healthAttributeNode.textContent.trim() : null;

            npcs.push({
                name,
                description,
                shortDescription,
                role,
                class: className,
                race,
                location: locationName,
                attributes,
                relativeLevel: Number.isFinite(relativeLevel) ? Math.max(-10, Math.min(10, Math.round(relativeLevel))) : null,
                healthAttribute: healthAttribute && healthAttribute.toLowerCase() !== 'n/a' ? healthAttribute : null
            });
        }

        return npcs;
    } catch (error) {
        console.warn('Failed to parse region NPC XML:', error.message);
        return [];
    }
}

function renderNpcSkillsPrompt(skills = []) {
    try {
        const list = Array.isArray(skills) ? skills.filter(skill => skill && skill.name) : [];
        if (!list.length) {
            return null;
        }
        return promptEnv.render('npc-generate-skills.xml.njk', { skills: list });
    } catch (error) {
        console.error('Error rendering NPC skills template:', error);
        return null;
    }
}

function parseNpcSkillAssignments(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return new Map();
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const result = new Map();
        const npcNodes = Array.from(doc.getElementsByTagName('npc'));
        for (const npcNode of npcNodes) {
            const nameNode = npcNode.getElementsByTagName('name')[0];
            const npcName = nameNode ? nameNode.textContent.trim() : '';
            if (!npcName) {
                continue;
            }

            const skillEntries = [];
            const skillNodes = Array.from(npcNode.getElementsByTagName('skill'));
            for (const skillNode of skillNodes) {
                const skillNameNode = skillNode.getElementsByTagName('name')[0];
                const priorityNode = skillNode.getElementsByTagName('priority')[0];
                const skillName = skillNameNode ? skillNameNode.textContent.trim() : '';
                if (!skillName) {
                    continue;
                }

                const parsedPriority = Number.parseInt(priorityNode ? priorityNode.textContent.trim() : '', 10);
                const priority = Number.isFinite(parsedPriority) ? parsedPriority : 1;
                const clampedPriority = Math.max(1, Math.min(3, priority));

                skillEntries.push({
                    name: skillName,
                    priority: clampedPriority
                });
            }

            if (skillEntries.length) {
                result.set(npcName.toLowerCase(), {
                    name: npcName,
                    skills: skillEntries
                });
            }
        }

        return result;
    } catch (error) {
        console.warn('Failed to parse NPC skills XML:', error.message);
        return new Map();
    }
}

async function requestNpcSkillAssignments({ baseMessages = [], chatEndpoint, model, apiKey, logPath }) {
    try {
        const availableSkillsMap = Player.getAvailableSkills();
        if (!availableSkillsMap || availableSkillsMap.size === 0) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const skillsForPrompt = Array.from(availableSkillsMap.values())
            .filter(skill => skill && typeof skill.name === 'string' && skill.name.trim())
            .map(skill => ({
                name: skill.name.trim(),
                description: skill.description || ''
            }));

        if (!skillsForPrompt.length) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const skillsPrompt = renderNpcSkillsPrompt(skillsForPrompt);
        if (!skillsPrompt) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const messages = [...baseMessages, { role: 'user', content: skillsPrompt }];

        const requestData = {
            model,
            messages,
            max_tokens: 1200,
            temperature: config.ai.temperature || 0.7
        };

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const skillResponse = response.data.choices[0]?.message?.content || '';
        const durationSeconds = (Date.now() - requestStart) / 1000;

        if (logPath) {
            const logDir = path.dirname(logPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const lines = [
                formatDurationLine(durationSeconds),
                '=== NPC SKILLS PROMPT ===',
                skillsPrompt,
                '\n=== NPC SKILLS RESPONSE ===',
                skillResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
        }

        const assignments = parseNpcSkillAssignments(skillResponse);
        const conversation = [...messages, { role: 'assistant', content: skillResponse }];

        return {
            assignments,
            conversation,
            prompt: skillsPrompt,
            response: skillResponse
        };
    } catch (error) {
        console.warn('Failed to request NPC skill assignments:', error.message);
        return {
            assignments: new Map(),
            conversation: [...baseMessages]
        };
    }
}

function applyNpcSkillAllocations(npc, assignment) {
    if (!npc || !assignment || !Array.isArray(assignment) || assignment.length === 0) {
        return;
    }

    const availableSkills = Player.getAvailableSkills();
    if (!availableSkills || availableSkills.size === 0) {
        return;
    }

    const availableLookup = new Map();
    for (const skillName of availableSkills.keys()) {
        if (typeof skillName === 'string') {
            availableLookup.set(skillName.toLowerCase(), skillName);
        }
    }

    const totalPointsRaw = typeof npc.getUnspentSkillPoints === 'function'
        ? npc.getUnspentSkillPoints()
        : 0;
    const totalPoints = Number.isFinite(totalPointsRaw) ? totalPointsRaw : 0;
    if (totalPoints <= 0) {
        return;
    }

    const usable = assignment
        .map(entry => {
            const skillName = typeof entry.name === 'string' ? entry.name.trim() : '';
            if (!skillName) {
                return null;
            }
            const canonicalName = availableLookup.get(skillName.toLowerCase());
            if (!canonicalName || !availableSkills.has(canonicalName)) {
                return null;
            }
            const priority = Number.isFinite(entry.priority) ? entry.priority : 1;
            const clampedPriority = Math.max(1, Math.min(3, Math.round(priority)));
            return {
                name: canonicalName,
                priority: clampedPriority
            };
        })
        .filter(Boolean);

    if (!usable.length) {
        return;
    }

    const totalPriority = usable.reduce((sum, entry) => sum + entry.priority, 0);
    if (totalPriority <= 0) {
        return;
    }

    const allocations = usable.map(entry => ({
        name: entry.name,
        points: Math.floor((totalPoints * entry.priority) / totalPriority)
    }));

    let spent = allocations.reduce((sum, entry) => sum + entry.points, 0);
    let remaining = totalPoints - spent;

    while (remaining > 0 && allocations.length > 0) {
        const index = Math.floor(Math.random() * allocations.length);
        allocations[index].points += 1;
        remaining -= 1;
    }

    let totalSpent = 0;
    for (const allocation of allocations) {
        const baseValue = npc.getSkillValue(allocation.name) ?? 1;
        if (allocation.points <= 0) {
            continue;
        }

        const targetValue = Math.max(1, baseValue + allocation.points);
        const applied = npc.setSkillValue(allocation.name, targetValue);
        if (applied) {
            totalSpent += allocation.points;
        }
    }

    if (totalSpent > 0 && typeof npc.setUnspentSkillPoints === 'function') {
        const remainingPoints = Math.max(0, totalPoints - totalSpent);
        npc.setUnspentSkillPoints(remainingPoints);
    }
}

function renderNpcAbilitiesPrompt() {
    try {
        return promptEnv.render('npc-generate-abilities.xml.njk', {});
    } catch (error) {
        console.error('Error rendering NPC abilities template:', error);
        return null;
    }
}

function parseNpcAbilityAssignments(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return new Map();
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const mapping = new Map();
        const npcNodes = Array.from(doc.getElementsByTagName('npc'));
        for (const npcNode of npcNodes) {
            const nameNode = npcNode.getElementsByTagName('name')[0];
            const npcName = nameNode ? nameNode.textContent.trim() : '';
            if (!npcName) {
                continue;
            }

            const abilities = [];
            const abilityNodes = Array.from(npcNode.getElementsByTagName('ability'));
            for (const abilityNode of abilityNodes) {
                const abilityNameNode = abilityNode.getElementsByTagName('name')[0];
                const descriptionNode = abilityNode.getElementsByTagName('description')[0];
                const typeNode = abilityNode.getElementsByTagName('type')[0];
                const levelNode = abilityNode.getElementsByTagName('level')[0];

                const abilityName = abilityNameNode ? abilityNameNode.textContent.trim() : '';
                if (!abilityName) {
                    continue;
                }

                const description = descriptionNode ? descriptionNode.textContent.trim() : '';
                const rawType = typeNode ? typeNode.textContent.trim() : '';
                const loweredType = rawType.toLowerCase();
                const normalizedType = loweredType === 'active' || loweredType === 'passive' || loweredType === 'triggered'
                    ? loweredType.charAt(0).toUpperCase() + loweredType.slice(1)
                    : 'Passive';

                const parsedLevel = Number.parseInt(levelNode ? levelNode.textContent.trim() : '', 10);
                const level = Number.isFinite(parsedLevel) ? Math.max(1, Math.min(20, parsedLevel)) : 1;

                abilities.push({
                    name: abilityName,
                    description,
                    type: normalizedType,
                    level
                });
            }

            if (abilities.length) {
                mapping.set(npcName.toLowerCase(), {
                    name: npcName,
                    abilities
                });
            }
        }

        return mapping;
    } catch (error) {
        console.warn('Failed to parse NPC abilities XML:', error.message);
        return new Map();
    }
}

async function requestNpcAbilityAssignments({ baseMessages = [], chatEndpoint, model, apiKey, logPath }) {
    try {
        const abilitiesPrompt = renderNpcAbilitiesPrompt();
        if (!abilitiesPrompt) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const messages = [...baseMessages, { role: 'user', content: abilitiesPrompt }];

        const requestData = {
            model,
            messages,
            max_tokens: 1600,
            temperature: config.ai.temperature || 0.7
        };

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const abilityResponse = response.data.choices[0]?.message?.content || '';
        const durationSeconds = (Date.now() - requestStart) / 1000;

        if (logPath) {
            const logDir = path.dirname(logPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const formattedContext = Array.isArray(baseMessages) && baseMessages.length
                ? baseMessages.map((message, index) => {
                    const role = message?.role || 'unknown';
                    const content = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content);
                    return `#${index + 1} [${role}] ${content}`;
                }).join('\n')
                : null;
            const lines = [
                formatDurationLine(durationSeconds),
                formattedContext ? '=== NPC ABILITIES CONTEXT ===' : null,
                formattedContext,
                '=== NPC ABILITIES PROMPT ===',
                abilitiesPrompt,
                '\n=== NPC ABILITIES RESPONSE ===',
                abilityResponse,
                '\n'
            ].filter(Boolean);
            fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
        }

        const assignments = parseNpcAbilityAssignments(abilityResponse);
        const conversation = [...messages, { role: 'assistant', content: abilityResponse }];

        return {
            assignments,
            conversation,
            prompt: abilitiesPrompt,
            response: abilityResponse
        };
    } catch (error) {
        console.warn('Failed to request NPC ability assignments:', error.message);
        return {
            assignments: new Map(),
            conversation: [...baseMessages]
        };
    }
}

function applyNpcAbilities(npc, abilityList) {
    if (!npc || !Array.isArray(abilityList) || abilityList.length === 0) {
        return;
    }

    if (typeof npc.setAbilities !== 'function') {
        return;
    }

    npc.setAbilities(abilityList);
}

function parseInventoryItems(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const itemNodes = Array.from(doc.getElementsByTagName('item'));
        const items = [];

        for (const node of itemNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            if (!nameNode) {
                continue;
            }
            const attributeBonusesNode = node.getElementsByTagName('attributeBonuses')[0];
            const attributeBonuses = attributeBonusesNode
                ? Array.from(attributeBonusesNode.getElementsByTagName('attributeBonus'))
                    .map(bonusNode => {
                        const attr = bonusNode.getElementsByTagName('attribute')[0]?.textContent?.trim();
                        const bonusRaw = bonusNode.getElementsByTagName('bonus')[0]?.textContent?.trim();
                        if (!attr) {
                            return null;
                        }
                        const bonus = Number(bonusRaw);
                        return {
                            attribute: attr,
                            bonus: Number.isFinite(bonus) ? bonus : 0
                        };
                    })
                    .filter(Boolean)
                : [];

            const statusEffectNode = node.getElementsByTagName('statusEffect')[0];
            let causeStatusEffect = null;
            if (statusEffectNode) {
                const effectName = statusEffectNode.getElementsByTagName('name')[0]?.textContent?.trim();
                const effectDescription = statusEffectNode.getElementsByTagName('description')[0]?.textContent?.trim();
                const effectDuration = statusEffectNode.getElementsByTagName('duration')[0]?.textContent?.trim();
                const effectPayload = {};
                if (effectName) effectPayload.name = effectName;
                if (effectDescription) effectPayload.description = effectDescription;
                if (effectDuration && effectDuration.toLowerCase() !== 'n/a') {
                    effectPayload.duration = effectDuration;
                }
                if (Object.keys(effectPayload).length) {
                    causeStatusEffect = effectPayload;
                }
            }

            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const relativeLevel = relativeLevelNode ? Number(relativeLevelNode.textContent.trim()) : null;

            const item = {
                name: nameNode.textContent.trim(),
                description: node.getElementsByTagName('description')[0]?.textContent?.trim() || '',
                type: node.getElementsByTagName('type')[0]?.textContent?.trim() || 'item',
                slot: node.getElementsByTagName('slot')[0]?.textContent?.trim() || '',
                rarity: node.getElementsByTagName('rarity')[0]?.textContent?.trim() || 'Common',
                value: node.getElementsByTagName('value')[0]?.textContent?.trim() || '0',
                weight: node.getElementsByTagName('weight')[0]?.textContent?.trim() || '0',
                properties: node.getElementsByTagName('properties')[0]?.textContent?.trim() || '',
                relativeLevel,
                attributeBonuses,
                causeStatusEffect
            };
            items.push(item);
        }

        return items;
    } catch (error) {
        console.warn('Failed to parse inventory XML:', error.message);
        return [];
    }
}

function getBannedNpcWords() {
    if (Array.isArray(cachedBannedNpcWords)) {
        return cachedBannedNpcWords;
    }

    try {
        const raw = fs.readFileSync(BANNED_NPC_NAMES_PATH, 'utf8');
        const parsed = yaml.load(raw) || {};
        const words = Array.isArray(parsed.banned_npc_names) ? parsed.banned_npc_names : [];
        cachedBannedNpcWords = words
            .map(word => (typeof word === 'string' ? word.trim().toLowerCase() : ''))
            .filter(Boolean);
    } catch (error) {
        console.warn('Failed to load banned NPC names:', error.message);
        cachedBannedNpcWords = [];
    }

    return cachedBannedNpcWords;
}

function npcNameContainsBannedWord(name, bannedWords = getBannedNpcWords()) {
    if (!name || typeof name !== 'string' || !bannedWords.length) {
        return false;
    }

    const tokens = name
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter(Boolean);

    if (!tokens.length) {
        return false;
    }

    const tokenSet = new Set(tokens);
    for (const word of bannedWords) {
        if (tokenSet.has(word)) {
            return true;
        }
    }
    return false;
}

function formatDurationLine(durationSeconds) {
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
        return `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`;
    }
    return '=== API CALL DURATION: N/A ===';
}

function clampLevel(value, fallback = 1) {
    const base = Number.isFinite(value) ? value : (Number.isFinite(fallback) ? fallback : 1);
    return Math.max(1, Math.min(20, Math.round(base)));
}

function sanitizeMetadataObject(meta) {
    if (!meta || typeof meta !== 'object') {
        return {};
    }
    const cleaned = { ...meta };
    for (const key of Object.keys(cleaned)) {
        const value = cleaned[key];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            delete cleaned[key];
        }
    }
    return cleaned;
}

function summarizeNpcForNameRegen(npc) {
    if (!npc) {
        return null;
    }

    const name = typeof npc.name === 'string' ? npc.name.trim() : '';
    if (!name) {
        return null;
    }

    const short = npc.shortDescription && npc.shortDescription.trim()
        ? npc.shortDescription.trim()
        : (npc.description ? npc.description.split(/[.!?]/)[0]?.trim() || '' : '');

    return {
        name,
        shortDescription: short,
        detailedDescription: typeof npc.description === 'string' ? npc.description.trim() : ''
    };
}

function renderNpcNameRegenPrompt({ existingNpcSummaries = [], regenerationCandidates = [] } = {}) {
    if (!regenerationCandidates.length) {
        return null;
    }

    try {
        const rendered = promptEnv.render('npc-name-regen.xml.njk', {
            existingNpcs: existingNpcSummaries,
            npcToRegenerateName: regenerationCandidates,
            bannedWords: getBannedNpcWords()
        });

        const parsed = parseXMLTemplate(rendered);
        return parsed.generationPrompt || null;
    } catch (error) {
        console.warn('Failed to render NPC name regeneration prompt:', error.message);
        return null;
    }
}

function parseNpcNameRegenResponse(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return new Map();
    }

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const mapping = new Map();
        const npcNodes = Array.from(doc.getElementsByTagName('npc'));
        for (const node of npcNodes) {
            const oldName = node.getElementsByTagName('oldName')[0]?.textContent?.trim();
            const newName = node.getElementsByTagName('name')[0]?.textContent?.trim();
            const shortDescription = node.getElementsByTagName('shortDescription')[0]?.textContent?.trim() || '';
            const description = node.getElementsByTagName('description')[0]?.textContent?.trim() || '';
            if (oldName && newName) {
                mapping.set(oldName, { newName, shortDescription, description });
            }
        }
        return mapping;
    } catch (error) {
        console.warn('Failed to parse NPC name regeneration response:', error.message);
        return new Map();
    }
}

async function enforceBannedNpcNames({
    npcDataList,
    existingNpcSummaries,
    conversationMessages,
    chatEndpoint,
    model,
    apiKey
} = {}) {
    if (!Array.isArray(npcDataList) || !npcDataList.length) {
        return npcDataList;
    }

    const bannedWords = getBannedNpcWords();
    if (!bannedWords.length) {
        return npcDataList;
    }

    const workingList = npcDataList.map(npc => ({ ...npc }));
    const messages = Array.isArray(conversationMessages) ? [...conversationMessages] : [];

    let attempts = 0;
    while (attempts < 3) {
        const offenders = workingList
            .filter(npc => npc && npc.name && npcNameContainsBannedWord(npc.name, bannedWords))
            .map(npc => ({
                name: npc.name,
                shortDescription: npc.shortDescription || '',
                detailedDescription: npc.description || ''
            }));

        if (!offenders.length) {
            break;
        }

        const contextMap = new Map();
        const addToContext = summary => {
            if (!summary || !summary.name) {
                return;
            }
            const key = summary.name.toLowerCase();
            if (!contextMap.has(key)) {
                contextMap.set(key, summary);
            }
        };

        for (const summary of existingNpcSummaries || []) {
            addToContext(summary);
        }

        for (const npc of workingList) {
            const derived = {
                name: npc.name,
                shortDescription: npc.shortDescription || '',
                detailedDescription: npc.description || ''
            };
            addToContext(derived);
        }

        const prompt = renderNpcNameRegenPrompt({
            existingNpcSummaries: Array.from(contextMap.values()),
            regenerationCandidates: offenders
        });

        if (!prompt) {
            break;
        }

        const regenMessages = messages.concat({ role: 'user', content: prompt });

        const requestData = {
            model,
            messages: regenMessages,
            max_tokens: 600,
            temperature: 0.5
        };

        let regenText = '';
        let apiDurationSeconds = null;
        try {
            const requestStart = Date.now();
            const response = await axios.post(chatEndpoint, requestData, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });
            regenText = response.data?.choices?.[0]?.message?.content || '';
            apiDurationSeconds = (Date.now() - requestStart) / 1000;
        } catch (error) {
            console.warn('NPC name regeneration failed:', error.message);
            break;
        }

        if (!regenText.trim()) {
            break;
        }

        try {
            logNpcNameRegeneration({ prompt, responseText: regenText, durationSeconds: apiDurationSeconds });
        } catch (logError) {
            console.warn('Failed to log NPC name regeneration interaction:', logError.message);
        }

        messages.push({ role: 'user', content: prompt });
        messages.push({ role: 'assistant', content: regenText });

        const mapping = parseNpcNameRegenResponse(regenText);
        if (!mapping.size) {
            attempts += 1;
            continue;
        }

        for (const npc of workingList) {
            if (!npc || !npc.name) {
                continue;
            }
            const replacement = mapping.get(npc.name) || mapping.get(npc.name.trim());
            if (replacement) {
                npc.name = replacement.newName;
                if (replacement.shortDescription) {
                    npc.shortDescription = replacement.shortDescription;
                }
                if (replacement.description) {
                    npc.description = replacement.description;
                }
            }
        }

        attempts += 1;
    }

    return workingList;
}

function renderLocationThingsPrompt(context = {}) {
    try {
        const templateName = 'location-generator-things.njk';
        const safeSetting = context.settingDescription || context.setting || 'An evocative roleplaying setting.';
        const safeRegion = context.region || {};
        const safeLocation = context.location || {};
        const gearSlotTypes = getGearSlotTypes();
        const attributeNames = Object.keys(attributeDefinitionsForPrompt || {})
            .filter(name => typeof name === 'string' && name.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const templatePayload = {
            setting: safeSetting,
            region: {
                regionName: safeRegion.name || safeRegion.regionName || 'Unknown Region',
                regionDescription: safeRegion.description || safeRegion.regionDescription || 'No description provided.'
            },
            location: {
                name: safeLocation.name || 'Unknown Location',
                description: safeLocation.description || 'No description provided.'
            },
            gearSlots: gearSlotTypes,
            equipmentSlots: gearSlotTypes,
            attributeDefinitions: attributeDefinitionsForPrompt,
            attributes: attributeNames
        };

        const rendered = promptEnv.render(templateName, templatePayload);
        return parseXMLTemplate(rendered);
    } catch (error) {
        console.error('Error rendering location things template:', error);
        return null;
    }
}

function parseLocationThingsXml(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const itemNodes = Array.from(doc.getElementsByTagName('item'));
        const items = [];

        for (const node of itemNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            if (!nameNode) {
                continue;
            }

            const attributeBonusesNode = node.getElementsByTagName('attributeBonuses')[0];
            const attributeBonuses = attributeBonusesNode
                ? Array.from(attributeBonusesNode.getElementsByTagName('attributeBonus'))
                    .map(bonusNode => {
                        const attr = bonusNode.getElementsByTagName('attribute')[0]?.textContent?.trim();
                        const bonusRaw = bonusNode.getElementsByTagName('bonus')[0]?.textContent?.trim();
                        if (!attr) {
                            return null;
                        }
                        const bonus = Number(bonusRaw);
                        return {
                            attribute: attr,
                            bonus: Number.isFinite(bonus) ? bonus : 0
                        };
                    })
                    .filter(Boolean)
                : [];

            const statusEffectNode = node.getElementsByTagName('statusEffect')[0];
            let causeStatusEffect = null;
            if (statusEffectNode) {
                const effectName = statusEffectNode.getElementsByTagName('name')[0]?.textContent?.trim();
                const effectDescription = statusEffectNode.getElementsByTagName('description')[0]?.textContent?.trim();
                const effectDuration = statusEffectNode.getElementsByTagName('duration')[0]?.textContent?.trim();
                const effectPayload = {};
                if (effectName) effectPayload.name = effectName;
                if (effectDescription) effectPayload.description = effectDescription;
                if (effectDuration && effectDuration.toLowerCase() !== 'n/a') {
                    effectPayload.duration = effectDuration;
                }
                if (Object.keys(effectPayload).length) {
                    causeStatusEffect = effectPayload;
                }
            }

            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const relativeLevel = relativeLevelNode ? Number(relativeLevelNode.textContent.trim()) : null;

            const entry = {
                name: nameNode.textContent.trim(),
                description: node.getElementsByTagName('description')[0]?.textContent?.trim() || '',
                itemOrScenery: node.getElementsByTagName('itemOrScenery')[0]?.textContent?.trim() || '',
                type: node.getElementsByTagName('type')[0]?.textContent?.trim() || '',
                slot: node.getElementsByTagName('slot')[0]?.textContent?.trim() || '',
                rarity: node.getElementsByTagName('rarity')[0]?.textContent?.trim() || '',
                value: node.getElementsByTagName('value')[0]?.textContent?.trim() || '',
                weight: node.getElementsByTagName('weight')[0]?.textContent?.trim() || '',
                properties: node.getElementsByTagName('properties')[0]?.textContent?.trim() || '',
                relativeLevel,
                attributeBonuses,
                causeStatusEffect
            };

            items.push(entry);
        }

        return items;
    } catch (error) {
        console.warn('Failed to parse location things XML:', error.message);
        return [];
    }
}

async function generateLocationThingsForLocation({ location, chatEndpoint = null, model = null, apiKey = null } = {}) {
    if (!location || typeof location.id !== 'string') {
        return [];
    }

    const locationDescription = typeof location.description === 'string'
        ? location.description
        : (typeof location.getDetails === 'function' ? (location.getDetails().description || '') : '');

    if (!locationDescription || !locationDescription.trim()) {
        return [];
    }

    if (Array.isArray(location.thingIds) && location.thingIds.length > 0) {
        return [];
    }

    if (!config.ai || !config.ai.endpoint || !config.ai.apiKey || !config.ai.model) {
        return [];
    }

    const stripHtml = (value) => typeof value === 'string'
        ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';

    const settingSnapshot = getActiveSettingSnapshot();
    const region = findRegionByLocationId(location.id);

    const parsedTemplate = renderLocationThingsPrompt({
        settingDescription: describeSettingForPrompt(settingSnapshot),
        region: region ? { name: region.name, description: region.description } : null,
        location: {
            name: location.name || 'Unknown Location',
            description: stripHtml(locationDescription) || locationDescription || 'No description provided.'
        }
    });

    if (!parsedTemplate || !parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
        return [];
    }

    const endpoint = config.ai.endpoint;
    const resolvedModel = model || config.ai.model;
    const resolvedApiKey = apiKey || config.ai.apiKey;
    const resolvedChatEndpoint = chatEndpoint || (endpoint.endsWith('/')
        ? `${endpoint}chat/completions`
        : `${endpoint}/chat/completions`);

    const messages = [
        { role: 'system', content: parsedTemplate.systemPrompt },
        { role: 'user', content: parsedTemplate.generationPrompt }
    ];

    const requestData = {
        model: resolvedModel,
        messages,
        max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 600,
        temperature: typeof parsedTemplate.temperature === 'number'
            ? parsedTemplate.temperature
            : (config.ai.temperature || 0.6)
    };

    const requestStart = Date.now();
    const response = await axios.post(resolvedChatEndpoint, requestData, {
        headers: {
            'Authorization': `Bearer ${resolvedApiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 45000
    });

    const aiResponse = response.data?.choices?.[0]?.message?.content;
    if (!aiResponse || !aiResponse.trim()) {
        return [];
    }

    const apiDurationSeconds = (Date.now() - requestStart) / 1000;

    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.join(logDir, `location_${location.id}_things.log`);
        const parts = [
            formatDurationLine(apiDurationSeconds),
            '=== LOCATION THINGS SYSTEM PROMPT ===',
            parsedTemplate.systemPrompt,
            '',
            '=== LOCATION THINGS PROMPT ===',
            parsedTemplate.generationPrompt,
            '',
            '=== LOCATION THINGS RESPONSE ===',
            aiResponse,
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (logError) {
        console.warn('Failed to log location things generation:', logError.message);
    }

    const parsedItems = parseLocationThingsXml(aiResponse);
    if (!parsedItems.length) {
        return [];
    }

    // Remove any existing location-bound things before adding new ones
    const existingIds = Array.isArray(location.thingIds)
        ? location.thingIds
        : (typeof location.getThingIds === 'function' ? Array.from(location.getThingIds()) : []);

    for (const existingId of existingIds) {
        if (!existingId) continue;
        const existingThing = things.get(existingId) || Thing.getById(existingId);
        if (existingThing && typeof existingThing.delete === 'function') {
            existingThing.delete();
        }
        things.delete(existingId);
    }

    location.clearThingIds();

    const createdThings = [];
    for (const itemData of parsedItems) {
        if (!itemData?.name) {
            continue;
        }

        const normalizedType = (itemData.itemOrScenery || '').trim().toLowerCase();
        const thingType = normalizedType === 'scenery' ? 'scenery' : 'item';

        const metadata = {
            locationId: location.id,
            locationName: location.name || location.id
        };

        if (itemData.value) {
            metadata.value = itemData.value;
        }
        if (itemData.weight) {
            metadata.weight = itemData.weight;
        }
        if (itemData.properties) {
            metadata.properties = itemData.properties;
        }
        if (itemData.slot && itemData.slot.toLowerCase() !== 'n/a') {
            metadata.slot = itemData.slot;
        }
        if (itemData.attributeBonuses?.length) {
            metadata.attributeBonuses = itemData.attributeBonuses;
        }
        if (itemData.causeStatusEffect) {
            metadata.causeStatusEffect = itemData.causeStatusEffect;
        }
        if (Number.isFinite(itemData.relativeLevel)) {
            metadata.relativeLevel = Math.max(-10, Math.min(10, Math.round(itemData.relativeLevel)));
        }

        const baseReference = Number.isFinite(location.baseLevel)
            ? location.baseLevel
            : (location.stubMetadata?.computedBaseLevel
                ?? location.stubMetadata?.regionAverageLevel
                ?? currentPlayer?.level
                ?? 1);
        const relativeLevel = Number.isFinite(metadata.relativeLevel) ? metadata.relativeLevel : 0;
        const computedLevel = clampLevel(baseReference + relativeLevel, baseReference);
        metadata.level = computedLevel;

        const cleanedMetadata = sanitizeMetadataObject(metadata);

        const thing = new Thing({
            name: itemData.name,
            description: itemData.description || 'An unspecified object.',
            thingType,
            rarity: itemData.rarity || null,
            itemTypeDetail: itemData.type || null,
            slot: itemData.slot || null,
            attributeBonuses: itemData.attributeBonuses,
            causeStatusEffect: itemData.causeStatusEffect,
            level: computedLevel,
            relativeLevel,
            metadata: cleanedMetadata
        });

        things.set(thing.id, thing);
        location.addThingId(thing.id);

        if (shouldGenerateThingImage(thing) && (!thing.imageId || !hasExistingImage(thing.imageId))) {
            thing.imageId = null;
        }

        createdThings.push(thing);
    }

    return createdThings;
}

function renderSkillsPrompt(context = {}) {
    try {
        const templateName = 'skills-generator.xml.njk';
        const existingSkills = Array.isArray(context.existingSkills)
            ? context.existingSkills
                .map(name => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean)
                .map(name => ({ name }))
            : [];
        return promptEnv.render(templateName, {
            settingDescription: context.settingDescription || 'A fantastical realm of adventure.',
            numSkills: context.numSkills || 20,
            attributes: context.attributes || [],
            existingSkills
        });
    } catch (error) {
        console.error('Error rendering skills template:', error);
        return null;
    }
}

function renderSkillsByNamePrompt(context = {}) {
    try {
        const templateName = 'skills-generator-by-name.xml.njk';
        const skillsToGenerate = Array.isArray(context.skillsToGenerate)
            ? context.skillsToGenerate
                .map(name => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean)
                .map(name => ({ name }))
            : [];

        return promptEnv.render(templateName, {
            settingDescription: context.settingDescription || 'A fantastical realm of adventure.',
            attributes: context.attributes || [],
            skillsToGenerate
        });
    } catch (error) {
        console.error('Error rendering skills-by-name template:', error);
        return null;
    }
}

function parseSkillsXml(xmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const skillNodes = Array.from(doc.getElementsByTagName('skill'));
        const parsedSkills = [];

        for (const node of skillNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            const descriptionNode = node.getElementsByTagName('description')[0];
            const attributeNode = node.getElementsByTagName('attribute')[0];

            const name = nameNode ? nameNode.textContent.trim() : '';
            if (!name) {
                continue;
            }

            parsedSkills.push({
                name,
                description: descriptionNode ? descriptionNode.textContent.trim() : '',
                attribute: attributeNode ? attributeNode.textContent.trim() : ''
            });
        }

        return parsedSkills;
    } catch (error) {
        console.warn('Failed to parse skills XML:', error.message);
        return [];
    }
}

function logSkillGeneration({ systemPrompt, generationPrompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `skills_generation_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== SKILL GENERATION SYSTEM PROMPT ===',
            systemPrompt || '(none)',
            '',
            '=== SKILL GENERATION PROMPT ===',
            generationPrompt || '(none)',
            '',
            '=== SKILL GENERATION RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log skills generation:', error.message);
    }
}

function logNpcNameRegeneration({ prompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `npc_name_regen_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== NPC NAME REGEN PROMPT ===',
            prompt || '(none)',
            '',
            '=== NPC NAME REGEN RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log NPC name regeneration:', error.message);
    }
}

function buildFallbackSkills({ count, attributes }) {
    const fallbackSkills = [];
    const attributeNames = Array.isArray(attributes) && attributes.length
        ? attributes.map(attr => attr.name || attr)
        : ['general'];

    for (let i = 0; i < count; i++) {
        const attributeName = attributeNames[i % attributeNames.length] || 'general';
        const attributeLabel = typeof attributeName === 'string' && attributeName.trim()
            ? attributeName.trim()
            : 'general';
        const prettyAttribute = attributeLabel.charAt(0).toUpperCase() + attributeLabel.slice(1);
        const skillName = `${prettyAttribute} Training ${Math.floor(i / attributeNames.length) + 1}`.trim();
        const description = `Fallback skill focused on enhancing ${prettyAttribute.toLowerCase()} capabilities.`;
        fallbackSkills.push(new Skill({
            name: skillName,
            description,
            attribute: attributeLabel
        }));
    }

    return fallbackSkills;
}

async function generateSkillsList({ count, settingDescription, existingSkills = [] }) {
    const safeCount = Math.max(1, Math.min(100, Number(count) || 20));

    const normalizedExisting = Array.isArray(existingSkills)
        ? existingSkills
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        : [];

    const attributeEntries = Object.entries(attributeDefinitionsForPrompt || {})
        .map(([name, info]) => ({
            name,
            description: info?.description || info?.label || name
        }));

    const renderedTemplate = renderSkillsPrompt({
        settingDescription: settingDescription || 'A vibrant world of adventure.',
        numSkills: safeCount,
        attributes: attributeEntries,
        existingSkills: normalizedExisting
    });

    if (!renderedTemplate) {
        console.warn('Skills template render failed, using fallback skills.');
        return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
    }

    const parsedTemplate = parseXMLTemplate(renderedTemplate);
    const systemPrompt = parsedTemplate.systemPrompt;
    const generationPrompt = parsedTemplate.generationPrompt;

    if (!systemPrompt || !generationPrompt) {
        console.warn('Skills template missing prompts, using fallback skills.');
        return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    const endpoint = config.ai?.endpoint;
    const apiKey = config.ai?.apiKey;
    const model = config.ai?.model;

    if (!endpoint || !apiKey || !model) {
        console.warn('AI configuration missing for skill generation, using fallback skills.');
        return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
    }

    const chatEndpoint = endpoint.endsWith('/') ?
        endpoint + 'chat/completions' :
        endpoint + '/chat/completions';

    const requestData = {
        model,
        messages,
        max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 600,
        temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.4
    };

    try {
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const skillResponse = response.data?.choices?.[0]?.message?.content || '';

        logSkillGeneration({
            systemPrompt,
            generationPrompt,
            responseText: skillResponse,
            durationSeconds: (Date.now() - requestStart) / 1000
        });

        const parsedSkills = parseSkillsXml(skillResponse);
        if (!parsedSkills.length) {
            console.warn('Skill generation returned no skills, using fallback.');
            return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
        }

        let skillsList = parsedSkills.map(skillData => new Skill({
            name: skillData.name,
            description: skillData.description,
            attribute: skillData.attribute
        }));

        if (skillsList.length < safeCount) {
            const supplemental = buildFallbackSkills({
                count: safeCount - skillsList.length,
                attributes: attributeEntries
            });
            skillsList = skillsList.concat(supplemental);
        }

        return skillsList.slice(0, safeCount);
    } catch (error) {
        console.warn('Skill generation failed:', error.message);
        return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
    }
}

async function generateSkillsByNames({ skillNames = [], settingDescription }) {
    const normalized = Array.isArray(skillNames)
        ? Array.from(new Set(
            skillNames
                .map(name => (typeof name === 'string' ? name.trim() : ''))
                .filter(Boolean)
        ))
        : [];

    if (!normalized.length) {
        return [];
    }

    const attributeEntries = Object.entries(attributeDefinitionsForPrompt || {})
        .map(([name, info]) => ({
            name,
            description: info?.description || info?.label || name
        }));

    const renderedTemplate = renderSkillsByNamePrompt({
        settingDescription: settingDescription || 'A vibrant world of adventure.',
        attributes: attributeEntries,
        skillsToGenerate: normalized
    });

    if (!renderedTemplate) {
        return normalized.map(name => new Skill({ name, description: '', attribute: '' }));
    }

    const parsedTemplate = parseXMLTemplate(renderedTemplate);
    const systemPrompt = parsedTemplate.systemPrompt;
    const generationPrompt = parsedTemplate.generationPrompt;

    if (!systemPrompt || !generationPrompt) {
        return normalized.map(name => new Skill({ name, description: '', attribute: '' }));
    }

    const endpoint = config.ai?.endpoint;
    const apiKey = config.ai?.apiKey;
    const model = config.ai?.model;

    if (!endpoint || !apiKey || !model) {
        return normalized.map(name => new Skill({ name, description: '', attribute: '' }));
    }

    const chatEndpoint = endpoint.endsWith('/') ?
        endpoint + 'chat/completions' :
        endpoint + '/chat/completions';

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    const requestData = {
        model,
        messages,
        max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 600,
        temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.3
    };

    try {
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        const skillResponse = response.data?.choices?.[0]?.message?.content || '';

        logSkillGeneration({
            systemPrompt,
            generationPrompt,
            responseText: skillResponse,
            durationSeconds: (Date.now() - requestStart) / 1000
        });

        const parsedSkills = parseSkillsXml(skillResponse);
        const parsedMap = new Map();
        for (const parsed of parsedSkills) {
            if (!parsed?.name) {
                continue;
            }
            const key = parsed.name.trim().toLowerCase();
            if (key) {
                parsedMap.set(key, new Skill({
                    name: parsed.name,
                    description: parsed.description,
                    attribute: parsed.attribute
                }));
            }
        }

        return normalized.map(name => {
            const key = name.toLowerCase();
            return parsedMap.get(key) || new Skill({ name, description: '', attribute: '' });
        });
    } catch (error) {
        console.warn('Skill generation by name failed:', error.message);
        return normalized.map(name => new Skill({ name, description: '', attribute: '' }));
    }
}

// Function to render location NPC prompt from template
async function generateLocationNPCs({ location, systemPrompt, generationPrompt, aiResponse, regionTheme, chatEndpoint, model, apiKey, existingLocationsInRegion = [] }) {
    try {
        let region = Region.get(location.regionId);
        const allNpcIds = Utils.difference(new Set(players.keys()), new Set([currentPlayer?.id].filter(Boolean)));
        const regionNpcIdSet = region ? new Set(region.npcIds || []) : new Set();
        const locationNpcIdSet = new Set(location.npcIds || []);
        const otherLocationNpcIds = Utils.difference(regionNpcIdSet, locationNpcIdSet);
        const otherRegionNpcIds = Utils.difference(allNpcIds, regionNpcIdSet);

        const existingNpcIdsArray = Array.from(locationNpcIdSet);
        let existingNpcsInThisLocation = getAllPlayers(existingNpcIdsArray).filter(npc => npc && npc.isNPC);
        let existingNpcsInOtherLocations = getAllPlayers(Array.from(otherLocationNpcIds)).filter(npc => npc && npc.isNPC);
        let existingNpcsInOtherRegions = getAllPlayers(Array.from(otherRegionNpcIds)).filter(npc => npc && npc.isNPC);

        const existingNpcSummariesForRegen = [
            ...existingNpcsInThisLocation.map(summarizeNpcForNameRegen).filter(Boolean),
            ...existingNpcsInOtherLocations.map(summarizeNpcForNameRegen).filter(Boolean),
            ...existingNpcsInOtherRegions.map(summarizeNpcForNameRegen).filter(Boolean)
        ];


        const npcPrompt = renderLocationNpcPrompt(location, {
            regionTheme,
            attributeDefinitions: attributeDefinitionsForPrompt,
            existingNpcsInThisLocation,
            existingNpcsInOtherLocations,
            existingNpcsInOtherRegions
        });
        if (!npcPrompt) {
            return [];
        }

        const locationContextText = existingLocationsInRegion
            .filter(loc => loc && loc.id !== location.id)
            .slice(0, 5)
            .map(loc => `- ${loc.name || loc.id}: ${loc.description?.replace(/\s+/g, ' ').slice(0, 160) || 'No description provided.'}`)
            .join('\n');

        const npcPromptWithContext = locationContextText
            ? `${npcPrompt}\n\nHere are other known locations in this region for context:\n${locationContextText}`
            : npcPrompt;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt },
            { role: 'assistant', content: aiResponse },
            { role: 'user', content: npcPromptWithContext }
        ];

        const requestData = {
            model,
            messages,
            max_tokens: 2000,
            temperature: config.ai.temperature || 0.7
        };

        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.join(logDir, `location_npcs_${location.id}.log`);

        console.log('🧑‍🤝‍🧑 Requesting NPC generation for location', location.id);
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid NPC response from AI API');
        }

        const npcResponse = response.data.choices[0].message.content;
        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const parts = [
                formatDurationLine(apiDurationSeconds),
                '=== NPC PROMPT ===',
                npcPromptWithContext,
                '\n=== NPC RESPONSE ===',
                npcResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
        } catch (logErr) {
            console.warn('Failed to write NPC log:', logErr.message);
        }

        let npcs = parseLocationNpcs(npcResponse);
        const baseConversation = [...messages, { role: 'assistant', content: npcResponse }];

        if (npcs.length) {
            npcs = await enforceBannedNpcNames({
                npcDataList: npcs,
                existingNpcSummaries: existingNpcSummariesForRegen,
                conversationMessages: baseConversation,
                chatEndpoint,
                model,
                apiKey
            });
        }

        let npcSkillAssignments = new Map();
        let skillConversation = [...baseConversation];
        if (npcs.length) {
            try {
                const skillsLogPath = path.join(logDir, `location_${location.id}_npc_skills.log`);
                const skillResult = await requestNpcSkillAssignments({
                    baseMessages: baseConversation,
                    chatEndpoint,
                    model,
                    apiKey,
                    logPath: skillsLogPath
                });
                npcSkillAssignments = skillResult.assignments || new Map();
                skillConversation = Array.isArray(skillResult.conversation) ? skillResult.conversation : skillConversation;
            } catch (skillError) {
                console.warn(`Failed to generate skills for location NPCs (${location.id}):`, skillError.message);
            }
        }

        let npcAbilityAssignments = new Map();
        if (npcs.length) {
            try {
                const abilitiesLogPath = path.join(logDir, `location_${location.id}_npc_abilities.log`);
                const abilityResult = await requestNpcAbilityAssignments({
                    baseMessages: skillConversation,
                    chatEndpoint,
                    model,
                    apiKey,
                    logPath: abilitiesLogPath
                });
                npcAbilityAssignments = abilityResult.assignments || new Map();
            } catch (abilityError) {
                console.warn(`Failed to generate abilities for location NPCs (${location.id}):`, abilityError.message);
            }
        }

        const created = [];
        const survivingNpcIds = [];
        for (const npcId of existingNpcIdsArray) {
            const npc = players.get(npcId);
            if (npc?.isRegionImportant) {
                survivingNpcIds.push(npcId);
                continue;
            }
            players.delete(npcId);
        }
        if (typeof location.setNpcIds === 'function') {
            location.setNpcIds(survivingNpcIds);
        }

        for (const npcData of npcs) {
            const attributes = {};
            const attrSource = npcData.attributes || {};
            for (const attrName of Object.keys(attributeDefinitionsForPrompt)) {
                const rating = attrSource[attrName] || attrSource[attrName.toLowerCase()];
                attributes[attrName] = mapNpcRatingToValue(rating);
            }

            const npc = new Player({
                name: npcData.name || 'Unnamed NPC',
                description: npcData.description || '',
                level: 1,
                location: location.id,
                attributes,
                class: npcData.class || null,
                race: npcData.race,
                isNPC: true,
                healthAttribute: npcData.healthAttribute
            });

            const locationBaseLevel = Number.isFinite(location.baseLevel)
                ? location.baseLevel
                : (Number.isFinite(region?.averageLevel) ? region.averageLevel : (currentPlayer?.level || 1));
            const npcRelativeLevel = Number.isFinite(npcData.relativeLevel) ? npcData.relativeLevel : 0;
            const targetLevel = clampLevel(locationBaseLevel + npcRelativeLevel, locationBaseLevel);
            try {
                npc.setLevel(targetLevel);
            } catch (_) {
                // ignore level adjustment failures
            }
            players.set(npc.id, npc);
            location.addNpcId(npc.id);
            created.push(npc);
            console.log(`🤝 Created NPC ${npc.name} (${npc.id}) for location ${location.id}`);

            const skillAssignmentEntry = npcSkillAssignments.get(((npcData.name || '').trim().toLowerCase()));
            if (skillAssignmentEntry && Array.isArray(skillAssignmentEntry.skills) && skillAssignmentEntry.skills.length) {
                applyNpcSkillAllocations(npc, skillAssignmentEntry.skills);
            }

            const abilityAssignmentEntry = npcAbilityAssignments.get(((npcData.name || '').trim().toLowerCase()));
            if (abilityAssignmentEntry && Array.isArray(abilityAssignmentEntry.abilities) && abilityAssignmentEntry.abilities.length) {
                applyNpcAbilities(npc, abilityAssignmentEntry.abilities);
            }

            await generateInventoryForCharacter({
                character: npc,
                characterDescriptor: { role: npcData.role, class: npcData.class, race: npcData.race },
                region: region || findRegionByLocationId(location.id),
                location,
                chatEndpoint,
                model,
                apiKey
            });

            if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
                npc.imageId = null;
            } else {
                console.log(`🎭 Skipping NPC portrait for ${npc.name} (${npc.id}) - outside player context`);
            }
        }

        return created;
    } catch (error) {
        console.warn(`NPC generation skipped for location ${location.id}:`, error.message);
        return [];
    }
}


async function generateRegionNPCs({ region, systemPrompt, generationPrompt, aiResponse, chatEndpoint, model, apiKey }) {
    if (!region) {
        return [];
    }

    try {
        const regionLocationIds = Array.isArray(region.locationIds) ? [...region.locationIds] : [];
        const regionLocations = regionLocationIds
            .map(id => gameLocations.get(id))
            .filter(Boolean);

        const locationLookup = new Map();
        const allLocationsForPrompt = regionLocations.map(loc => {
            const normalized = normalizeRegionLocationName(loc.name || loc.id);
            if (normalized) {
                locationLookup.set(normalized, loc);
            }
            return {
                id: loc.id,
                name: loc.name || loc.id,
                description: loc.description || loc.stubMetadata?.blueprintDescription || 'No description provided.'
            };
        });

        const regionLocationSet = new Set(regionLocationIds);
        const existingNpcObjectsInOtherRegions = Array.from(players.values())
            .filter(npc => npc && npc.isNPC)
            .filter(npc => {
                if (!npc.currentLocation) {
                    return true;
                }
                return !regionLocationSet.has(npc.currentLocation);
            })
            .slice(0, 20);

        const existingNpcsInOtherRegions = existingNpcObjectsInOtherRegions.map(npc => ({
            name: npc.name,
            shortDescription: npc.shortDescription && npc.shortDescription.trim()
                ? npc.shortDescription.trim()
                : (npc.description ? npc.description.split(/[.!?]/)[0]?.trim() || '' : '')
        }));

        const regionNpcSummaries = [];
        for (const loc of regionLocations) {
            if (!loc || !Array.isArray(loc.npcIds)) {
                continue;
            }
            for (const npcId of loc.npcIds) {
                const npc = players.get(npcId);
                const summary = summarizeNpcForNameRegen(npc);
                if (summary) {
                    regionNpcSummaries.push(summary);
                }
            }
        }

        const existingNpcSummariesForRegen = [
            ...regionNpcSummaries,
            ...existingNpcObjectsInOtherRegions.map(summarizeNpcForNameRegen).filter(Boolean)
        ];

        const npcPrompt = renderRegionNpcPrompt(region, {
            allLocationsInRegion: allLocationsForPrompt,
            existingNpcsInOtherRegions,
            attributeDefinitions: attributeDefinitionsForPrompt
        });

        if (!npcPrompt) {
            return [];
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt },
            { role: 'assistant', content: aiResponse },
            { role: 'user', content: npcPrompt }
        ];

        const requestData = {
            model,
            messages,
            max_tokens: 2500,
            temperature: config.ai.temperature || 0.7
        };

        console.log('🏘️ Requesting important NPC generation for region', region.id);
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 80000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid region NPC response from AI API');
        }

        const npcResponse = response.data.choices[0].message.content;
        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `region_${region.id}_npcs.log`);
            const parts = [
                formatDurationLine(apiDurationSeconds),
                '=== REGION NPC PROMPT ===',
                npcPrompt,
                '\n=== REGION NPC RESPONSE ===',
                npcResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
        } catch (logErr) {
            console.warn('Failed to write region NPC log:', logErr.message);
        }

        let parsedNpcs = parseRegionNpcs(npcResponse);
        const baseConversation = [...messages, { role: 'assistant', content: npcResponse }];

        if (parsedNpcs.length) {
            parsedNpcs = await enforceBannedNpcNames({
                npcDataList: parsedNpcs,
                existingNpcSummaries: existingNpcSummariesForRegen,
                conversationMessages: baseConversation,
                chatEndpoint,
                model,
                apiKey
            });
        }

        let regionNpcSkillAssignments = new Map();
        let regionSkillConversation = [...baseConversation];
        if (parsedNpcs.length) {
            try {
                const skillsLogPath = path.join(__dirname, 'logs', `region_${region.id}_npc_skills.log`);
                const skillResult = await requestNpcSkillAssignments({
                    baseMessages: baseConversation,
                    chatEndpoint,
                    model,
                    apiKey,
                    logPath: skillsLogPath
                });
                regionNpcSkillAssignments = skillResult.assignments || new Map();
                regionSkillConversation = Array.isArray(skillResult.conversation) ? skillResult.conversation : regionSkillConversation;
            } catch (skillError) {
                console.warn(`Failed to generate skills for region NPCs (${region.id}):`, skillError.message);
            }
        }

        let regionNpcAbilityAssignments = new Map();
        if (parsedNpcs.length) {
            try {
                const abilitiesLogPath = path.join(__dirname, 'logs', `region_${region.id}_npc_abilities.log`);
                const abilityResult = await requestNpcAbilityAssignments({
                    baseMessages: regionSkillConversation,
                    chatEndpoint,
                    model,
                    apiKey,
                    logPath: abilitiesLogPath
                });
                regionNpcAbilityAssignments = abilityResult.assignments || new Map();
            } catch (abilityError) {
                console.warn(`Failed to generate abilities for region NPCs (${region.id}):`, abilityError.message);
            }
        }

        const previousRegionNpcIds = Array.isArray(region.npcIds) ? [...region.npcIds] : [];
        for (const npcId of previousRegionNpcIds) {
            const existingNpc = players.get(npcId);
            if (existingNpc) {
                const npcLocationId = existingNpc.currentLocation;
                const npcLocation = npcLocationId ? gameLocations.get(npcLocationId) : null;
                if (npcLocation && typeof npcLocation.setNpcIds === 'function') {
                    const remaining = npcLocation.npcIds.filter(id => id !== npcId);
                    npcLocation.setNpcIds(remaining);
                }
                players.delete(npcId);
            }
        }
        region.npcIds = [];

        const created = [];
        for (const npcData of parsedNpcs) {
            const attributes = {};
            const attrSource = npcData.attributes || {};
            for (const attrName of Object.keys(attributeDefinitionsForPrompt)) {
                const lowerKey = typeof attrName === 'string' ? attrName.toLowerCase() : attrName;
                const rating = attrSource[attrName] ?? attrSource[lowerKey];
                attributes[attrName] = mapNpcRatingToValue(rating);
            }

            let targetLocation = null;
            if (npcData.location) {
                const normalized = normalizeRegionLocationName(npcData.location);
                if (normalized && locationLookup.has(normalized)) {
                    targetLocation = locationLookup.get(normalized);
                }
            }
            if (!targetLocation && regionLocations.length > 0) {
                targetLocation = regionLocations[0];
            }

            const npc = new Player({
                name: npcData.name || 'Unnamed NPC',
                description: npcData.description || '',
                shortDescription: npcData.shortDescription || '',
                class: npcData.class || 'citizen',
                race: npcData.race || 'human',
                level: 1,
                location: targetLocation ? targetLocation.id : null,
                attributes,
                isNPC: true,
                healthAttribute: npcData.healthAttribute
            });

            const baseLevelReference = Number.isFinite(region.averageLevel)
                ? region.averageLevel
                : (currentPlayer?.level || 1);
            const npcRelativeLevel = Number.isFinite(npcData.relativeLevel) ? npcData.relativeLevel : 0;
            const npcLevel = clampLevel(baseLevelReference + npcRelativeLevel, baseLevelReference);
            try {
                npc.setLevel(npcLevel);
            } catch (_) {
                // ignore level adjustment failures
            }

            npc.originRegionId = region.id;
            npc.isRegionImportant = true;

            players.set(npc.id, npc);

            if (targetLocation && typeof targetLocation.addNpcId === 'function') {
                targetLocation.addNpcId(npc.id);
            }

            region.npcIds.push(npc.id);
            created.push(npc);
            console.log(`🌟 Created region NPC ${npc.name} (${npc.id}) for region ${region.id}`);

            const regionSkillAssignment = regionNpcSkillAssignments.get(((npcData.name || '').trim().toLowerCase()));
            if (regionSkillAssignment && Array.isArray(regionSkillAssignment.skills) && regionSkillAssignment.skills.length) {
                applyNpcSkillAllocations(npc, regionSkillAssignment.skills);
            }

            const regionAbilityAssignment = regionNpcAbilityAssignments.get(((npcData.name || '').trim().toLowerCase()));
            if (regionAbilityAssignment && Array.isArray(regionAbilityAssignment.abilities) && regionAbilityAssignment.abilities.length) {
                applyNpcAbilities(npc, regionAbilityAssignment.abilities);
            }

            await generateInventoryForCharacter({
                character: npc,
                characterDescriptor: { role: npcData.role, class: npcData.class, race: npcData.race },
                region,
                location: targetLocation,
                chatEndpoint,
                model,
                apiKey
            });

            if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
                npc.imageId = null;
            } else {
                console.log(`🎭 Skipping region NPC portrait for ${npc.name} (${npc.id}) - outside player context`);
            }
        }

        return created;
    } catch (error) {
        console.warn(`Region NPC generation skipped for region ${region.id}:`, error.message);
        return [];
    }
}



function renderLocationImagePrompt(location) {
    try {
        const templateName = 'location-image.xml.njk';

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

        // Parse the XML and extract both systemPrompt and generationPrompt
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedXML.systemPrompt;
        const generationPrompt = parsedXML.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Missing systemPrompt or generationPrompt in location image template');
        }

        // Return the prompts for LLM processing (not the final image prompt yet)
        return {
            renderedTemplate: renderedTemplate,
            systemPrompt: systemPrompt.trim(),
            generationPrompt: generationPrompt.trim()
        };

    } catch (error) {
        console.error('Error rendering location image template:', error);
        // Fallback to simple prompt structure
        return {
            systemPrompt: "You are a specialized prompt generator for creating fantasy RPG location scene images.",
            generationPrompt: `Create an image prompt for: ${location ? location.description : 'A mysterious place'}, high quality fantasy environment art, detailed location scene`
        };
    }
}

// Function to render location exit image prompt from template
function renderLocationExitImagePrompt(locationExit) {
    try {
        const templateName = 'locationexit-image.xml.njk';

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

        // Parse the XML and extract generationPrompt
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const generationPrompt = parsedXML.generationPrompt;

        if (!generationPrompt) {
            throw new Error('No generationPrompt found in location exit image template');
        }

        return generationPrompt.trim();

    } catch (error) {
        console.error('Error rendering location exit image template:', error);
        // Fallback to simple prompt
        return `Fantasy RPG passage scene: ${locationExit ? locationExit.description : 'A mysterious passage'}, high quality fantasy pathway art, detailed exit passage`;
    }
}

// Function to render thing image prompt from template
function renderThingImagePrompt(thing) {
    try {
        // Select the appropriate template based on thing type
        const templateName = thing.thingType === 'item'
            ? 'item-image.xml.njk'
            : 'scenery-image.xml.njk';

        // Set up variables for the template
        const settingSnapshot = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(settingSnapshot);
        const metadata = thing.metadata || {};
        const locationId = metadata.locationId || thing.currentLocation || null;
        const location = locationId ? gameLocations.get(locationId) || null : null;
        const region = location ? findRegionByLocationId(location.id) || null : null;

        const variables = {
            setting: {
                name: settingSnapshot?.name || '',
                description: settingDescription || '',
                genre: settingSnapshot?.genre || '',
                theme: settingSnapshot?.theme || '',
                magicLevel: settingSnapshot?.magicLevel || '',
                techLevel: settingSnapshot?.techLevel || '',
                tone: settingSnapshot?.tone || ''
            },
            regionName: region?.name || '',
            regionDescription: region?.description || '',
            locationName: location?.name || '',
            locationDescription: location?.description || location?.stubMetadata?.blueprintDescription || '',
            thingName: thing.name,
            thingType: metadata.itemType || thing.itemTypeDetail || thing.thingType,
            thingDescription: thing.description,
            thingRarity: metadata.rarity || thing.rarity || 'Common'
        };

        console.log(`Rendering ${thing.thingType} image template for ${thing.id}: ${thing.name}`);

        // Log call stack to console
        //console.trace('Thing image prompt render call stack:');

        // Render the template with the variables
        const renderedTemplate = promptEnv.render(templateName, variables);

        const logTimestamp = Date.now();
        let logPath = null;
        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const safeThingId = typeof thing.id === 'string' ? thing.id.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
            logPath = path.join(logDir, `item_image_${logTimestamp}_${safeThingId}.log`);
            const logParts = [
                `Timestamp: ${new Date(logTimestamp).toISOString()}`,
                `Thing ID: ${thing.id}`,
                `Thing Name: ${thing.name}`,
                '=== TEMPLATE CONTEXT ===',
                JSON.stringify(variables, null, 2),
                '=== RENDERED TEMPLATE ===',
                renderedTemplate,
                ''
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log item image template:', logError.message);
        }

        const parsedTemplate = parseXMLTemplate(renderedTemplate);
        try {
            if (logPath) {
                const appendParts = [
                    '=== PARSED GENERATION PROMPT ===',
                    parsedTemplate.generationPrompt || '(none)',
                    ''
                ];
                fs.appendFileSync(logPath, appendParts.join('\n'), 'utf8');
            }
        } catch (logError) {
            console.warn('Failed to append item image prompt log:', logError.message);
        }

        if (!parsedTemplate.generationPrompt) {
            throw new Error(`No generationPrompt found in ${templateName} template`);
        }

        return parsedTemplate;
    } catch (error) {
        console.error('Error rendering thing image template:', error);
        // Fallback to simple prompt
        const typeSpecific = thing.thingType === 'item'
            ? 'detailed item, close-up object view'
            : 'atmospheric scenery, environmental feature';
        return {
            systemPrompt: "You are a specialized prompt generator for creating fantasy RPG object images.",
            generationPrompt: `Fantasy RPG ${thing.thingType}: ${thing.description}, high quality fantasy art, ${typeSpecific}`,
            renderedTemplate: `Fallback template for ${thing.name}`
        };
    }
}

// Function to render location generator prompt from template
function renderLocationGeneratorPrompt(options = {}) {
    try {
        const activeSetting = getActiveSettingSnapshot();
        const isStubExpansion = Boolean(options.isStubExpansion);
        const templateName = isStubExpansion
            ? 'location-generator.stub.xml.njk'
            : 'location-generator.full.xml.njk';

        const baseVariables = {
            setting: options.setting || describeSettingForPrompt(activeSetting),
            existingLocations: options.existingLocations || [],
            shortDescription: options.shortDescription || null,
            locationTheme: options.locationTheme || options.theme || null,
            playerLevel: options.playerLevel || null,
            locationPurpose: options.locationPurpose || null,
            relativeLevel: options.relativeLevel ?? null,
            regionAverageLevel: options.regionAverageLevel ?? null
        };

        const variables = isStubExpansion
            ? {
                ...baseVariables,
                originLocationName: options.originLocationName || null,
                originDescription: options.originDescription || null,
                originDirection: options.originDirection || null,
                stubName: options.stubName || null,
                stubId: options.stubId || null
            }
            : baseVariables;

        // Render the template
        const renderedTemplate = promptEnv.render(templateName, variables);

        // Parse the XML and extract both systemPrompt and generationPrompt
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedXML.systemPrompt;
        const generationPrompt = parsedXML.generationPrompt;

        if (!systemPrompt) {
            throw new Error('No systemPrompt found in location generator template');
        }

        if (!generationPrompt) {
            throw new Error('No generationPrompt found in location generator template');
        }

        //console.log('Generated location generator prompt with variables:', variables);
        return { systemPrompt: systemPrompt.trim(), generationPrompt: generationPrompt.trim() };

    } catch (error) {
        console.error('Error rendering location generator template:', error);
        // Fallback to simple prompt
        return `Generate a new fantasy RPG location. Return an XML snippet in this format: <location><name>Location Name</name><description>Detailed description of the location</description><baseLevel>5</baseLevel></location>`;
    }
}

function renderRegionGeneratorPrompt(options = {}) {
    try {
        const templateName = 'region-generator.full.xml.njk';
        const activeSetting = getActiveSettingSnapshot();
        const variables = {
            setting: options.setting || describeSettingForPrompt(activeSetting),
            regionName: options.regionName || null,
            regionDescription: options.regionDescription || null,
            regionNotes: options.regionNotes || null
        };

        const renderedTemplate = promptEnv.render(templateName, variables);
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsedXML.systemPrompt;
        const generationPrompt = parsedXML.generationPrompt;

        if (!systemPrompt || !generationPrompt) {
            throw new Error('Region generator template missing systemPrompt or generationPrompt');
        }

        return {
            systemPrompt: systemPrompt.trim(),
            generationPrompt: generationPrompt.trim()
        };
    } catch (error) {
        console.error('Error rendering region generator template:', error);
        return {
            systemPrompt: 'You are an AI gamemaster. Design a cohesive region for an RPG world.',
            generationPrompt: 'Generate a region with 5 locations in XML format describing names, descriptions, and exit connections.'
        };
    }
}

// Function to generate player portrait image
async function generatePlayerImage(player, options = {}) {
    try {
        const { force = false } = options;

        if (!player) {
            throw new Error('Player object is required');
        }

        if (player.isNPC && !force && !shouldGenerateNpcImage(player)) {
            console.log(`🎭 Skipping NPC portrait for ${player.name} (${player.id}) - outside player context`);
            return {
                success: false,
                skipped: true,
                reason: 'not-in-context'
            };
        }

        const activeJobId = getEntityJob('player', player.id);
        if (activeJobId) {
            const snapshot = getJobSnapshot(activeJobId);
            console.log(`🎨 Portrait job ${activeJobId} already in progress for ${player.name}, returning existing job`);
            return {
                success: true,
                existingJob: true,
                jobId: activeJobId,
                job: snapshot
            };
        }

        if (player.imageId && !force && hasExistingImage(player.imageId)) {
            console.log(`🎨 ${player.name} (${player.id}) already has a portrait (${player.imageId}), skipping regeneration`);
            return {
                success: true,
                skipped: true,
                imageId: player.imageId
            };
        }

        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping player portrait generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping player portrait generation');
            return {
                success: false,
                skipped: true,
                reason: 'no-client'
            };
        }

        if (force && player.imageId) {
            // Clear existing image reference so a new job can be tracked with a fresh ID
            player.imageId = null;
        }

        // Generate the portrait prompt
        const portraitPrompt = renderPlayerPortraitPrompt(player);
        const { prompt: finalImagePrompt, durationSeconds: promptDurationSeconds } = await generateImagePromptFromTemplate(portraitPrompt);

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `player_${player.id}_portrait.log`);
            const parts = [
                formatDurationLine(promptDurationSeconds),
                '=== PORTRAIT SYSTEM PROMPT ===',
                portraitPrompt.systemPrompt || '(none)',
                '\n=== PORTRAIT GENERATION PROMPT ===',
                portraitPrompt.generationPrompt || '(none)',
                '\n=== PORTRAIT LLM OUTPUT ===',
                finalImagePrompt,
                '\n'
            ];
            fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log portrait prompt:', logError.message);
        }

        // Create image generation job with player-specific settings
        const jobId = generateImageId();
        const payload = {
            prompt: finalImagePrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, distorted, multiple faces, deformed, ugly, bad anatomy, bad proportions',
            // Track which player this image is for
            playerId: player.id,
            isPlayerPortrait: true,
            force
        };

        console.log(`🎨 Generating portrait for player ${player.name} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        setEntityJob('player', player.id, jobId);
        player.pendingImageJobId = jobId;
        console.log(`🎨 Queued portrait generation for player ${player.name}, tracking with job ID: ${jobId}`);

        return {
            success: true,
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

// Function to generate image prompt using LLM
async function generateImagePromptFromTemplate(prompts) {
    try {
        // Prepare the messages for the AI API
        const messages = [
            {
                role: 'system',
                content: prompts.systemPrompt
            },
            {
                role: 'user',
                content: prompts.generationPrompt
            }
        ];

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
            messages: messages,
            max_tokens: config.ai.maxTokens || 500,
            temperature: config.ai.temperature || 0.3  // Lower temperature for more consistent output
        };

        console.log('🤖 Requesting image prompt generation from LLM...');

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000 // 60 second timeout
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid response from AI API');
        }

        let generatedImagePrompt = response.data.choices[0].message.content;
        //console.log('📥 LLM Generated Image Prompt:', generatedImagePrompt);

        // Clean the prompt to remove potential problematic characters
        generatedImagePrompt = generatedImagePrompt
            .replace(/[""]/g, '"')     // Normalize quotes
            .replace(/['']/g, "'")     // Normalize apostrophes
            .replace(/[—–]/g, '-')     // Normalize dashes
            .trim();

        //console.log('🧽 Cleaned Image Prompt:', generatedImagePrompt);

        return {
            prompt: generatedImagePrompt,
            durationSeconds: (Date.now() - requestStart) / 1000
        };

    } catch (error) {
        console.error('Error generating image prompt with LLM:', error);
        // Fallback to the user prompt if LLM fails
        return {
            prompt: prompts.generationPrompt,
            durationSeconds: null
        };
    }
}

// Function to generate location scene image
async function generateLocationImage(location, options = {}) {
    try {
        const { force = false } = options;
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping location scene generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping location scene generation');
            return {
                success: false,
                skipped: true,
                reason: 'no-client'
            };
        }

        if (!location) {
            throw new Error('Location object is required');
        }

        if (!force && (!currentPlayer || currentPlayer.currentLocation !== location.id)) {
            console.log(`🏞️ Skipping scene generation for ${location.id} - not the current player location`);
            return {
                success: false,
                skipped: true,
                reason: 'not-in-context'
            };
        }

        if (pendingLocationImages.has(location.id)) {
            const pendingJobId = pendingLocationImages.get(location.id);
            const pendingJob = imageJobs.get(pendingJobId);
            console.log(`🏞️ Location ${location.id} already has a pending image job (${pendingJobId}), skipping new request`);
            if (pendingJob) {
                return {
                    success: true,
                    existingJob: true,
                    job: getJobSnapshot(pendingJobId)
                };
            }
            return {
                success: false,
                skipped: true,
                reason: 'pending-unknown'
            };
        }

        if (location.imageId && !force && hasExistingImage(location.imageId)) {
            console.log(`🏞️ Location ${location.id} already has an image (${location.imageId}), skipping regeneration`);
            return {
                success: true,
                skipped: true,
                imageId: location.imageId
            };
        }

        if (force && location.imageId) {
            location.imageId = null;
        }

        // Generate the location scene prompt using LLM
        const promptTemplate = renderLocationImagePrompt(location);
        const { prompt: finalImagePrompt } = await generateImagePromptFromTemplate(promptTemplate);

        // Create image generation job with location-specific settings
        const jobId = generateImageId();
        const locationImageSettings = config.imagegen.location_settings?.image || {};
        const defaultImageSettings = config.imagegen.default_settings?.image || {};
        const payload = {
            prompt: finalImagePrompt,
            width: locationImageSettings.width || defaultImageSettings.width || 1024,
            height: locationImageSettings.height || defaultImageSettings.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, modern elements, cars, technology, people, characters, portraits, indoor scenes only',
            // Track which location this image is for
            locationId: location.id,
            renderedTemplate: promptTemplate.renderedTemplate,
            isLocationScene: true,
            force
        };

        console.log(`🏞️ Generating scene for location ${location.id} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Set imageId to the job ID temporarily - it will be updated to the final imageId when generation completes
        location.pendingImageJobId = jobId;
        pendingLocationImages.set(location.id, jobId);
        console.log(`🏞️ Queued scene generation for location ${location.id}, tracking with job ID: ${jobId}`);

        return {
            success: true,
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
async function generateLocationExitImage(locationExit, options = {}) {
    try {
        const { force = false } = options;
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping location exit passage generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping location exit passage generation');
            return {
                success: false,
                skipped: true,
                reason: 'no-client'
            };
        }

        if (!locationExit) {
            throw new Error('LocationExit object is required');
        }

        const activeJobId = getEntityJob('location-exit', locationExit.id);
        if (activeJobId) {
            console.log(`🚪 Image job ${activeJobId} already running for exit ${locationExit.id}, returning existing job`);
            return {
                success: true,
                existingJob: true,
                jobId: activeJobId,
                job: getJobSnapshot(activeJobId)
            };
        }

        if (locationExit.imageId && !force && hasExistingImage(locationExit.imageId)) {
            console.log(`🚪 Location exit ${locationExit.id} already has an image (${locationExit.imageId}), skipping regeneration`);
            return {
                success: true,
                skipped: true,
                imageId: locationExit.imageId
            };
        }

        if (force && locationExit.imageId) {
            locationExit.imageId = null;
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
            isLocationExitImage: true,
            force
        };

        console.log(`🚪 Generating passage for location exit ${locationExit.id} with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        setEntityJob('location-exit', locationExit.id, jobId);
        locationExit.pendingImageJobId = jobId;
        console.log(`🚪 Queued passage generation for location exit ${locationExit.id}, tracking with job ID: ${jobId}`);

        return {
            success: true,
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

// Function to generate thing image
async function generateThingImage(thing, options = {}) {
    try {
        const { force = false } = options;
        console.log(`Starting image generation process for thing ${thing.id}: ${thing.name}`);
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping thing image generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping thing image generation');
            return {
                success: false,
                skipped: true,
                reason: 'no-client'
            };
        }

        if (!thing) {
            throw new Error('Thing object is required');
        }

        console.log(`Checking existing image for thing ${thing.name}: ${thing.imageId || 'none'}`);

        const activeJobId = getEntityJob('thing', thing.id);
        if (activeJobId) {
            console.log(`🎒 Image job ${activeJobId} already running for ${thing.name}, returning existing job`);
            return {
                success: true,
                existingJob: true,
                jobId: activeJobId,
                job: getJobSnapshot(activeJobId)
            };
        }

        if (thing.imageId && !force && hasExistingImage(thing.imageId)) {
            console.log(`🎒 ${thing.name} (${thing.id}) already has an image (${thing.imageId}), skipping regeneration`);
            return {
                success: true,
                skipped: true,
                imageId: thing.imageId
            };
        }

        if (!force && !shouldGenerateThingImage(thing)) {
            console.log(`🎒 Skipping ${thing.thingType} image generation for ${thing.name} (${thing.id}) - item not in player inventory`);
            return {
                success: false,
                skipped: true,
                reason: 'not-visible'
            };
        }

        if (force && thing.imageId) {
            thing.imageId = null;
        }

        // Generate the thing image prompt using LLM
        const promptTemplate = renderThingImagePrompt(thing);
        const { prompt: finalImagePrompt } = await generateImagePromptFromTemplate(promptTemplate);

        // Create image generation job with thing-specific settings
        const jobId = generateImageId();

        // Determine appropriate dimensions based on thing type
        let width = config.imagegen.default_settings.image.width || 1024;
        let height = config.imagegen.default_settings.image.height || 1024;

        // Items might work better with square or portrait orientation
        if (thing.thingType === 'item') {
            width = 1024;
            height = 1024; // Square for items
        } else {
            // Scenery might work better with landscape
            width = 1024;
            height = 768;
        }

        const payload = {
            prompt: finalImagePrompt,
            width: width,
            height: height,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: thing.thingType === 'item'
                ? 'blurry, low quality, people, characters, hands, multiple objects, cluttered background, modern elements'
                : 'blurry, low quality, people, characters, modern elements, cars, technology, indoor scenes, portraits',
            // Track which thing this image is for
            thingId: thing.id,
            renderedTemplate: promptTemplate.renderedTemplate,
            isThingImage: true,
            force
        };

        console.log(`🎨 Generating ${thing.thingType} image for ${thing.name} (${thing.id}) with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        setEntityJob('thing', thing.id, jobId);
        thing.pendingImageJobId = jobId;
        console.log(`🎨 Queued ${thing.thingType} image generation for ${thing.name}, tracking with job ID: ${jobId}`);

        return {
            success: true,
            jobId: jobId,
            status: job.status,
            message: `Thing ${thing.thingType} image generation job queued`,
            estimatedTime: '30-90 seconds'
        };

    } catch (error) {
        console.error('Error generating thing image:', error);
        throw error;
    }
}

// Function to generate a new location using AI
async function generateLocationFromPrompt(options = {}) {
    try {
        const {
            stubLocation = null,
            originLocation = null,
            createStubs = false,
            ...promptOverrides
        } = options;

        const isStubExpansion = Boolean(stubLocation);
        const stubMetadata = stubLocation ? stubLocation.stubMetadata || {} : {};
        const resolvedOriginLocation = originLocation || (stubMetadata.originLocationId ? Location.get(stubMetadata.originLocationId) : null);

        if (isStubExpansion && (!stubLocation || !stubLocation.id)) {
            throw new Error('Stub expansion requested without a valid stub location');
        }

        if (isStubExpansion && !resolvedOriginLocation) {
            console.warn(`Stub ${stubLocation.id} has no resolvable origin location. Expansion will proceed without origin context.`);
        }

        // Prepare template overrides and stub context for prompt rendering
        const templateOverrides = { ...promptOverrides };

        if (isStubExpansion) {
            if (!templateOverrides.shortDescription && stubMetadata.shortDescription) {
                templateOverrides.shortDescription = stubMetadata.shortDescription;
            }
            if (!templateOverrides.locationPurpose && stubMetadata.locationPurpose) {
                templateOverrides.locationPurpose = stubMetadata.locationPurpose;
            }
            if (!templateOverrides.locationTheme && stubMetadata.themeHint) {
                templateOverrides.locationTheme = stubMetadata.themeHint;
            }
            if (!templateOverrides.playerLevel) {
                if (Number.isFinite(stubMetadata.regionAverageLevel)) {
                    templateOverrides.playerLevel = stubMetadata.regionAverageLevel;
                } else if (currentPlayer?.level) {
                    templateOverrides.playerLevel = currentPlayer.level;
                }
            }
            if (stubMetadata.relativeLevel !== undefined && templateOverrides.relativeLevel === undefined) {
                templateOverrides.relativeLevel = stubMetadata.relativeLevel;
            }
            if (stubMetadata.regionAverageLevel !== undefined && templateOverrides.regionAverageLevel === undefined) {
                templateOverrides.regionAverageLevel = stubMetadata.regionAverageLevel;
            }
        } else if (!templateOverrides.playerLevel && currentPlayer?.level) {
            templateOverrides.playerLevel = currentPlayer.level;
        }

        const stubTemplateData = isStubExpansion ? {
            stubId: stubLocation.id,
            stubName: stubLocation.name,
            originLocationName: resolvedOriginLocation?.name || null,
            originDirection: stubMetadata.originDirection || null,
            originDescription: resolvedOriginLocation?.description || null
        } : null;

        const templateOptions = {
            ...templateOverrides,
            isStubExpansion,
            stubId: stubTemplateData?.stubId || null,
            stubName: stubTemplateData?.stubName || null,
            originLocationName: stubTemplateData?.originLocationName || null,
            originDescription: stubTemplateData?.originDescription || null,
            originDirection: stubTemplateData?.originDirection || null
        };

        // Generate the system prompt using the template
        const { systemPrompt, generationPrompt } = renderLocationGeneratorPrompt(templateOptions);

        // Prepare the messages for the AI API
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: generationPrompt
            }
        ];

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
            messages: messages,
            max_tokens: config.ai.maxTokens || 1000,
            temperature: config.ai.temperature || 0.7
        };

        console.log('🤖 Requesting location generation from AI...');
        console.log('📝 System Prompt:', systemPrompt);
        //console.log('📤 Full Request Data:', JSON.stringify(requestData, null, 2));

        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000 // 60 second timeout
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid response from AI API');
        }

        const aiResponse = response.data.choices[0].message.content;
        //console.log('📥 AI Raw Response:');
        //console.log('='.repeat(50));
        //console.log(aiResponse);
        //console.log('='.repeat(50));

        // Parse the XML response using Location.fromXMLSnippet()
        const regionAverageLevel = templateOverrides.regionAverageLevel ?? stubMetadata.regionAverageLevel ?? null;
        const fallbackPlayerLevel = currentPlayer?.level || null;
        const relativeLevelBase = Number.isFinite(regionAverageLevel)
            ? regionAverageLevel
            : (Number.isFinite(templateOverrides.playerLevel) ? templateOverrides.playerLevel : fallbackPlayerLevel);

        const stubBaseLevel = Number.isFinite(stubLocation?.baseLevel)
            ? stubLocation.baseLevel
            : (Number.isFinite(stubMetadata.computedBaseLevel) ? stubMetadata.computedBaseLevel : null);

        const baseLevelFallback = isStubExpansion
            ? (Number.isFinite(relativeLevelBase) ? relativeLevelBase : stubBaseLevel)
            : (Number.isFinite(relativeLevelBase) ? relativeLevelBase : fallbackPlayerLevel);

        const location = isStubExpansion
            ? Location.fromXMLSnippet(aiResponse, {
                existingLocation: stubLocation,
                allowRename: Boolean(stubMetadata.allowRename),
                baseLevelFallback: Number.isFinite(stubBaseLevel) ? stubBaseLevel : baseLevelFallback,
                relativeLevelBase
            })
            : Location.fromXMLSnippet(aiResponse, {
                baseLevelFallback,
                relativeLevelBase
            });

        if (!location) {
            throw new Error('Failed to parse location from AI response');
        }

        console.log(`🏗️  Successfully generated location: ${location.name || location.id}`);

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `location_${location.id}.log`);
            const logParts = [
                formatDurationLine(apiDurationSeconds),
                '=== LOCATION GENERATION PROMPT ===',
                generationPrompt,
                '\n=== LOCATION GENERATION RESPONSE ===',
                aiResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
            console.log(`📝 Location generation logged to ${logPath}`);
        } catch (logError) {
            console.warn('Failed to write location generation log:', logError.message);
        }

        // Store the location in gameLocations
        gameLocations.set(location.id, location);
        console.log(`💾 Added location ${location.id} to game world (total: ${gameLocations.size})`);

        try {
            await generateLocationThingsForLocation({
                location,
                chatEndpoint,
                model,
                apiKey
            });
        } catch (thingError) {
            console.warn('Failed to generate location things:', thingError.message);
        }

        const newlyCreatedStubs = [];

        if (isStubExpansion && resolvedOriginLocation) {
            const travelDirection = stubMetadata.originDirection || 'forward';
            const cleanedDescription = `Path to ${location.name || 'an adjacent area'}`;
            ensureExitConnection(resolvedOriginLocation, travelDirection, location, { description: cleanedDescription, bidirectional: false });

            const reverseDirection = getOppositeDirection(travelDirection) || 'back';
            const returnDescription = `Path back to ${resolvedOriginLocation.name || 'the previous area'}`;
            ensureExitConnection(location, reverseDirection, resolvedOriginLocation, { description: returnDescription, bidirectional: false });
        }

        if (createStubs) {
            const themeHint = templateOverrides.locationTheme || templateOverrides.theme || stubMetadata.themeHint || null;
            const stubCreationContext = {
                themeHint,
                shortDescription: templateOverrides.shortDescription || null,
                locationPurpose: templateOverrides.locationPurpose || null,
                settingDescription: templateOverrides.setting || describeSettingForPrompt(getActiveSettingSnapshot())
            };

            const excludeDirections = [];
            if (isStubExpansion && stubMetadata.originDirection) {
                const reverseDir = getOppositeDirection(stubMetadata.originDirection);
                if (reverseDir) {
                    excludeDirections.push(reverseDir);
                }
            }

            newlyCreatedStubs.push(...createStubNeighbors(location, {
                excludeDirections,
                ...stubCreationContext
            }));

            if (newlyCreatedStubs.length > 0) {
                console.log(`🧭 ${location.name || location.id} now has ${newlyCreatedStubs.length} unexplored stub location(s) awaiting discovery.`);
            }
        }

        await generateLocationNPCs({
            location,
            systemPrompt,
            generationPrompt,
            aiResponse,
            regionTheme: templateOverrides.locationTheme || templateOverrides.theme || (stubMetadata ? stubMetadata.themeHint : null),
            chatEndpoint,
            model,
            apiKey
        });

        return {
            location: location,
            aiResponse: aiResponse,
            generationPrompt: generationPrompt,
            generationOptions: templateOptions,
            newStubs: newlyCreatedStubs,
            isStubExpansion
        };

    } catch (error) {
        console.error('Error generating location from prompt:', error);
        throw error;
    }
}

function renderRegionEntrancePrompt() {
    try {
        const templateName = 'region-generator-entrance.xml.njk';
        const renderedTemplate = promptEnv.render(templateName, {});
        const parsedXML = parseXMLTemplate(renderedTemplate);
        const generationPrompt = parsedXML.generationPrompt;

        if (!generationPrompt) {
            throw new Error('Region entrance template missing generationPrompt');
        }

        return generationPrompt.trim();
    } catch (error) {
        console.error('Error rendering region entrance template:', error);
        return 'From the preceding list of region locations, choose the most fitting entrance and respond only with <entrance><name>LOCATION NAME</name></entrance>.';
    }
}

function renderRegionExitsPrompt({ region, settingDescription }) {
    try {
        const templateName = 'region-generator-exits.xml.njk';
        const locationEntries = Array.isArray(region.locationIds)
            ? region.locationIds
                .map(id => gameLocations.get(id))
                .filter(Boolean)
                .map(loc => ({
                    name: loc.name || loc.id,
                    description: loc.description
                        || loc.stubMetadata?.blueprintDescription
                        || loc.stubMetadata?.shortDescription
                        || 'No description provided.'
                }))
            : [];

        const variables = {
            setting: settingDescription,
            currentRegion: {
                name: region.name,
                description: region.description,
                locations: locationEntries
            }
        };

        const rendered = promptEnv.render(templateName, variables);
        const parsed = parseXMLTemplate(rendered);

        if (!parsed.systemPrompt || !parsed.generationPrompt) {
            throw new Error('Region exits template missing prompts');
        }

        return {
            systemPrompt: parsed.systemPrompt.trim(),
            generationPrompt: parsed.generationPrompt.trim()
        };
    } catch (error) {
        console.error('Error rendering region exits template:', error);
        return null;
    }
}

function parseRegionExitsResponse(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return [];
    }

    const sanitize = (input) => `<root>${input}</root>`
        .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
        .replace(/<\s*br\s*>/gi, '<br/>')
        .replace(/<\s*hr\s*>/gi, '<hr/>');

    let doc;
    try {
        const parser = new DOMParser({
            errorHandler: {
                warning: () => { },
                error: () => { },
                fatalError: () => { }
            }
        });
        doc = parser.parseFromString(sanitize(xmlSnippet.trim()), 'text/xml');
    } catch (error) {
        console.warn('Failed to parse region exits XML:', error.message);
        return [];
    }

    if (!doc || doc.getElementsByTagName('parsererror')?.length) {
        console.warn('Region exits XML contained parser errors.');
        return [];
    }

    const regionNodes = Array.from(doc.getElementsByTagName('region'));
    if (!regionNodes.length) {
        return [];
    }

    const getTagValue = (node, tag) => {
        const element = node.getElementsByTagName(tag)?.[0];
        if (!element || typeof element.textContent !== 'string') {
            return null;
        }
        const value = element.textContent.trim();
        return value || null;
    };

    const results = [];
    for (const node of regionNodes) {
        const name = getTagValue(node, 'regionName');
        const description = getTagValue(node, 'regionDescription') || '';
        const relativeLevelValue = getTagValue(node, 'relativeLevel');
        const relationship = getTagValue(node, 'relationshipToCurrentRegion') || 'Adjacent';
        const exitLocation = getTagValue(node, 'exitLocation');

        if (!name || !exitLocation) {
            continue;
        }

        const relativeLevel = Number.parseInt(relativeLevelValue, 10);

        results.push({
            name,
            description,
            relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : 0,
            relationship,
            exitLocation
        });
    }

    return results;
}

function renderRegionStubPrompt({ settingDescription, region }) {
    try {
        const templateName = 'region-generator.stub.xml.njk';
        const variables = {
            setting: settingDescription,
            currentRegion: {
                name: region.name,
                description: region.description
            }
        };

        const renderedTemplate = promptEnv.render(templateName, variables);
        const parsed = parseXMLTemplate(renderedTemplate);

        if (!parsed.systemPrompt || !parsed.generationPrompt) {
            throw new Error('Region stub template missing prompts');
        }

        return {
            systemPrompt: parsed.systemPrompt.trim(),
            generationPrompt: parsed.generationPrompt.trim()
        };
    } catch (error) {
        console.error('Error rendering region stub template:', error);
        return null;
    }
}

function parseRegionStubLocations(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return [];
    }

    const sanitize = (input) => `<root>${input}</root>`
        .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
        .replace(/<\s*br\s*>/gi, '<br/>')
        .replace(/<\s*hr\s*>/gi, '<hr/>');

    let doc;
    try {
        const parser = new DOMParser({
            errorHandler: {
                warning: () => { },
                error: () => { },
                fatalError: () => { }
            }
        });
        doc = parser.parseFromString(sanitize(xmlSnippet.trim()), 'text/xml');
    } catch (error) {
        console.warn('Failed to parse region stub XML:', error.message);
        return [];
    }

    if (!doc || doc.getElementsByTagName('parsererror')?.length) {
        console.warn('Region stub XML contained parser errors.');
        return [];
    }

    const locationNodes = Array.from(doc.getElementsByTagName('location'));
    if (!locationNodes.length) {
        return [];
    }

    const getTagValue = (node, tag) => {
        const element = node.getElementsByTagName(tag)?.[0];
        if (!element || typeof element.textContent !== 'string') {
            return null;
        }
        const value = element.textContent.trim();
        return value || null;
    };

    return locationNodes.map(node => {
        const name = getTagValue(node, 'name');
        const description = getTagValue(node, 'description') || '';
        const relativeLevelRaw = getTagValue(node, 'relativeLevel');
        const exitsParent = node.getElementsByTagName('exits')?.[0];
        const exits = exitsParent
            ? Array.from(exitsParent.getElementsByTagName('exit'))
                .map(exitNode => exitNode.textContent?.trim())
                .filter(Boolean)
            : [];

        const relativeLevel = Number.parseInt(relativeLevelRaw, 10);

        return {
            name: name || 'Unnamed Location',
            description,
            exits,
            relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : 0
        };
    }).filter(Boolean);
}

function generateRegionStubId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    return `region_${timestamp}_${random}`;
}

async function generateRegionExitStubs({
    region,
    stubMap,
    settingDescription,
    regionAverageLevel,
    chatEndpoint,
    model,
    apiKey
}) {
    if (!region) {
        return;
    }

    const prompt = renderRegionExitsPrompt({ region, settingDescription });
    if (!prompt) {
        return;
    }

    const messages = [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.generationPrompt }
    ];

    const requestData = {
        model,
        messages,
        max_tokens: 1500,
        temperature: config.ai.temperature || 0.6
    };

    let aiResponse = '';
    try {
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        aiResponse = response.data?.choices?.[0]?.message?.content || '';
        const durationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
            const logPath = path.join(logDir, `region_exits_${region.id}_${timestamp}.log`);
            const logParts = [
                formatDurationLine(durationSeconds),
                '=== REGION EXITS PROMPT ===',
                prompt.generationPrompt,
                '\n=== REGION EXITS RESPONSE ===',
                aiResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log region exits generation:', logError.message);
        }
    } catch (error) {
        console.warn('Failed to generate region exits:', error.message);
        return;
    }

    const definitions = parseRegionExitsResponse(aiResponse);
    if (!definitions.length) {
        return;
    }

    for (const definition of definitions) {
        const normalizedExitName = normalizeRegionLocationName(definition.exitLocation);
        let sourceLocation = stubMap.get(normalizedExitName) || null;
        if (!sourceLocation) {
            sourceLocation = (region.locationIds || [])
                .map(id => gameLocations.get(id))
                .find(loc => loc && normalizeRegionLocationName(loc.name) === normalizedExitName);
        }

        if (!sourceLocation) {
            console.warn(`Unable to match exit location "${definition.exitLocation}" within region ${region.name}.`);
            continue;
        }

        const normalizedTargetName = normalizeRegionLocationName(definition.name);
        const existingExit = typeof sourceLocation.getAvailableDirections === 'function'
            ? sourceLocation.getAvailableDirections().some(direction => {
                const exit = sourceLocation.getExit(direction);
                if (!exit) {
                    return false;
                }
                if (exit.destinationRegion) {
                    const pending = pendingRegionStubs.get(exit.destinationRegion);
                    if (pending && normalizeRegionLocationName(pending.name) === normalizedTargetName) {
                        return true;
                    }
                }
                const destinationLocation = gameLocations.get(exit.destination);
                if (destinationLocation?.stubMetadata?.targetRegionId) {
                    const targetName = destinationLocation.stubMetadata.targetRegionName || '';
                    return normalizeRegionLocationName(targetName) === normalizedTargetName;
                }
                return false;
            })
            : false;

        if (existingExit) {
            continue;
        }

        const newRegionId = generateRegionStubId();
        const relationshipNormalized = (definition.relationship || 'Adjacent').trim().toLowerCase();
        const existingParent = region.parentRegionId || null;
        let newRegionParentId = null;

        if (relationshipNormalized === 'within') {
            newRegionParentId = region.id;
        } else if (relationshipNormalized === 'contains') {
            newRegionParentId = existingParent;
            if (!region.parentRegionId) {
                region.parentRegionId = newRegionId;
            } else if (region.parentRegionId !== newRegionId) {
                console.warn(`Region ${region.name} already has a parent region; skipping reassignment for "${definition.name}".`);
            }
        }

        const baseLevel = Number.isFinite(regionAverageLevel) ? regionAverageLevel : null;
        const relativeLevelOffset = Number.isFinite(definition.relativeLevel) ? definition.relativeLevel : 0;
        const computedBaseLevel = baseLevel !== null
            ? clampLevel(baseLevel + relativeLevelOffset, baseLevel)
            : null;

        const initialDirection = directionKeyFromName(definition.name, `path_${randomIntInclusive(100, 999)}`);
        let normalizedDirection = normalizeDirection(initialDirection) || initialDirection;
        let directionCandidate = normalizedDirection;
        let attempt = 2;
        while (typeof sourceLocation.getExit === 'function' && sourceLocation.getExit(directionCandidate)) {
            directionCandidate = `${normalizedDirection}_${attempt++}`;
        }
        normalizedDirection = directionCandidate;

        let stubName = `${definition.name}`;
        if (typeof Location.findByName === 'function') {
            let suffix = 2;
            let candidateName = stubName;
            while (Location.findByName(candidateName)) {
                candidateName = `${stubName} ${suffix++}`;
            }
            stubName = candidateName;
        }

        const stubMetadata = {
            originLocationId: sourceLocation.id,
            originRegionId: region.id,
            originDirection: normalizedDirection,
            regionId: newRegionId,
            shortDescription: `An unexplored path leading toward ${definition.name}.`,
            locationPurpose: `Entrance to ${definition.name}`,
            allowRename: false,
            isRegionEntryStub: true,
            targetRegionId: newRegionId,
            targetRegionName: definition.name,
            targetRegionDescription: definition.description,
            targetRegionRelationship: definition.relationship,
            targetRegionRelativeLevel: Number.isFinite(definition.relativeLevel) ? definition.relativeLevel : 0,
            settingDescription
        };

        if (newRegionParentId) {
            stubMetadata.targetRegionParentId = newRegionParentId;
        }
        if (baseLevel !== null) {
            stubMetadata.regionAverageLevel = baseLevel;
        }

        const regionEntryStub = new Location({
            name: stubName,
            description: null,
            baseLevel: computedBaseLevel,
            isStub: true,
            stubMetadata
        });

        gameLocations.set(regionEntryStub.id, regionEntryStub);
        stubMap.set(normalizeRegionLocationName(regionEntryStub.name), regionEntryStub);

        const exitDescription = `Path to ${definition.name}`;
        ensureExitConnection(sourceLocation, normalizedDirection, regionEntryStub, {
            description: exitDescription,
            bidirectional: false,
            destinationRegion: newRegionId
        });

        pendingRegionStubs.set(newRegionId, {
            id: newRegionId,
            name: definition.name,
            description: definition.description,
            relationship: definition.relationship,
            relativeLevel: Number.isFinite(definition.relativeLevel) ? definition.relativeLevel : 0,
            parentRegionId: newRegionParentId,
            sourceRegionId: region.id,
            exitLocationId: sourceLocation.id,
            entranceStubId: regionEntryStub.id,
            createdAt: new Date().toISOString()
        });

        console.log(`🌐 Created pending region stub for "${definition.name}" linked to ${region.name}.`);
    }
}


function parseRegionEntranceResponse(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return null;
    }

    try {
        const match = xmlSnippet.match(/<entrance>[\s\S]*?<\/entrance>/i);
        const entranceXml = match ? match[0] : xmlSnippet;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(entranceXml, 'text/xml');

        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const nameNode = xmlDoc.getElementsByTagName('name')[0];
        const nameText = nameNode ? nameNode.textContent.trim() : null;
        return nameText || null;
    } catch (error) {
        console.warn('Failed to parse region entrance response:', error.message);
        return null;
    }
}

async function instantiateRegionLocations({
    region,
    themeHint,
    regionAverageLevel,
    settingDescription,
    chatEndpoint,
    model,
    apiKey
}) {
    const stubMap = new Map();

    for (const blueprint of region.locationBlueprints) {
        const relativeLevel = Number.isFinite(blueprint.relativeLevel)
            ? blueprint.relativeLevel
            : 0;
        const computedBaseLevel = Number.isFinite(regionAverageLevel)
            ? clampLevel(regionAverageLevel + relativeLevel, regionAverageLevel)
            : null;

        const stub = new Location({
            name: blueprint.name,
            description: null,
            baseLevel: computedBaseLevel,
            isStub: true,
            stubMetadata: {
                regionId: region.id,
                regionName: region.name,
                blueprintDescription: blueprint.description,
                suggestedRegionExits: (blueprint.exits || []).map(exit => exit.target ?? exit),
                themeHint,
                shortDescription: blueprint.description,
                locationPurpose: `Part of the ${region.name} region`,
                allowRename: false,
                relativeLevel: Number.isFinite(relativeLevel) ? relativeLevel : null,
                regionAverageLevel: Number.isFinite(region.averageLevel) ? region.averageLevel : null,
                computedBaseLevel
            }
        });

        gameLocations.set(stub.id, stub);
        region.addLocationId(stub.id);
        const aliases = new Set();
        aliases.add(normalizeRegionLocationName(blueprint.name));
        if (Array.isArray(blueprint.aliases)) {
            blueprint.aliases.forEach(alias => aliases.add(normalizeRegionLocationName(alias)));
        }
        aliases.forEach(alias => {
            if (alias) {
                stubMap.set(alias, stub);
            }
        });
    }

    const addStubExit = (fromStub, toStub, label) => {
        if (!fromStub || !toStub || fromStub.id === toStub.id) {
            return;
        }

        const existingDir = fromStub.getAvailableDirections()
            .find(dir => {
                const exit = fromStub.getExit(dir);
                return exit && exit.destination === toStub.id;
            });

        if (existingDir) {
            const existingExit = fromStub.getExit(existingDir);
            if (existingExit && !existingExit.description) {
                try {
                    existingExit.description = `Path to ${toStub.name}`;
                } catch (_) {
                    existingExit.update({ description: `Path to ${toStub.name}` });
                }
            }
            return;
        }

        const directionKey = directionKeyFromName(label, `to_${toStub.id}`);
        const existing = fromStub.getExit(directionKey);
        if (existing) {
            try {
                existing.destination = toStub.id;
            } catch (_) {
                existing.update({ destination: toStub.id });
            }
            return;
        }

        const exit = new LocationExit({
            description: `Path to ${toStub.name}`,
            destination: toStub.id,
            bidirectional: false
        });
        fromStub.addExit(directionKey, exit);
    };

    for (const blueprint of region.locationBlueprints) {
        const sourceAliases = [normalizeRegionLocationName(blueprint.name)];
        if (Array.isArray(blueprint.aliases)) {
            sourceAliases.push(...blueprint.aliases.map(alias => normalizeRegionLocationName(alias)));
        }
        const sourceStub = sourceAliases
            .map(alias => stubMap.get(alias))
            .find(Boolean);
        if (!sourceStub) continue;
        const exits = blueprint.exits || [];

        exits.forEach(exitInfo => {
            const targetLabel = typeof exitInfo === 'string' ? exitInfo : exitInfo?.target;
            if (!targetLabel) return;
            const directionHint = typeof exitInfo === 'object' ? exitInfo.direction : null;

            const candidateAliases = [normalizeRegionLocationName(targetLabel)];
            const directStub = candidateAliases
                .map(alias => stubMap.get(alias))
                .find(Boolean);
            const targetStub = directStub;
            if (!targetStub) {
                return;
            }

            const forwardDirection = directionHint || targetLabel;
            addStubExit(sourceStub, targetStub, forwardDirection);
        });
    }

    for (const [fromId, fromLocation] of gameLocations.entries()) {
        if (!region.locationIds.includes(fromId)) {
            continue;
        }

        const directions = fromLocation.getAvailableDirections();
        for (const direction of directions) {
            const exit = fromLocation.getExit(direction);
            if (!exit) {
                continue;
            }

            const toLocation = gameLocations.get(exit.destination);
            if (!toLocation) {
                continue;
            }

            const hasReturn = typeof toLocation.getAvailableDirections === 'function' &&
                toLocation.getAvailableDirections().some(dir => {
                    const destExit = toLocation.getExit(dir);
                    return destExit && destExit.destination === fromId;
                });

            if (hasReturn) {
                continue;
            }

            const reverseDirection = getOppositeDirection(direction) || `return_${directionKeyFromName(fromLocation.name || fromId)}`;
            const description = `Path back to ${fromLocation.name || fromId}`;

            const reverseExit = new LocationExit({
                description,
                destination: fromId,
                bidirectional: false
            });
            toLocation.addExit(reverseDirection, reverseExit);
            console.log(`🔁 Added reverse stub exit from ${toLocation.name || toLocation.id} to ${fromLocation.name || fromId}`);
        }
    }

    await generateRegionExitStubs({
        region,
        stubMap,
        settingDescription,
        regionAverageLevel,
        chatEndpoint,
        model,
        apiKey
    });

    return stubMap;
}

async function chooseRegionEntrance({
    region,
    stubMap,
    systemPrompt,
    generationPrompt,
    aiResponse,
    chatEndpoint,
    model,
    apiKey
}) {
    let entranceLocationId = null;
    try {
        const entrancePrompt = renderRegionEntrancePrompt();
        const entranceMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt },
            { role: 'assistant', content: aiResponse },
            { role: 'user', content: entrancePrompt }
        ];

        const entranceRequest = {
            model,
            messages: entranceMessages,
            max_tokens: 200,
            temperature: config.ai.temperature || 0.7
        };

        console.log('🚪 Requesting region entrance selection...');
        const entranceResponse = await axios.post(chatEndpoint, entranceRequest, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const entranceMessage = entranceResponse.data?.choices?.[0]?.message?.content;
        const entranceName = parseRegionEntranceResponse(entranceMessage);

        if (entranceName) {
            const matchedStub = stubMap.get(normalizeRegionLocationName(entranceName));
            if (matchedStub) {
                entranceLocationId = matchedStub.id;
                const metadata = matchedStub.stubMetadata || {};
                metadata.isRegionEntrance = true;
                matchedStub.stubMetadata = metadata;
                region.entranceLocationId = matchedStub.id;
                return {
                    locationId: matchedStub.id,
                    location: matchedStub
                };
            } else {
                console.warn(`Entrance location "${entranceName}" not found among generated stubs.`);
            }
        } else {
            console.warn('Entrance selection response did not include a <name> tag.');
        }
    } catch (entranceError) {
        console.warn('Failed to determine region entrance:', entranceError.message);
    }

    if (!entranceLocationId && region.locationIds.length > 0) {
        const fallback = gameLocations.get(region.locationIds[0]);
        if (fallback) {
            region.entranceLocationId = fallback.id;
            return {
                locationId: fallback.id,
                location: fallback
            };
        }
    }

    return {
        locationId: entranceLocationId,
        location: entranceLocationId ? gameLocations.get(entranceLocationId) : null
    };
}

async function generateRegionFromPrompt(options = {}) {
    try {
        const settingDescription = options.setting || describeSettingForPrompt(getActiveSettingSnapshot());
        const generationOptions = { ...options, setting: settingDescription };
        const { systemPrompt, generationPrompt } = renderRegionGeneratorPrompt(generationOptions);

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        const endpoint = config.ai.endpoint;
        const apiKey = config.ai.apiKey;
        const model = config.ai.model;

        const chatEndpoint = endpoint.endsWith('/') ?
            endpoint + 'chat/completions' :
            endpoint + '/chat/completions';

        // We need lots of tokens for large regions.
        const requestData = {
            model,
            messages,
            max_tokens: 6000,
            temperature: config.ai.temperature || 0.7
        };

        console.log('🗺️ Requesting region generation from AI...');
        const requestStart = Date.now();
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 120000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid response from AI API for region generation');
        }

        const aiResponse = response.data.choices[0].message.content;
        console.log('📥 Region AI Response received.');

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        // Get timestamp with milliseconds for log filename
        const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
        const regionLogId = `region_${timestamp}`;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `${regionLogId}.log`);
            const logParts = [
                formatDurationLine(apiDurationSeconds),
                '=== REGION GENERATION PROMPT ===',
                generationPrompt,
                '\n=== REGION GENERATION RESPONSE ===',
                aiResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
            console.log(`📝 Region generation logged to ${logPath}`);
        } catch (logError) {
            console.warn('Failed to write region generation log:', logError.message);
        }

        const region = Region.fromXMLSnippet(aiResponse);
        regions.set(region.id, region);

        const themeHint = generationOptions.regionNotes || null;

        const baseAverageLevel = Number.isFinite(region.averageLevel)
            ? region.averageLevel
            : (Number.isFinite(generationOptions.averageLevel) ? generationOptions.averageLevel : 1);
        const regionAverageLevel = baseAverageLevel;

        let stubMap = new Map();
        try {
            stubMap = await instantiateRegionLocations({
                region,
                themeHint,
                regionAverageLevel,
                settingDescription,
                chatEndpoint,
                model,
                apiKey
            });
        } catch (instantiationError) {
            console.warn('Failed to instantiate region structure:', instantiationError.message);
        }

        const entranceInfo = await chooseRegionEntrance({
            region,
            stubMap,
            systemPrompt,
            generationPrompt,
            aiResponse,
            chatEndpoint,
            model,
            apiKey
        });
        const entranceLocationId = entranceInfo.locationId || null;
        if (!region.entranceLocationId && entranceLocationId) {
            region.entranceLocationId = entranceLocationId;
        }

        await generateRegionNPCs({
            region,
            systemPrompt,
            generationPrompt,
            aiResponse,
            chatEndpoint,
            model,
            apiKey
        });

        return {
            region,
            aiResponse,
            entranceLocationId,
            createdLocations: region.locationIds.map(id => gameLocations.get(id)).filter(Boolean)
        };
    } catch (error) {
        console.error('Error generating region from prompt:', error);
        throw error;
    }
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Route for AI RPG Chat Interface
app.get('/', (req, res) => {
    const systemPrompt = renderSystemPrompt(currentSetting);
    res.render('index.njk', {
        title: 'AI RPG Chat Interface',
        systemPrompt: systemPrompt,
        chatHistory: chatHistory,
        currentPage: 'chat',
        player: currentPlayer ? currentPlayer.getStatus() : null,
        availableSkills: Array.from(skills.values()).map(skill => skill.toJSON())
    });
});

// New Game page
app.get('/new-game', (req, res) => {
    const activeSetting = getActiveSettingSnapshot();
    const newGameDefaults = buildNewGameDefaults(activeSetting);

    res.render('new-game.njk', {
        title: 'Start New Game',
        currentPage: 'new-game',
        newGameDefaults,
        currentSetting: activeSetting
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

// Settings management page
app.get('/settings', (req, res) => {
    res.render('settings.njk', {
        title: 'Game Settings Manager',
        currentPage: 'settings'
    });
});

Events.initialize({
    axios,
    path,
    fs,
    Location,
    getConfig: () => config,
    getCurrentPlayer: () => currentPlayer,
    players,
    things,
    regions,
    gameLocations,
    getEventPromptTemplates,
    buildBasePromptContext,
    promptEnv,
    parseXMLTemplate,
    findActorByName,
    findThingByName,
    findLocationByNameLoose,
    findRegionByNameLoose,
    findRegionByLocationId,
    generateItemsByNames,
    createLocationFromEvent,
    scheduleStubExpansion,
    generateLocationImage,
    queueNpcAssetsForLocation,
    queueLocationThingImages,
    generateLocationExitImage,
    ensureExitConnection,
    directionKeyFromName,
    generateStubName,
    ensureNpcByName,
    generateThingImage,
    shouldGenerateThingImage,
    defaultStatusDuration: Events.DEFAULT_STATUS_DURATION,
    majorStatusDuration: Events.MAJOR_STATUS_DURATION,
    baseDir: __dirname
});

// API routes are registered via api.js
const apiScope = {
    app,
    axios,
    yaml,
    fs,
    path,
    Utils,
    JOB_STATUS,
    PORT,
    Location,
    LocationExit,
    Player,
    Region,
    SettingInfo,
    Skill,
    Thing,
    Events,
    diceModule,
    promptEnv,
    viewsEnv,
    createImageJob,
    generateInventoryForCharacter,
    generateLocationFromPrompt,
    generateLocationImage,
    generatePlayerImage,
    generateRegionFromPrompt,
    generateSkillsList,
    generateSkillsByNames,
    generateThingImage,
    expandRegionEntryStub,
    queueLocationThingImages,
    requestNpcAbilityAssignments,
    applyNpcAbilities,
    getActiveSettingSnapshot,
    buildNewGameDefaults,
    getSuggestedPlayerLevel,
    parseXMLTemplate,
    queueNpcAssetsForLocation,
    resolveActionOutcome,
    resolveLocationStyle,
    scheduleStubExpansion,
    shouldGenerateNpcImage,
    shouldGenerateThingImage,
    getJobSnapshot,
    tickStatusEffectsForAction,
    buildBasePromptContext,
    buildLocationShortDescription,
    buildLocationPurpose,
    buildNpcProfiles,
    serializeNpcForClient,
    buildThingProfiles,
    describeSettingForPrompt,
    findActorByName,
    findRegionByLocationId,
    generateImageId,
    processJobQueue,
    runPlausibilityCheck,
    players,
    skills,
    things,
    regions,
    gameLocations,
    gameLocationExits,
    pendingRegionStubs,
    pendingLocationImages,
    npcGenerationPromises,
    stubExpansionPromises,
    imageJobs,
    jobQueue,
    generatedImages,
    imageFileExists
};

function defineApiStateProperty(name, getter, setter) {
    Object.defineProperty(apiScope, name, {
        enumerable: true,
        configurable: true,
        get: getter,
        set: setter
    });
}

defineApiStateProperty('config', () => config, value => { config = value; });
defineApiStateProperty('currentPlayer', () => currentPlayer, value => { currentPlayer = value; });
defineApiStateProperty('currentSetting', () => currentSetting, value => { currentSetting = value; });
defineApiStateProperty('comfyUIClient', () => comfyUIClient, value => { comfyUIClient = value; });
defineApiStateProperty('chatHistory', () => chatHistory, value => { chatHistory = value; });
defineApiStateProperty('isProcessingJob', () => isProcessingJob, value => { isProcessingJob = value; });

const registerApiRoutes = require('./api');
registerApiRoutes(apiScope);

function generateImageId() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/T/, '_').replace(/\..+/, '');
    const random = Math.random().toString(36).substr(2, 8);
    return `img_${timestamp}_${random}`;
}

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

        generateInventoryForCharacter({
            character: defaultPlayer,
            characterDescriptor: { role: 'adventurer', class: defaultPlayer.class, race: defaultPlayer.race }
        }).catch(error => {
            console.warn('Failed to generate default player inventory:', error.message);
        });

        console.log('🎲 Created default player "Adventurer" with default stats');
    } catch (error) {
        console.error('Error creating default player:', error);
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
