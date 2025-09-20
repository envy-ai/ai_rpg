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
    if (!imageId) {
        return false;
    }
    if (generatedImages.has(imageId)) {
        return true;
    }
    return imageFileExists(imageId);
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
                        console.log(`🚪 Updated location exit ${foundExit.id} imageId to: ${result.imageId}`);
                    }
                }

                // Update thing's imageId if this was a thing image job
                if (job.payload.isThingImage && job.payload.thingId && result.imageId) {
                    const thing = things.get(job.payload.thingId);
                    if (thing) {
                        thing.imageId = result.imageId;
                        console.log(`🎨 Updated thing ${thing.name} (${thing.thingType}) imageId to: ${result.imageId}`);
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
        existingSkills: []
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
const pendingLocationImages = new Map(); // Store active image job IDs per location
const npcGenerationPromises = new Map(); // Track in-flight NPC generations by normalized name

function shouldGenerateNpcImage(npc) {
    if (!npc) {
        return false;
    }

    if (npc.imageId) {
        if (hasActiveImageJob(npc.imageId)) {
            return false;
        }
        if (hasExistingImage(npc.imageId)) {
            return false;
        }
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

    if (thing.imageId) {
        if (hasActiveImageJob(thing.imageId)) {
            return false;
        }
        if (hasExistingImage(thing.imageId)) {
            return false;
        }
    }

    if (thing.thingType !== 'item') {
        return true;
    }

    if (!currentPlayer || typeof currentPlayer.hasInventoryItem !== 'function') {
        return false;
    }

    return currentPlayer.hasInventoryItem(thing);
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

            if (shouldGenerateNpcImage(npc)) {
                generatePlayerImage(npc).catch(err => console.warn('Failed to queue NPC portrait:', err.message));
            }

            const npcItems = typeof npc.getInventoryItems === 'function' ? npc.getInventoryItems() : [];
            for (const item of npcItems) {
                if (!shouldGenerateThingImage(item)) {
                    continue;
                }
                generateThingImage(item).catch(itemError => {
                    console.warn('Failed to generate NPC item image:', itemError.message);
                });
            }
        }
    } catch (error) {
        console.warn(`Failed to queue NPC assets for ${location.name || location.id}:`, error.message);
    }
}

function buildNpcProfiles(location) {
    if (!location || typeof location.npcIds !== 'object') {
        return [];
    }
    return location.npcIds
        .map(id => players.get(id))
        .filter(Boolean)
        .map(npc => ({
            id: npc.id,
            name: npc.name,
            description: npc.description,
            imageId: npc.imageId,
            isNPC: Boolean(npc.isNPC),
            locationId: npc.currentLocation,
            attributes: npc.attributes
        }));
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

    const currentPlayerContext = {
        name: playerStatus?.name || currentPlayer?.name || 'Unknown Adventurer',
        description: playerStatus?.description || currentPlayer?.description || '',
        health: playerStatus?.health ?? 'Unknown',
        maxHealth: playerStatus?.maxHealth ?? 'Unknown',
        statusEffects: normalizeStatusEffects(currentPlayer || playerStatus)
    };

    const npcs = [];
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
            npcs.push({
                name: npcStatus?.name || npc.name || 'Unknown NPC',
                description: npcStatus?.description || npc.description || '',
                statusEffects: normalizeStatusEffects(npc || npcStatus)
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
            party.push({
                name: memberStatus?.name || member.name || 'Unknown Ally',
                description: memberStatus?.description || member.description || '',
                statusEffects: normalizeStatusEffects(member || memberStatus)
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
        itemsInScene
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
    const attributeValue = attributeKey ? player.getAttribute(attributeKey) : null;
    const attributeBonus = Number.isFinite(attributeValue) ? Math.floor(attributeValue / 2) : 0;

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

function logPlausibilityCheck({ systemPrompt, generationPrompt, responseText }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `plausibility_check_${timestamp}.log`);
        const parts = [
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

async function runPlausibilityCheck({ actionText, locationId }) {
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

        const renderedTemplate = promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'plausibility-check',
            actionText
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
            responseText: plausibilityResponse
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
    const suffixes = ['Path', 'Trail', 'Approach', 'Passage', 'Outlook', 'Frontier'];
    const suffix = suffixes[randomIntInclusive(0, suffixes.length - 1)];
    let candidate = `${baseName} ${directionLabel} ${suffix}`.trim();

    if (typeof Location.findByName === 'function' && Location.findByName(candidate)) {
        candidate = `${candidate} ${randomIntInclusive(2, 99)}`;
    }

    return candidate;
}

function normalizeRegionLocationName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function ensureExitConnection(fromLocation, direction, toLocation, { description, bidirectional = false } = {}) {
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
        if (bidirectional) {
            const reverseKey = getOppositeDirection(normalizedDirection) || `return_${directionKeyFromName(fromLocation.name || fromLocation.id)}`;
            ensureExitConnection(
                toLocation,
                reverseKey,
                fromLocation,
                { description: `Path back to ${fromLocation.name || fromLocation.id}`, bidirectional: false }
            );
        }
        return exit;
    }

    const exitDescription = description || `Path to ${toLocation.name || 'an unknown location'}`;
    const newExit = new LocationExit({
        description: exitDescription,
        destination: toLocation.id,
        bidirectional: Boolean(bidirectional)
    });

    if (typeof fromLocation.addExit === 'function') {
        fromLocation.addExit(normalizedDirection, newExit);
    }
    gameLocationExits.set(newExit.id, newExit);

    if (bidirectional) {
        const reverseKey = getOppositeDirection(normalizedDirection) || `return_${directionKeyFromName(fromLocation.name || fromLocation.id)}`;
        ensureExitConnection(
            toLocation,
            reverseKey,
            fromLocation,
            { description: `Path back to ${fromLocation.name || fromLocation.id}`, bidirectional: false }
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

            console.log('Using SettingInfo variables:', settingVariables);
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

        const items = parseInventoryItems(inventoryContent);

        const createdThings = [];
        for (const item of items) {
            if (!item.name) continue;
            const detailParts = [];
            if (item.type) detailParts.push(`Type: ${item.type}`);
            if (item.rarity) detailParts.push(`Rarity: ${item.rarity}`);
            if (item.value) detailParts.push(`Value: ${item.value}`);
            if (item.weight) detailParts.push(`Weight: ${item.weight}`);
            if (item.properties) detailParts.push(`Properties: ${item.properties}`);
            const extendedDescription = [item.description, detailParts.join(' | ')].filter(Boolean).join(' ');

            try {
                const thing = new Thing({
                    name: item.name,
                    description: extendedDescription || item.description || 'Inventory item',
                    thingType: 'item',
                    rarity: item.rarity || null,
                    itemTypeDetail: item.type || null,
                    metadata: {
                        rarity: item.rarity || null,
                        itemType: item.type || null,
                        value: item.value || null,
                        weight: item.weight || null,
                        properties: item.properties || null
                    }
                });
                things.set(thing.id, thing);
                character.addInventoryItem(thing);
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
                        generateThingImage(thing).catch(err => {
                            console.warn('Failed to generate thing image:', err.message);
                        });
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
            if (itemData?.properties) detailParts.push(`Properties: ${itemData.properties}`);
            if (detailParts.length) {
                descriptionParts.push(detailParts.join(' | '));
            }
            const composedDescription = descriptionParts.join(' ') || `An item named ${name}.`;

            const thing = new Thing({
                name,
                description: composedDescription,
                thingType: 'item',
                rarity: itemData?.rarity || null,
                itemTypeDetail: itemData?.type || null,
                metadata: {
                    rarity: itemData?.rarity || null,
                    itemType: itemData?.type || null,
                    value: itemData?.value || null,
                    weight: itemData?.weight || null,
                    properties: itemData?.properties || null
                }
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
            }

            if (shouldGenerateThingImage(thing)) {
                generateThingImage(thing).catch(err => {
                    console.warn('Failed to queue image generation for generated item:', err.message);
                });
            }
        }

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `event_items_${Date.now()}.log`);
            const logParts = [
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
                } else if (location) {
                    fallbackMetadata.locationId = location.id;
                    delete fallbackMetadata.ownerId;
                }
                thing.metadata = fallbackMetadata;
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
            attributeDefinitions: options.attributeDefinitions || attributeDefinitionsForPrompt
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
            attributeDefinitions: options.attributeDefinitions || attributeDefinitionsForPrompt
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

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `npc_single_${Date.now()}.log`);
            const logParts = [
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
            isNPC: true
        });

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

        if (shouldGenerateNpcImage(npc)) {
            generatePlayerImage(npc).catch(err => console.warn('Failed to queue NPC portrait:', err.message));
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
            }
        });
    } catch (error) {
        console.error('Error rendering inventory template:', error);
        return null;
    }
}

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

            const className = classNode ? classNode.textContent.trim() : null;
            const race = raceNode ? raceNode.textContent.trim() : null;
            const name = nameNode ? nameNode.textContent.trim() : null;
            const description = descriptionNode ? descriptionNode.textContent.trim() : '';
            const role = roleNode ? roleNode.textContent.trim() : null;
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

            if (name) {
                npcs.push({
                    name,
                    description,
                    role,
                    class: className,
                    race,
                    attributes
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

            npcs.push({
                name,
                description,
                shortDescription,
                role,
                class: className,
                race,
                location: locationName,
                attributes
            });
        }

        return npcs;
    } catch (error) {
        console.warn('Failed to parse region NPC XML:', error.message);
        return [];
    }
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
            const item = {
                name: nameNode.textContent.trim(),
                description: node.getElementsByTagName('description')[0]?.textContent?.trim() || '',
                type: node.getElementsByTagName('type')[0]?.textContent?.trim() || 'item',
                rarity: node.getElementsByTagName('rarity')[0]?.textContent?.trim() || 'Common',
                value: node.getElementsByTagName('value')[0]?.textContent?.trim() || '0',
                weight: node.getElementsByTagName('weight')[0]?.textContent?.trim() || '0',
                properties: node.getElementsByTagName('properties')[0]?.textContent?.trim() || ''
            };
            items.push(item);
        }

        return items;
    } catch (error) {
        console.warn('Failed to parse inventory XML:', error.message);
        return [];
    }
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

function logSkillGeneration({ systemPrompt, generationPrompt, responseText }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `skills_generation_${timestamp}.log`);
        const parts = [
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
            responseText: skillResponse
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

        try {
            const parts = [
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

        const npcs = parseLocationNpcs(npcResponse);

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
                isNPC: true
            });
            players.set(npc.id, npc);
            location.addNpcId(npc.id);
            created.push(npc);
            console.log(`🤝 Created NPC ${npc.name} (${npc.id}) for location ${location.id}`);

            await generateInventoryForCharacter({
                character: npc,
                characterDescriptor: { role: npcData.role, class: npcData.class, race: npcData.race },
                region: region || findRegionByLocationId(location.id),
                location,
                chatEndpoint,
                model,
                apiKey
            });

            if (shouldGenerateNpcImage(npc)) {
                generatePlayerImage(npc).catch(err => console.warn('Failed to queue NPC portrait:', err.message));
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
        const existingNpcsInOtherRegions = Array.from(players.values())
            .filter(npc => npc && npc.isNPC)
            .filter(npc => {
                if (!npc.currentLocation) {
                    return true;
                }
                return !regionLocationSet.has(npc.currentLocation);
            })
            .map(npc => ({
                name: npc.name,
                shortDescription: npc.shortDescription && npc.shortDescription.trim()
                    ? npc.shortDescription.trim()
                    : (npc.description ? npc.description.split(/[.!?]/)[0]?.trim() || '' : '')
            }))
            .slice(0, 20);

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
        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 40000
        });

        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
            throw new Error('Invalid region NPC response from AI API');
        }

        const npcResponse = response.data.choices[0].message.content;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `region_${region.id}_npcs.log`);
            const parts = [
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

        const parsedNpcs = parseRegionNpcs(npcResponse);

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
                isNPC: true
            });

            npc.originRegionId = region.id;
            npc.isRegionImportant = true;

            players.set(npc.id, npc);

            if (targetLocation && typeof targetLocation.addNpcId === 'function') {
                targetLocation.addNpcId(npc.id);
            }

            region.npcIds.push(npc.id);
            created.push(npc);
            console.log(`🌟 Created region NPC ${npc.name} (${npc.id}) for region ${region.id}`);

            await generateInventoryForCharacter({
                character: npc,
                characterDescriptor: { role: npcData.role, class: npcData.class, race: npcData.race },
                region,
                location: targetLocation,
                chatEndpoint,
                model,
                apiKey
            });

            if (shouldGenerateNpcImage(npc)) {
                generatePlayerImage(npc).catch(err => console.warn('Failed to queue region NPC portrait:', err.message));
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

        const variables = {
            setting: settingDescription,
            thingName: thing.name,
            thingType: metadata.itemType || thing.itemTypeDetail || thing.thingType,
            thingDescription: thing.description,
            thingRarity: metadata.rarity || thing.rarity || 'Common'
        };

        console.log(`Rendering ${thing.thingType} image template for ${thing.id}: ${thing.name}`);

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
            locationPurpose: options.locationPurpose || null
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
async function generatePlayerImage(player) {
    try {
        if (!player) {
            throw new Error('Player object is required');
        }

        if (player.isNPC && !shouldGenerateNpcImage(player)) {
            console.log(`🎭 Skipping NPC portrait for ${player.name} (${player.id}) - outside player context`);
            return null;
        }

        if (player.imageId) {
            if (hasActiveImageJob(player.imageId)) {
                console.log(`🎨 Portrait job ${player.imageId} already in progress for ${player.name}, skipping duplicate request`);
                return null;
            }
            if (hasExistingImage(player.imageId)) {
                console.log(`🎨 ${player.name} (${player.id}) already has a portrait (${player.imageId}), skipping regeneration`);
                return null;
            }
        }

        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping player portrait generation');
            return null;
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping player portrait generation');
            return null;
        }

        // Generate the portrait prompt
        const portraitPrompt = renderPlayerPortraitPrompt(player);
        const finalImagePrompt = await generateImagePromptFromTemplate(portraitPrompt);

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `player_${player.id}_portrait.log`);
            const parts = [
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
        console.log('📥 LLM Generated Image Prompt:', generatedImagePrompt);

        // Clean the prompt to remove potential problematic characters
        generatedImagePrompt = generatedImagePrompt
            .replace(/[""]/g, '"')     // Normalize quotes
            .replace(/['']/g, "'")     // Normalize apostrophes
            .replace(/[—–]/g, '-')     // Normalize dashes
            .trim();

        console.log('🧽 Cleaned Image Prompt:', generatedImagePrompt);

        return generatedImagePrompt;

    } catch (error) {
        console.error('Error generating image prompt with LLM:', error);
        // Fallback to the user prompt if LLM fails
        return prompts.generationPrompt;
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

        if (!currentPlayer || currentPlayer.currentLocation !== location.id) {
            console.log(`🏞️ Skipping scene generation for ${location.id} - not the current player location`);
            return null;
        }

        if (pendingLocationImages.has(location.id)) {
            const pendingJobId = pendingLocationImages.get(location.id);
            const pendingJob = imageJobs.get(pendingJobId);
            console.log(`🏞️ Location ${location.id} already has a pending image job (${pendingJobId}), skipping new request`);
            if (pendingJob) {
                return {
                    jobId: pendingJobId,
                    status: pendingJob.status,
                    message: pendingJob.message,
                    estimatedTime: '30-90 seconds'
                };
            }
            return null;
        }

        if (location.imageId) {
            if (hasActiveImageJob(location.imageId)) {
                console.log(`🏞️ Location ${location.id} image job ${location.imageId} still in progress, skipping duplicate generation`);
                return null;
            }
            if (hasExistingImage(location.imageId)) {
                console.log(`🏞️ Location ${location.id} already has an image (${location.imageId}), skipping regeneration`);
                return null;
            }
        }

        // Generate the location scene prompt using LLM
        const promptTemplate = renderLocationImagePrompt(location);
        const finalImagePrompt = await generateImagePromptFromTemplate(promptTemplate);

        // Create image generation job with location-specific settings
        const jobId = generateImageId();
        const payload = {
            prompt: finalImagePrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: 'blurry, low quality, modern elements, cars, technology, people, characters, portraits, indoor scenes only',
            // Track which location this image is for
            locationId: location.id,
            renderedTemplate: promptTemplate.renderedTemplate,
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
        pendingLocationImages.set(location.id, jobId);
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

// Function to generate thing image
async function generateThingImage(thing) {
    try {
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            console.log('Image generation is not enabled, skipping thing image generation');
            return null;
        }

        if (!comfyUIClient) {
            console.log('ComfyUI client not initialized, skipping thing image generation');
            return null;
        }

        if (!thing) {
            throw new Error('Thing object is required');
        }

        if (thing.imageId) {
            if (hasActiveImageJob(thing.imageId)) {
                console.log(`🎒 Image job ${thing.imageId} already running for ${thing.name}, skipping duplicate request`);
                return null;
            }
            if (hasExistingImage(thing.imageId)) {
                console.log(`🎒 ${thing.name} (${thing.id}) already has an image (${thing.imageId}), skipping regeneration`);
                return null;
            }
        }

        if (!shouldGenerateThingImage(thing)) {
            console.log(`🎒 Skipping ${thing.thingType} image generation for ${thing.name} (${thing.id}) - item not in player inventory`);
            return null;
        }

        // Generate the thing image prompt using LLM
        const promptTemplate = renderThingImagePrompt(thing);
        const finalImagePrompt = await generateImagePromptFromTemplate(promptTemplate);

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
            isThingImage: true
        };

        console.log(`🎨 Generating ${thing.thingType} image for ${thing.name} (${thing.id}) with job ID: ${jobId}`);

        // Create and queue the job
        const job = createImageJob(jobId, payload);
        jobQueue.push(jobId);

        // Start processing if not already running
        setTimeout(() => processJobQueue(), 0);

        // Set imageId to the job ID temporarily - it will be updated to the final imageId when generation completes
        thing.imageId = jobId;
        console.log(`🎨 Queued ${thing.thingType} image generation for ${thing.name}, tracking with job ID: ${jobId}`);

        return {
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
        console.log('📤 Full Request Data:', JSON.stringify(requestData, null, 2));

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
        console.log('📥 AI Raw Response:');
        console.log('='.repeat(50));
        console.log(aiResponse);
        console.log('='.repeat(50));

        // Parse the XML response using Location.fromXMLSnippet()
        const location = isStubExpansion
            ? Location.fromXMLSnippet(aiResponse, {
                existingLocation: stubLocation,
                allowRename: Boolean(stubMetadata.allowRename)
            })
            : Location.fromXMLSnippet(aiResponse);

        if (!location) {
            throw new Error('Failed to parse location from AI response');
        }

        console.log(`🏗️  Successfully generated location: ${location.name || location.id}`);

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const logPath = path.join(logDir, `location_${location.id}.log`);
            const logParts = [
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

        // Automatically generate location scene image if image generation is enabled
        try {
            const imageResult = await generateLocationImage(location);
            console.log(`🎨 Location scene generation initiated for ${location.id}:`, imageResult);
        } catch (imageError) {
            console.warn('Failed to generate location scene:', imageError.message);
            // Don't fail location generation if image generation fails
        }

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

async function generateRegionFromPrompt(options = {}) {
    try {
        const { systemPrompt, generationPrompt } = renderRegionGeneratorPrompt(options);

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

        const stubMap = new Map();

        const themeHint = options.regionNotes || null;

        for (const blueprint of region.locationBlueprints) {
            const stub = new Location({
                name: blueprint.name,
                description: null,
                baseLevel: 1,
                isStub: true,
                stubMetadata: {
                    regionId: region.id,
                    regionName: region.name,
                    blueprintDescription: blueprint.description,
                    suggestedRegionExits: (blueprint.exits || []).map(exit => exit.target),
                    themeHint,
                    shortDescription: blueprint.description,
                    locationPurpose: `Part of the ${region.name} region`,
                    allowRename: false
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

        // Connect stubs based on blueprint exits with placeholder exit data
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
                const targetLabel = exitInfo?.target;
                if (!targetLabel) return;
                const directionHint = exitInfo.direction;

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

        const ensureBidirectionalStubConnections = () => {
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
        };

        ensureBidirectionalStubConnections();

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
            console.log('🏰 Entrance selection response:\n', entranceMessage);
            const entranceName = parseRegionEntranceResponse(entranceMessage);

            if (entranceName) {
                const matchedStub = stubMap.get(normalizeRegionLocationName(entranceName));
                if (matchedStub) {
                    entranceLocationId = matchedStub.id;
                    const metadata = matchedStub.stubMetadata || {};
                    metadata.isRegionEntrance = true;
                    matchedStub.stubMetadata = metadata;
                    region.entranceLocationId = matchedStub.id;
                } else {
                    console.warn(`Entrance location "${entranceName}" not found among generated stubs.`);
                }
            } else {
                console.warn('Entrance selection response did not include a <name> tag.');
            }
        } catch (entranceError) {
            console.warn('Failed to determine region entrance:', entranceError.message);
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
    generateThingImage,
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
    tickStatusEffectsForAction,
    buildBasePromptContext,
    buildLocationShortDescription,
    buildLocationPurpose,
    buildNpcProfiles,
    describeSettingForPrompt,
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
    pendingLocationImages,
    stubExpansionPromises,
    imageJobs,
    jobQueue,
    generatedImages
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
