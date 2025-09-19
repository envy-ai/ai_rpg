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

function buildEventContext(location) {
    const activeSetting = getActiveSettingSnapshot();
    const settingDescription = describeSettingForPrompt(activeSetting);

    const locationDetails = location ? location.getDetails() : null;
    const currentPlayerStatus = currentPlayer ? currentPlayer.getStatus() : null;

    const npcs = [];
    if (location && Array.isArray(location.npcIds)) {
        for (const npcId of location.npcIds) {
            const npc = players.get(npcId);
            if (!npc) continue;
            const npcStatus = typeof npc.getStatus === 'function' ? npc.getStatus() : npc;
            npcs.push({
                name: npcStatus.name || 'Unknown NPC',
                description: npcStatus.description || '',
                statusEffects: npcStatus.statusEffects || []
            });
        }
    }

    const party = [];
    if (currentPlayer && typeof currentPlayer.getPartyMembers === 'function') {
        const memberIds = currentPlayer.getPartyMembers();
        for (const memberId of memberIds) {
            const member = players.get(memberId);
            if (!member) continue;
            const memberStatus = typeof member.getStatus === 'function' ? member.getStatus() : member;
            party.push({
                name: memberStatus.name || 'Unknown Ally',
                description: memberStatus.description || '',
                statusEffects: memberStatus.statusEffects || []
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
                    statusEffects: []
                });
            }
        }
    }

    return {
        setting: settingDescription,
        location: locationDetails ? JSON.stringify(locationDetails, null, 2) : 'No current location context available.',
        currentPlayer: currentPlayerStatus ? JSON.stringify(currentPlayerStatus, null, 2) : 'No active player.',
        npcs,
        party,
        itemsInScene
    };
}

function logEventCheck({ systemPrompt, generationPrompt, responseText }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `event_checks_${timestamp}.log`);
        const parts = [
            '=== EVENT CHECK SYSTEM PROMPT ===',
            systemPrompt || '(none)',
            '',
            '=== EVENT CHECK GENERATION PROMPT ===',
            generationPrompt || '(none)',
            '',
            '=== EVENT CHECK RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log event check:', error.message);
    }
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

function escapeHtml(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(/[&<>'"]/g, char => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return char;
        }
    });
}

async function runEventChecks({ textToCheck }) {
    if (!textToCheck || !textToCheck.trim()) {
        return null;
    }

    const eventPromptTemplates = getEventPromptTemplates();
    if (!eventPromptTemplates.length) {
        return null;
    }

    try {
        const location = currentPlayer && currentPlayer.currentLocation
            ? Location.get(currentPlayer.currentLocation)
            : null;

        const context = buildEventContext(location);
        const renderedTemplate = promptEnv.render('event-checks.xml.njk', {
            ...context,
            textToCheck,
            eventPrompts: eventPromptTemplates
        });

        const parsedTemplate = parseXMLTemplate(renderedTemplate);

        if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
            console.warn('Event check template missing prompts, skipping event analysis.');
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
            max_tokens: parsedTemplate.maxTokens || 400,
            temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.3
        };

        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const eventResponse = response.data?.choices?.[0]?.message?.content || '';

        logEventCheck({
            systemPrompt: parsedTemplate.systemPrompt,
            generationPrompt: parsedTemplate.generationPrompt,
            responseText: eventResponse
        });

        if (!eventResponse.trim()) {
            return null;
        }

        const safeResponse = escapeHtml(eventResponse.trim());
        return {
            raw: eventResponse,
            html: safeResponse.replace(/\n/g, '<br>')
        };
    } catch (error) {
        console.warn('Event check execution failed:', error.message);
        return null;
    }
}

async function runPlausibilityCheck({ actionText, locationId }) {
    if (!actionText || !actionText.trim()) {
        return null;
    }

    if (!currentPlayer) {
        return null;
    }

    try {
        const location = locationId ? Location.get(locationId) : (currentPlayer.currentLocation ? Location.get(currentPlayer.currentLocation) : null);

        const playerStatus = currentPlayer.getStatus ? currentPlayer.getStatus() : null;
        const locationDetails = location ? location.getDetails() : null;
        const activeSetting = getActiveSettingSnapshot();
        const fallbackSetting = {
            name: null,
            description: describeSettingForPrompt(activeSetting),
            theme: null,
            genre: null,
            magicLevel: null,
            techLevel: null,
            tone: null,
            difficulty: null
        };
        const settingContext = activeSetting || fallbackSetting;

        const renderedTemplate = promptEnv.render('plausibility-check.xml.njk', {
            player: playerStatus || {},
            actionText,
            location: locationDetails || { name: 'Unknown Location', description: 'No description available.' },
            setting: settingContext
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
            max_tokens: parsedTemplate.maxTokens || 200,
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

        if (!plausibilityResponse.trim()) {
            return null;
        }

        const safeResponse = escapeHtml(plausibilityResponse.trim());
        return {
            raw: plausibilityResponse,
            html: safeResponse.replace(/\n/g, '<br>')
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
        return promptEnv.render(templateName, {
            settingDescription: context.settingDescription || 'A fantastical realm of adventure.',
            numSkills: context.numSkills || 20,
            attributes: context.attributes || []
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

async function generateSkillsList({ count, settingDescription }) {
    const safeCount = Math.max(1, Math.min(100, Number(count) || 20));

    const attributeEntries = Object.entries(attributeDefinitionsForPrompt || {})
        .map(([name, info]) => ({
            name,
            description: info?.description || info?.label || name
        }));

    const renderedTemplate = renderSkillsPrompt({
        settingDescription: settingDescription || 'A vibrant world of adventure.',
        numSkills: safeCount,
        attributes: attributeEntries
    });

    if (!renderedTemplate) {
        console.warn('Skills template render failed, using fallback skills.');
        const fallback = buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
        return fallback;
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
        max_tokens: parsedTemplate.maxTokens || 600,
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

        const uniqueSkills = [];
        const seenNames = new Set();
        for (const skillData of parsedSkills) {
            const normalizedName = typeof skillData.name === 'string' ? skillData.name.trim() : '';
            if (!normalizedName) {
                continue;
            }
            const key = normalizedName.toLowerCase();
            if (seenNames.has(key)) {
                continue;
            }
            seenNames.add(key);
            uniqueSkills.push(new Skill({
                name: normalizedName,
                description: skillData.description,
                attribute: skillData.attribute
            }));
            if (uniqueSkills.length >= safeCount) {
                break;
            }
        }

        if (uniqueSkills.length === 0) {
            console.warn('Skill generation produced no unique skills, using fallback.');
            return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
        }

        if (uniqueSkills.length < safeCount) {
            const needed = safeCount - uniqueSkills.length;
            const supplemental = buildFallbackSkills({ count: needed, attributes: attributeEntries });
            return uniqueSkills.concat(supplemental);
        }

        return uniqueSkills.slice(0, safeCount);
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

        console.log(`Extracted prompts for location ${location.id} - calling LLM for image prompt generation`);

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

        console.log(`Generated location exit passage prompt for ${locationExit.id}:`, generationPrompt);
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

        console.log(`Generated ${thing.thingType} image prompt for ${thing.id}:`, parsedTemplate.generationPrompt);

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
            timeout: 60000
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
        player: currentPlayer ? currentPlayer.getStatus() : null
    });
});

// New Game page
app.get('/new-game', (req, res) => {
    res.render('new-game.njk', {
        title: 'Start New Game',
        currentPage: 'new-game'
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
        let location = null;
        let plausibilityInfo = null;

        // Add the location with the id of currentPlayer.curentLocation to the player context if available
        if (currentPlayer && currentPlayer.currentLocation) {
            location = Location.get(currentPlayer.currentLocation);
        }

        if (currentPlayer && userMessage && userMessage.role === 'user') {
            try {
                plausibilityInfo = await runPlausibilityCheck({
                    actionText: userMessage.content,
                    locationId: currentPlayer.currentLocation || null
                });
            } catch (plausibilityError) {
                console.warn('Failed to execute plausibility check:', plausibilityError.message);
            }
        }

        // If we have a current player, use the player action template for the system message
        if (currentPlayer && userMessage && userMessage.role === 'user') {
            try {
                // Try XML template first, fall back to YAML for backward compatibility
                let templateName = 'player-action.xml.njk';
                let useXML = true;

                // Check if XML template exists, otherwise use YAML
                try {
                    fs.accessSync(path.join(__dirname, 'prompts', templateName));
                } catch {
                    templateName = 'player-action.yaml.njk';
                    useXML = false;
                }

                // Render the player action template
                const playerActionPrompt = promptEnv.render(templateName, {
                    player: currentPlayer.getStatus(),
                    actionText: userMessage.content,
                    location: location ? location.getDetails() : null,
                    setting: currentSetting,
                });

                // Parse the rendered template based on format
                let promptData;
                if (useXML) {
                    promptData = parseXMLTemplate(playerActionPrompt);
                } else {
                    promptData = yaml.load(playerActionPrompt);
                }

                // Create system message from the template (robust to missing fields)
                const contentParts = [];
                if (promptData.systemPrompt) {
                    contentParts.push(String(promptData.systemPrompt).trim());
                }
                if (promptData.player) {
                    try {
                        contentParts.push('Player Context:\n' + JSON.stringify(promptData.player, null, 2));
                    } catch {
                        contentParts.push('Player Context: [unavailable]');
                    }
                }
                if (promptData.action) {
                    contentParts.push('Action: ' + String(promptData.action).trim());
                }
                if (promptData.guidelines) {
                    if (Array.isArray(promptData.guidelines)) {
                        contentParts.push('Guidelines:\n' + promptData.guidelines.join('\n'));
                    } else if (typeof promptData.guidelines === 'string') {
                        contentParts.push('Guidelines:\n' + promptData.guidelines);
                    }
                }
                if (promptData.context) {
                    contentParts.push('Context: ' + String(promptData.context).trim());
                }
                const systemMessage = {
                    role: 'system',
                    content: contentParts.join('\n\n')
                };

                // Replace any existing system message or add new one
                finalMessages = [systemMessage, ...messages.filter(msg => msg.role !== 'system')];

                // Append promptData.generationPrompt to finalMessages
                if (promptData.generationPrompt) {
                    finalMessages.push({
                        role: 'user',
                        content: promptData.generationPrompt
                    });
                }

                // Store debug information
                debugInfo = {
                    usedPlayerTemplate: true,
                    playerName: currentPlayer.name,
                    playerDescription: currentPlayer.description,
                    systemMessage: systemMessage.content,
                    generationPrompt: promptData.generationPrompt || null,
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
            timeout: 60000 // 60 second timeout
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

            try {
                const eventResult = await runEventChecks({ textToCheck: aiResponse });
                if (eventResult && eventResult.html) {
                    responseData.eventChecks = eventResult.html;
                }
            } catch (eventError) {
                console.warn('Failed to run event checks:', eventError.message);
            }

            if (plausibilityInfo && plausibilityInfo.html) {
                responseData.plausibility = plausibilityInfo.html;
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

        try {
            const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
            const region = location ? findRegionByLocationId(location.id) : null;
            await generateInventoryForCharacter({
                character: player,
                characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                region,
                location
            });
        } catch (inventoryError) {
            console.warn('Failed to generate player inventory:', inventoryError);
        }

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

app.get('/api/player/party', (req, res) => {
    try {
        if (!currentPlayer) {
            return res.status(404).json({
                success: false,
                error: 'No current player found'
            });
        }

        const memberIds = currentPlayer.getPartyMembers();
        const members = memberIds
            .map(id => players.get(id))
            .filter(Boolean)
            .map(member => member.getStatus());

        res.json({
            success: true,
            members,
            count: members.length
        });
    } catch (error) {
        console.error('Error retrieving party members:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/player/party', (req, res) => {
    try {
        const { ownerId, memberId } = req.body || {};

        if (!ownerId || typeof ownerId !== 'string') {
            return res.status(400).json({ success: false, error: 'ownerId is required' });
        }
        if (!memberId || typeof memberId !== 'string') {
            return res.status(400).json({ success: false, error: 'memberId is required' });
        }

        const owner = players.get(ownerId);
        const member = players.get(memberId);

        if (!owner) {
            return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
        }
        if (!member) {
            return res.status(404).json({ success: false, error: `Member player '${memberId}' not found` });
        }

        const added = owner.addPartyMember(memberId);
        if (!added) {
            return res.json({
                success: true,
                message: 'Player already in party',
                members: owner.getPartyMembers()
            });
        }

        try {
            if (member && member.isNPC && shouldGenerateNpcImage(member)) {
                generatePlayerImage(member).catch(err => console.warn('Failed to queue party member portrait:', err.message));
            }
            const inventoryItems = typeof member?.getInventoryItems === 'function' ? member.getInventoryItems() : [];
            for (const item of inventoryItems) {
                if (!shouldGenerateThingImage(item)) {
                    continue;
                }
                generateThingImage(item).catch(itemError => {
                    console.warn('Failed to generate image for party item:', itemError.message);
                });
            }
        } catch (partyImageError) {
            console.warn('Failed to schedule party imagery updates:', partyImageError.message);
        }

        res.json({
            success: true,
            message: `Added ${member.name} to ${owner.name}'s party`,
            members: owner.getPartyMembers()
        });
    } catch (error) {
        console.error('Error adding party member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/player/party', (req, res) => {
    try {
        const { ownerId, memberId } = req.body || {};

        if (!ownerId || typeof ownerId !== 'string') {
            return res.status(400).json({ success: false, error: 'ownerId is required' });
        }
        if (!memberId || typeof memberId !== 'string') {
            return res.status(400).json({ success: false, error: 'memberId is required' });
        }

        const owner = players.get(ownerId);

        if (!owner) {
            return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
        }

        const removed = owner.removePartyMember(memberId);
        if (!removed) {
            return res.status(404).json({ success: false, error: `Player '${memberId}' was not in the party` });
        }

        res.json({
            success: true,
            message: `Removed player '${memberId}' from ${owner.name}'s party`,
            members: owner.getPartyMembers()
        });
    } catch (error) {
        console.error('Error removing party member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
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
        ),
        regions: Object.fromEntries(
            Array.from(regions.entries()).map(([id, region]) => [id, region.toJSON()])
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
        allSettings: SettingInfo.getAll().map(setting => setting.toJSON()),
        currentSetting: currentSetting,
        gameWorld: gameWorldData, // In-memory game world data
        gameWorldCounts: {
            locations: gameLocations.size,
            locationExits: gameLocationExits.size,
            regions: regions.size
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
            generatePlayerImage(currentPlayer).catch(err => console.warn('Failed to regenerate player portrait:', err.message));
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

        try {
            const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
            const region = location ? findRegionByLocationId(location.id) : null;
            await generateInventoryForCharacter({
                character: player,
                characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                region,
                location
            });
        } catch (inventoryError) {
            console.warn('Failed to generate player inventory (stats):', inventoryError);
        }

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

        if (!imageResult) {
            return res.status(409).json({
                success: false,
                error: 'Portrait generation is only available for companions in your party or at your current location.',
                player: {
                    id: player.id,
                    name: player.name,
                    imageId: player.imageId
                }
            });
        }

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

// ==================== PLAYER AND LOCATION QUERY ENDPOINTS ====================

// Get location by ID
app.get('/api/locations/:id', async (req, res) => {
    try {
        const locationId = req.params.id;
        const location = Location.get(locationId);

        if (!location) {
            return res.status(404).json({
                success: false,
                error: `Location with ID '${locationId}' not found`
            });
        }

        if (location.isStub) {
            try {
                await scheduleStubExpansion(location);
            } catch (expansionError) {
                return res.status(500).json({
                    success: false,
                    error: `Failed to expand location: ${expansionError.message}`
                });
            }
        }

        const locationData = location.toJSON();
        locationData.pendingImageJobId = pendingLocationImages.get(location.id) || null;
        if (locationData.exits) {
            for (const [dir, exit] of Object.entries(locationData.exits)) {
                if (!exit) continue;
                const destLocation = gameLocations.get(exit.destination);
                if (destLocation) {
                    exit.destinationName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || exit.destination;
                }
            }
        }

        locationData.npcs = buildNpcProfiles(location);

        res.json({
            success: true,
            location: locationData
        });
    } catch (error) {
        console.error('Error fetching location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Move player to a connected location
app.post('/api/player/move', async (req, res) => {
    try {
        if (!currentPlayer) {
            return res.status(404).json({
                success: false,
                error: 'No current player found'
            });
        }

        const { destinationId, direction } = req.body || {};
        if (!destinationId && !direction) {
            return res.status(400).json({
                success: false,
                error: 'Destination ID or direction is required'
            });
        }

        const currentLocationId = currentPlayer.currentLocation;
        const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;
        if (!currentLocation) {
            return res.status(400).json({
                success: false,
                error: 'Current location not found in game world'
            });
        }

        const directions = currentLocation.getAvailableDirections();
        let matchedExit = null;
        let matchedDirection = null;
        for (const dir of directions) {
            const exit = currentLocation.getExit(dir);
            if (!exit) continue;
            if (destinationId && exit.destination === destinationId) {
                matchedExit = exit;
                matchedDirection = dir;
                break;
            }
            if (!destinationId && direction && dir === direction) {
                matchedExit = exit;
                matchedDirection = dir;
                break;
            }
        }

        if (!matchedExit) {
            return res.status(404).json({
                success: false,
                error: 'Exit not found from current location'
            });
        }

        let destinationLocation = gameLocations.get(matchedExit.destination);
        if (!destinationLocation) {
            return res.status(404).json({
                success: false,
                error: 'Destination location not found'
            });
        }

        if (destinationLocation.isStub) {
            try {
                await scheduleStubExpansion(destinationLocation);
                destinationLocation = gameLocations.get(destinationLocation.id);
            } catch (expansionError) {
                return res.status(500).json({
                    success: false,
                    error: `Failed to expand destination location: ${expansionError.message}`
                });
            }
        }

        currentPlayer.setLocation(destinationLocation.id);

        try {
            await generateLocationImage(destinationLocation);
        } catch (locationImageError) {
            console.warn('Failed to generate location scene:', locationImageError.message);
        }

        queueNpcAssetsForLocation(destinationLocation);

        const locationData = destinationLocation.toJSON();
        locationData.pendingImageJobId = pendingLocationImages.get(destinationLocation.id) || null;
        if (locationData.exits) {
            for (const [dirKey, exit] of Object.entries(locationData.exits)) {
                if (!exit) continue;
                const destLocation = gameLocations.get(exit.destination);
                if (destLocation) {
                    exit.destinationName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || exit.destination;
                }
            }
        }
        locationData.npcs = buildNpcProfiles(destinationLocation);

        res.json({
            success: true,
            location: locationData,
            message: `Moved to ${locationData.name || locationData.id}`,
            direction: matchedDirection
        });
    } catch (error) {
        console.error('Error moving player:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/map/region', (req, res) => {
    try {
        if (!currentPlayer) {
            return res.status(404).json({
                success: false,
                error: 'No current player found'
            });
        }

        const currentLocationId = currentPlayer.currentLocation;
        const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;
        if (!currentLocation) {
            return res.status(404).json({
                success: false,
                error: 'Current location not found'
            });
        }

        let region = null;
        const regionId = currentLocation.stubMetadata?.regionId;
        if (regionId && regions.has(regionId)) {
            region = regions.get(regionId);
        } else {
            region = Array.from(regions.values()).find(r => r.locationIds.includes(currentLocationId)) || null;
        }

        let locations = [];
        if (region) {
            locations = region.locationIds
                .map(id => gameLocations.get(id))
                .filter(Boolean);
        } else {
            locations = Array.from(gameLocations.values());
        }

        const payload = {
            currentLocationId,
            locations: locations.map(loc => {
                const locationPayload = {
                    id: loc.id,
                    name: loc.name || loc.id,
                    isStub: Boolean(loc.isStub),
                    visited: Boolean(loc.visited),
                    exits: Array.from(loc.getAvailableDirections()).map(direction => {
                        const exit = loc.getExit(direction);
                        return {
                            id: exit?.id || `${loc.id}_${direction}`,
                            destination: exit?.destination,
                            bidirectional: exit?.bidirectional !== false
                        };
                    })
                };

                if (loc.imageId) {
                    const metadata = generatedImages.get(loc.imageId);
                    const firstImage = metadata?.images?.[0];
                    locationPayload.image = firstImage
                        ? { id: loc.imageId, url: firstImage.url }
                        : { id: loc.imageId, url: null };
                }

                return locationPayload;
            })
        };

        res.json({ success: true, region: payload });
    } catch (error) {
        console.error('Error building map data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== LOCATION GENERATION FUNCTIONALITY ====================

// Generate a new region using AI
app.post('/api/regions/generate', async (req, res) => {
    try {
        const { regionName, regionDescription, regionNotes } = req.body || {};
        const activeSetting = getActiveSettingSnapshot();

        const options = {
            setting: describeSettingForPrompt(activeSetting),
            regionName: regionName && regionName.trim() ? regionName.trim() : null,
            regionDescription: regionDescription || null,
            regionNotes: regionNotes || null
        };

        const result = await generateRegionFromPrompt(options);

        res.json({
            success: true,
            region: result.region.toJSON(),
            createdLocationIds: result.region.locationIds,
            createdLocations: result.createdLocations.map(loc => loc.toJSON()),
            entranceLocationId: result.region.entranceLocationId || result.entranceLocationId,
            message: `Region "${result.region.name}" generated with ${result.region.locationIds.length} stub locations.`
        });
    } catch (error) {
        console.error('Error generating region:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generate a new location using AI
app.post('/api/locations/generate', async (req, res) => {
    try {
        const body = req.body || {};
        const activeSetting = getActiveSettingSnapshot();
        const derivedLocationStyle = resolveLocationStyle(body.locationStyle, activeSetting);
        const settingDescription = describeSettingForPrompt(activeSetting);
        const shortDescription = buildLocationShortDescription(derivedLocationStyle, activeSetting);
        const locationPurpose = buildLocationPurpose(derivedLocationStyle, activeSetting);
        const playerLevel = getSuggestedPlayerLevel(activeSetting);

        const options = {
            setting: settingDescription,
            theme: derivedLocationStyle,
            locationTheme: derivedLocationStyle,
            locationStyle: derivedLocationStyle,
            shortDescription,
            locationPurpose,
            playerLevel,
            settingInfoId: activeSetting?.id || null
        };

        console.log('🏗️  Starting location generation with options derived from current setting:', options);

        // Generate the location
        const result = await generateLocationFromPrompt(options);

        const locationData = result.location.toJSON();
        locationData.pendingImageJobId = pendingLocationImages.get(result.location.id) || null;
        locationData.npcs = buildNpcProfiles(result.location);

        res.json({
            success: true,
            location: locationData,
            locationId: result.location.id,
            locationName: result.location.name,
            gameWorldStats: {
                totalLocations: gameLocations.size,
                totalLocationExits: gameLocationExits.size
            },
            generationInfo: {
                aiResponse: result.aiResponse,
                options: result.generationOptions,
                activeSetting,
                requestedLocationStyle: derivedLocationStyle,
                newStubs: result.newStubs || []
            },
            message: `Location "${result.location.name || result.location.id}" generated successfully`
        });

    } catch (error) {
        console.error('Error in location generation API:', error);

        // Provide more specific error messages
        let errorMessage = error.message;
        let statusCode = 500;

        if (error.code === 'ECONNABORTED') {
            errorMessage = 'Request timeout - AI API took too long to respond';
            statusCode = 408;
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = 'Cannot connect to AI API - check your endpoint URL';
            statusCode = 503;
        } else if (error.response) {
            const apiStatusCode = error.response.status;
            const apiErrorMessage = error.response.data?.error?.message || 'API request failed';
            errorMessage = `AI API Error (${apiStatusCode}): ${apiErrorMessage}`;
            statusCode = apiStatusCode;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: error.message
        });
    }
});

// ==================== THING MANAGEMENT API ENDPOINTS ====================

// Create a new thing
app.post('/api/things', async (req, res) => {
    try {
        const { name, description, thingType, imageId, rarity, itemTypeDetail, metadata } = req.body;

        const thing = new Thing({
            name,
            description,
            thingType,
            imageId,
            rarity,
            itemTypeDetail,
            metadata
        });

        things.set(thing.id, thing);

        // Automatically generate thing image if context allows
        if (shouldGenerateThingImage(thing)) {
            try {
                const imageResult = await generateThingImage(thing);
                console.log(`🎨 Thing ${thing.thingType} image generation initiated for ${thing.name}:`, imageResult);
            } catch (imageError) {
                console.warn('Failed to generate thing image:', imageError.message);
                // Don't fail thing creation if image generation fails
            }
        } else {
            console.log(`🎒 Skipping automatic image generation for ${thing.name} (${thing.id}) - not in player inventory`);
        }

        res.json({
            success: true,
            thing: thing.toJSON(),
            message: 'Thing created successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get all things (with optional type filtering)
app.get('/api/things', (req, res) => {
    try {
        const { type } = req.query;
        let result = Array.from(things.values()).map(thing => thing.toJSON());

        if (type) {
            if (!Thing.validTypes.includes(type)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid type. Must be one of: ${Thing.validTypes.join(', ')}`
                });
            }
            result = result.filter(thing => thing.thingType === type);
        }

        res.json({
            success: true,
            things: result,
            count: result.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get a specific thing by ID
app.get('/api/things/:id', (req, res) => {
    try {
        const { id } = req.params;
        const thing = things.get(id);

        if (!thing) {
            return res.status(404).json({
                success: false,
                error: 'Thing not found'
            });
        }

        res.json({
            success: true,
            thing: thing.toJSON()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update a thing
app.put('/api/things/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, thingType, imageId, rarity, itemTypeDetail, metadata } = req.body;
        const thing = things.get(id);

        if (!thing) {
            return res.status(404).json({
                success: false,
                error: 'Thing not found'
            });
        }

        // Update properties if provided
        let shouldRegenerateImage = false;
        if (name !== undefined) {
            thing.name = name;
            shouldRegenerateImage = true;
        }
        if (description !== undefined) {
            thing.description = description;
            shouldRegenerateImage = true;
        }
        if (thingType !== undefined) {
            thing.thingType = thingType;
            shouldRegenerateImage = true;
        }
        if (rarity !== undefined) {
            thing.rarity = rarity;
            shouldRegenerateImage = true;
        }
        if (itemTypeDetail !== undefined) {
            thing.itemTypeDetail = itemTypeDetail;
            shouldRegenerateImage = true;
        }
        if (metadata !== undefined) {
            thing.metadata = metadata;
            shouldRegenerateImage = true;
        }
        if (imageId !== undefined) thing.imageId = imageId;

        // Trigger image regeneration if visual properties changed (only when relevant)
        if (shouldRegenerateImage && imageId === undefined) {
            try {
                if (shouldGenerateThingImage(thing)) {
                    await generateThingImage(thing);
                    console.log(`🔄 Regenerated ${thing.thingType} image for ${thing.name} due to property changes`);
                } else {
                    console.log(`🎒 Skipping ${thing.thingType} image regeneration for ${thing.name} - not in player inventory`);
                }
            } catch (imageError) {
                console.warn('Failed to schedule thing image regeneration:', imageError.message);
            }
        }

        res.json({
            success: true,
            thing: thing.toJSON(),
            message: 'Thing updated successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a thing
app.delete('/api/things/:id', (req, res) => {
    try {
        const { id } = req.params;
        const thing = things.get(id);

        if (!thing) {
            return res.status(404).json({
                success: false,
                error: 'Thing not found'
            });
        }

        // Remove from storage and Thing's static indexes
        things.delete(id);
        thing.delete();

        res.json({
            success: true,
            message: 'Thing deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all scenery things
app.get('/api/things/scenery', (req, res) => {
    try {
        const sceneryThings = Array.from(things.values())
            .filter(thing => thing.isScenery())
            .map(thing => thing.toJSON());

        res.json({
            success: true,
            things: sceneryThings,
            count: sceneryThings.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all item things
app.get('/api/things/items', (req, res) => {
    try {
        const itemThings = Array.from(things.values())
            .filter(thing => thing.isItem())
            .map(thing => thing.toJSON());

        res.json({
            success: true,
            things: itemThings,
            count: itemThings.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generate image for a specific thing
app.post('/api/things/:id/image', async (req, res) => {
    try {
        const { id } = req.params;
        const thing = things.get(id);

        if (!thing) {
            return res.status(404).json({
                success: false,
                error: 'Thing not found'
            });
        }

        if (!shouldGenerateThingImage(thing)) {
            return res.status(409).json({
                success: false,
                error: 'Item images can only be generated for gear in your inventory.',
                thing: thing.toJSON()
            });
        }

        const imageResult = await generateThingImage(thing);

        if (!imageResult) {
            return res.status(503).json({
                success: false,
                error: 'Image generation is not available or disabled',
                thing: thing.toJSON()
            });
        }

        res.json({
            success: true,
            thing: thing.toJSON(),
            imageGeneration: imageResult,
            message: `${thing.thingType} image generation initiated for ${thing.name}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== SETTINGS API ENDPOINTS ====================

// Get all settings
app.get('/api/settings', (req, res) => {
    try {
        const allSettings = SettingInfo.getAll().map(setting => setting.toJSON());

        res.json({
            success: true,
            settings: allSettings,
            count: allSettings.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create a new setting
app.post('/api/settings', (req, res) => {
    try {
        const settingData = req.body;

        // Validate required fields
        if (!settingData.name || typeof settingData.name !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Setting name is required and must be a string'
            });
        }

        // Check if setting with same name already exists
        if (SettingInfo.getByName(settingData.name)) {
            return res.status(409).json({
                success: false,
                error: 'Setting with this name already exists'
            });
        }

        const newSetting = new SettingInfo(settingData);

        res.status(201).json({
            success: true,
            setting: newSetting.toJSON(),
            message: 'Setting created successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get a specific setting by ID
app.get('/api/settings/:id', (req, res) => {
    try {
        const { id } = req.params;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        res.json({
            success: true,
            setting: setting.toJSON()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update a setting
app.put('/api/settings/:id', (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        // Check if name conflict with another setting
        if (updates.name && updates.name !== setting.name) {
            const existingSetting = SettingInfo.getByName(updates.name);
            if (existingSetting && existingSetting.id !== id) {
                return res.status(409).json({
                    success: false,
                    error: 'Setting with this name already exists'
                });
            }
        }

        setting.update(updates);

        res.json({
            success: true,
            setting: setting.toJSON(),
            message: 'Setting updated successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a setting
app.delete('/api/settings/:id', (req, res) => {
    try {
        const { id } = req.params;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        const deleted = SettingInfo.delete(id);

        if (deleted) {
            res.json({
                success: true,
                message: 'Setting deleted successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to delete setting'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clone a setting
app.post('/api/settings/:id/clone', (req, res) => {
    try {
        const { id } = req.params;
        const { newName } = req.body;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        // Check if new name already exists
        if (newName && SettingInfo.getByName(newName)) {
            return res.status(409).json({
                success: false,
                error: 'Setting with this name already exists'
            });
        }

        const clonedSetting = setting.clone(newName);

        res.status(201).json({
            success: true,
            setting: clonedSetting.toJSON(),
            message: 'Setting cloned successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Save all settings to files
app.post('/api/settings/save', (req, res) => {
    try {
        const result = SettingInfo.saveAll();

        res.json({
            success: true,
            result,
            message: `Saved ${result.count} settings to ${result.directory}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Load all settings from files
app.post('/api/settings/load', (req, res) => {
    try {
        const result = SettingInfo.loadAll();

        res.json({
            success: true,
            result,
            message: `Loaded ${result.count} settings from ${result.directory}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// List saved setting files
app.get('/api/settings/saved', (req, res) => {
    try {
        const savedSettings = SettingInfo.listSavedSettings();

        res.json({
            success: true,
            savedSettings,
            count: savedSettings.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save individual setting to file
app.post('/api/settings/:id/save', (req, res) => {
    try {
        const { id } = req.params;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        const filepath = setting.save();

        res.json({
            success: true,
            filepath,
            message: 'Setting saved to file successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Apply setting as current game setting
app.post('/api/settings/:id/apply', (req, res) => {
    try {
        const { id } = req.params;
        const setting = SettingInfo.getById(id);

        if (!setting) {
            return res.status(404).json({
                success: false,
                error: 'Setting not found'
            });
        }

        // Apply globally so other routes/templates can access it
        currentSetting = setting;
        try {
            const settingJSON = typeof setting.toJSON === 'function' ? setting.toJSON() : setting;
            if (app && app.locals) {
                app.locals.currentSetting = settingJSON;
                // Also expose prompt variables for convenience in views
                app.locals.promptVariables = typeof setting.getPromptVariables === 'function' ? setting.getPromptVariables() : undefined;
            }
            if (typeof viewsEnv?.addGlobal === 'function') {
                viewsEnv.addGlobal('currentSetting', settingJSON);
                viewsEnv.addGlobal('promptVariables', app.locals.promptVariables);
            }
            // Optional: expose on global for non-module consumers
            global.currentSetting = setting;
        } catch (_) {
            // Best-effort; do not block on template/global propagation
        }

        res.json({
            success: true,
            setting: setting.toJSON(),
            message: `Applied setting: ${setting.name}`,
            promptVariables: setting.getPromptVariables()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get current applied setting
app.get('/api/settings/current', (req, res) => {
    try {
        if (!currentSetting) {
            return res.json({
                success: true,
                setting: null,
                message: 'No setting currently applied'
            });
        }

        res.json({
            success: true,
            setting: currentSetting.toJSON(),
            promptVariables: currentSetting.getPromptVariables()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear current setting (revert to config defaults)
app.delete('/api/settings/current', (req, res) => {
    try {
        const previousSetting = currentSetting;
        currentSetting = null;
        // Clear globals so templates/consumers reflect reset
        try {
            if (app && app.locals) {
                app.locals.currentSetting = null;
                app.locals.promptVariables = undefined;
            }
            if (typeof viewsEnv?.addGlobal === 'function') {
                viewsEnv.addGlobal('currentSetting', null);
                viewsEnv.addGlobal('promptVariables', undefined);
            }
            global.currentSetting = null;
        } catch (_) {
            // Non-fatal cleanup
        }

        res.json({
            success: true,
            message: 'Current setting cleared - reverted to configuration defaults',
            previousSetting: previousSetting ? previousSetting.toJSON() : null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== NEW GAME FUNCTIONALITY ====================

// Create a new game with fresh player and starting location
app.post('/api/new-game', async (req, res) => {
    try {
        const { playerName, playerDescription, startingLocation, numSkills: numSkillsInput } = req.body || {};
        const activeSetting = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(activeSetting);
        const playerRequestedLocation = typeof startingLocation === 'string' ? startingLocation.trim() : '';
        const startingPlayerLevel = activeSetting?.playerStartingLevel || 1;
        const startingLocationStyle = resolveLocationStyle(activeSetting?.startingLocationType || playerRequestedLocation, activeSetting);
        const parsedSkillCount = Number.parseInt(numSkillsInput, 10);
        const numSkills = Number.isFinite(parsedSkillCount) ? Math.max(1, Math.min(100, parsedSkillCount)) : 20;

        // Clear existing game state
        players.clear();
        gameLocations.clear();
        gameLocationExits.clear();
        regions.clear();
        Region.clear();
        stubExpansionPromises.clear();
        chatHistory.length = 0;
        skills.clear();
        Player.setAvailableSkills(new Map());

        console.log('🎮 Starting new game...');

        let generatedSkills = [];
        try {
            generatedSkills = await generateSkillsList({
                count: numSkills,
                settingDescription
            });
        } catch (skillError) {
            console.warn('Failed to generate skills from prompt:', skillError.message);
            generatedSkills = [];
        }

        if (generatedSkills.length) {
            skills.clear();
            for (const skill of generatedSkills) {
                skills.set(skill.name, skill);
            }
            Player.setAvailableSkills(skills);
            for (const player of players.values()) {
                if (typeof player.syncSkillsWithAvailable === 'function') {
                    player.syncSkillsWithAvailable();
                }
            }
        } else if (skills.size === 0) {
            Player.setAvailableSkills(new Map());
        }

        // Create new player
        const newPlayer = new Player({
            name: playerName || 'Adventurer',
            description: playerDescription || 'A brave soul embarking on a new adventure.',
            level: startingPlayerLevel,
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

        // Generate an initial region and choose its entrance as the starting location
        console.log('🗺️ Generating starting region...');
        const defaultRegionName = activeSetting?.name
            ? `${activeSetting.name} Frontier`
            : playerRequestedLocation
                ? `${playerRequestedLocation} Region`
                : 'Starting Region';

        const regionOptions = {
            setting: settingDescription,
            regionName: playerRequestedLocation ? `${playerRequestedLocation} Frontier` : defaultRegionName,
            regionNotes: startingLocationStyle || null
        };

        const regionResult = await generateRegionFromPrompt(regionOptions);
        const region = regionResult.region;

        let entranceLocationId = region.entranceLocationId || regionResult.entranceLocationId;
        if (!entranceLocationId && region.locationIds.length > 0) {
            entranceLocationId = region.locationIds[0];
        }

        if (!entranceLocationId) {
            throw new Error('No entrance location generated for starting region');
        }

        let entranceLocation = gameLocations.get(entranceLocationId);
        if (!entranceLocation) {
            throw new Error('Entrance location not found in game world');
        }

        if (entranceLocation.isStub) {
            try {
                const expansion = await generateLocationFromPrompt({
                    stubLocation: entranceLocation,
                    createStubs: false
                });
                if (expansion?.location) {
                    entranceLocation = expansion.location;
                    entranceLocationId = entranceLocation.id;
                    region.entranceLocationId = entranceLocationId;
                }
            } catch (expansionError) {
                console.warn('Failed to expand entrance stub:', expansionError.message);
            }
        }

        if (entranceLocation.baseLevel && entranceLocation.baseLevel > 3) {
            entranceLocation.baseLevel = Math.min(3, Math.max(1, entranceLocation.baseLevel));
        } else if (!entranceLocation.baseLevel) {
            entranceLocation.baseLevel = 1;
        }

        gameLocations.set(entranceLocation.id, entranceLocation);
        console.log(`🏠 Starting at region entrance: ${entranceLocation.name} (Level ${entranceLocation.baseLevel})`);

        // Place player in starting location
        newPlayer.setLocation(entranceLocation.id);

        // Store new player and set as current
        players.set(newPlayer.id, newPlayer);
        currentPlayer = newPlayer;

        queueNpcAssetsForLocation(entranceLocation);

        try {
            await generateLocationImage(entranceLocation);
        } catch (locationImageError) {
            console.warn('Failed to generate starting location image:', locationImageError.message);
        }

        try {
            await generateInventoryForCharacter({
                character: newPlayer,
                characterDescriptor: { role: 'adventurer', class: newPlayer.class, race: newPlayer.race },
                region,
                location: entranceLocation
            });
        } catch (inventoryError) {
            console.warn('Failed to generate inventory for new-game player:', inventoryError);
        }

        console.log(`🧙‍♂️ Created new player: ${newPlayer.name} at ${entranceLocation.name}`);

        const startingLocationData = entranceLocation.toJSON();
        startingLocationData.pendingImageJobId = pendingLocationImages.get(entranceLocation.id) || null;
        startingLocationData.npcs = buildNpcProfiles(entranceLocation);

        res.json({
            success: true,
            message: 'New game started successfully',
            player: newPlayer.toJSON(),
            startingLocation: startingLocationData,
            region: region.toJSON(),
            skills: generatedSkills.map(skill => skill.toJSON()),
            gameState: {
                totalPlayers: players.size,
                totalLocations: gameLocations.size,
                currentLocation: entranceLocation.name,
                regionEntranceId: entranceLocation.id
            }
        });

    } catch (error) {
        console.error('Error creating new game:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create new game',
            details: error.message
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
            ),
            regions: Object.fromEntries(
                Array.from(regions.entries()).map(([id, region]) => [id, region.toJSON()])
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

        // Save generated skill definitions
        const skillsData = Array.from(skills.values()).map(skill => skill.toJSON());
        fs.writeFileSync(
            path.join(saveDir, 'skills.json'),
            JSON.stringify(skillsData, null, 2)
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
            totalRegions: regions.size,
            totalGeneratedImages: generatedImages.size,
            totalSkills: skills.size
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

        const skillsPath = path.join(saveDir, 'skills.json');
        skills.clear();
        if (fs.existsSync(skillsPath)) {
            try {
                const skillsData = JSON.parse(fs.readFileSync(skillsPath, 'utf8')) || [];
                for (const skillEntry of skillsData) {
                    try {
                        const skill = Skill.fromJSON(skillEntry);
                        skills.set(skill.name, skill);
                    } catch (skillError) {
                        console.warn('Skipping invalid skill entry:', skillError.message);
                    }
                }
            } catch (skillLoadError) {
                console.warn('Failed to load skills from save:', skillLoadError.message);
            }
        }
        Player.setAvailableSkills(skills);

        // Load all players first
        const allPlayersPath = path.join(saveDir, 'allPlayers.json');
        if (fs.existsSync(allPlayersPath)) {
            players.clear();
            const allPlayersData = JSON.parse(fs.readFileSync(allPlayersPath, 'utf8')) || {};
            for (const [id, playerData] of Object.entries(allPlayersData)) {
                const player = Player.fromJSON(playerData);
                if (typeof player.syncSkillsWithAvailable === 'function') {
                    player.syncSkillsWithAvailable();
                }
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
            regions.clear();
            Region.clear();

            // Recreate Location instances
            for (const [id, locationData] of Object.entries(gameWorldData.locations || {})) {
                const location = new Location({
                    description: locationData.description ?? null,
                    baseLevel: locationData.baseLevel ?? null,
                    id: locationData.id,
                    name: locationData.name ?? null,
                    imageId: locationData.imageId ?? null,
                    isStub: locationData.isStub ?? false,
                    stubMetadata: locationData.stubMetadata ?? null,
                    hasGeneratedStubs: locationData.hasGeneratedStubs ?? false,
                    npcIds: locationData.npcIds || []
                });

                const exitsByDirection = locationData.exits || {};
                for (const [direction, exitInfo] of Object.entries(exitsByDirection)) {
                    if (!exitInfo || !exitInfo.destination) {
                        continue;
                    }

                    const exitId = exitInfo.id || undefined;
                    let exit = exitId ? gameLocationExits.get(exitId) : null;

                    if (!exit) {
                        exit = new LocationExit({
                            description: exitInfo.description || `Path to ${exitInfo.destination}`,
                            destination: exitInfo.destination,
                            bidirectional: exitInfo.bidirectional !== false,
                            id: exitId
                        });
                        gameLocationExits.set(exit.id, exit);
                    }

                    location.addExit(direction, exit);
                }

                gameLocations.set(id, location);
            }

            // Recreate LocationExit instances not already attached
            for (const [id, exitData] of Object.entries(gameWorldData.locationExits || {})) {
                if (gameLocationExits.has(id)) {
                    continue;
                }
                const exit = new LocationExit({
                    description: exitData.description,
                    destination: exitData.destination,
                    bidirectional: exitData.bidirectional,
                    id: exitData.id
                });
                gameLocationExits.set(id, exit);
            }

            for (const [id, regionData] of Object.entries(gameWorldData.regions || {})) {
                try {
                    const region = Region.fromJSON(regionData);
                    regions.set(id, region);
                } catch (regionError) {
                    console.warn(`Failed to load region ${id}:`, regionError.message);
                }
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
            timeout: 30000 // 30 second timeout for test
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
