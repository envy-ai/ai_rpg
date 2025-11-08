const http = require('http');
const express = require('express');
const axios = require('axios');
const LLMClient = require('./LLMClient.js');
const attachAxiosMetricsLogger = require('./utils/axios-metrics.js');
const bodyParser = require('body-parser');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Utils = require('./Utils.js');
const Globals = require('./Globals.js');
const { getCurrencyLabel } = require('./public/js/currency-utils.js');
const SanitizedStringSet = require('./SanitizedStringSet.js');

// Import Player class
const Player = require('./Player.js');

// Import Location and LocationExit classes  
const Location = require('./Location.js');
const LocationExit = require('./LocationExit.js');

// Import Thing class
const Thing = require('./Thing.js');
const SlashCommandRegistry = require('./SlashCommandRegistry.js');

function getDefaultRarityLabel() {
    return Thing.getDefaultRarityLabel();
}

// Import Skill class
const Skill = require('./Skill.js');

// Import SettingInfo class
const SettingInfo = require('./SettingInfo.js');

// Import Region class
const Region = require('./Region.js');

// Import image generation clients
const ComfyUIClient = require('./ComfyUIClient.js');
const NanoGPTImageClient = require('./NanoGPTImageClient.js');
const OpenAIImageClient = require('./OpenAIImageClient.js');
const Events = require('./Events.js');
const RealtimeHub = require('./RealtimeHub.js');
const QuestConfirmationManager = require('./QuestConfirmationManager.js');

Globals.baseDir = __dirname;

attachAxiosMetricsLogger(axios);

const BANNED_NPC_NAMES_PATH = path.join(__dirname, 'defs', 'banned_npc_names.yaml');
const BANNED_LOCATION_NAMES_PATH = path.join(__dirname, 'defs', 'banned_location_names.yaml');
let cachedBannedNpcWords = null;
let cachedBannedNpcRegexes = null;
let cachedBannedLocationNames = null;
let cachedExperiencePointValues = null;

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
    const defaultConfigPath = path.join(__dirname, 'config.default.yaml');
    const defaultConfigRaw = fs.readFileSync(defaultConfigPath, 'utf8');
    const defaultConfig = yaml.load(defaultConfigRaw) || {};

    const configPath = path.join(__dirname, 'config.yaml');
    const configRaw = fs.readFileSync(configPath, 'utf8');
    const overrideConfig = yaml.load(configRaw) || {};

    const mergeDeep = (target, source) => {
        if (!source || typeof source !== 'object') {
            return target;
        }
        const output = { ...target };
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                output[key] = mergeDeep(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
            } else {
                output[key] = value;
            }
        }
        return output;
    };

    config = mergeDeep(defaultConfig, overrideConfig);
    Globals.config = config;
} catch (error) {
    console.error('Error loading configuration:', error.message);
    process.exit(1);
}

function resolveMaxTokens(...values) {
    let candidate = 0;
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            candidate = Math.max(candidate, numeric);
        }
    }

    const configured = Number(config?.ai?.maxTokens);
    if (Number.isFinite(configured) && configured > 0) {
        candidate = Math.max(candidate, configured);
    }

    if (candidate > 0) {
        return candidate;
    }

    return 512;
}

SlashCommandRegistry.initializeSlashCommands();

const resolveBaseTimeoutMilliseconds = () => {
    if (config?.ai?.baseTimeoutSeconds) {
        const seconds = Number(config.ai.baseTimeoutSeconds);
        if (Number.isFinite(seconds) && seconds > 0) {
            return seconds * 1000;
        }
    }
    return 120 * 1000;
};

const baseTimeoutMilliseconds = resolveBaseTimeoutMilliseconds();
const app = express();
const server = http.createServer(app);
const realtimeHub = new RealtimeHub({ logger: console });
const questConfirmationTimeoutRaw = Number(config?.quests?.confirmationTimeoutMs);
const questConfirmationTimeout = Number.isFinite(questConfirmationTimeoutRaw) && questConfirmationTimeoutRaw > 0
    ? questConfirmationTimeoutRaw
    : null;
const questConfirmationManager = new QuestConfirmationManager({
    timeoutMs: questConfirmationTimeout
});
Globals.realtimeHub = realtimeHub;

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

function sanitizePersonalityValue(value) {
    const collectValues = (input) => {
        if (input === null || input === undefined) {
            return [];
        }

        if (typeof input === 'string') {
            const trimmed = input.trim();
            return trimmed ? [trimmed] : [];
        }

        if (typeof input === 'number' || typeof input === 'boolean') {
            return [String(input)];
        }

        if (Array.isArray(input)) {
            return input.flatMap(collectValues);
        }

        if (typeof input === 'object') {
            return Object.values(input).flatMap(collectValues);
        }

        return [];
    };

    const parts = collectValues(value);
    if (!parts.length) {
        return null;
    }

    return parts.join(', ');
}

function collectPersonalityGoals(value) {
    const goals = [];
    const visit = (entry) => {
        if (entry === null || entry === undefined) {
            return;
        }
        if (typeof entry === 'string') {
            const trimmed = entry.trim();
            if (trimmed && !goals.includes(trimmed)) {
                goals.push(trimmed);
            }
            return;
        }
        if (Array.isArray(entry)) {
            entry.forEach(visit);
            return;
        }
        if (typeof entry === 'object') {
            for (const value of Object.values(entry)) {
                visit(value);
            }
        }
    };
    visit(value);
    return goals;
}

function extractPersonality(primary = null, fallback = null) {
    const primaryObj = primary && typeof primary === 'object' ? primary : null;
    const fallbackObj = fallback && typeof fallback === 'object' ? fallback : null;
    const personalitySource = primaryObj?.personality && typeof primaryObj.personality === 'object'
        ? primaryObj.personality
        : null;

    const type = sanitizePersonalityValue(
        personalitySource?.type
        ?? primaryObj?.personalityType
        ?? fallbackObj?.personalityType
    );
    const traits = sanitizePersonalityValue(
        personalitySource?.traits
        ?? primaryObj?.personalityTraits
        ?? fallbackObj?.personalityTraits
    );
    const notes = sanitizePersonalityValue(
        personalitySource?.notes
        ?? primaryObj?.personalityNotes
        ?? fallbackObj?.personalityNotes
    );

    const goals = collectPersonalityGoals(
        personalitySource?.goals
        ?? primaryObj?.goals
        ?? primaryObj?.personalityGoals
        ?? fallbackObj?.personality?.goals
        ?? fallbackObj?.goals
    );

    return { type, traits, notes, goals };
}

axios.interceptors.request.use(request_config => {
    if (!config?.ai?.preventReasoning) {
        return request_config;
    }

    try {
        const isChatRequest =
            typeof request_config.url === 'string' &&
            /\/chat\/completions$/.test(request_config.url);

        if (isChatRequest && request_config.data && Array.isArray(request_config.data.messages)) {
            const cannedAssistant = {
                role: 'assistant',
                content: '<think></think>'
            };

            // Insert the pre-seeded assistant reply before the user turn
            request_config.data.messages.splice(0, 0, cannedAssistant);
            // If you prefer it at the very front, use splice(0, 0, cannedAssistant)
        }
    } catch (err) {
        console.warn('Prompt seeding interceptor failed:', err.message);
    }
    return request_config;
});

function getImagePromptTemplateName(kind, fallback) {
    const templates = config?.imagegen?.prompt_generator_templates || {};
    const template = templates[kind];
    if (typeof template === 'string' && template.trim()) {
        return template.trim();
    }
    return fallback;
}

function buildNegativePrompt(extra = '') {
    const base = (config?.imagegen?.default_negative_prompt || '').trim();
    const extraPart = (extra || '').trim();
    if (base && extraPart) {
        const separator = extraPart.startsWith(',') ? '' : ', ';
        return `${base}${separator}${extraPart}`;
    }
    return base || extraPart;
}

function getDefaultMegapixels() {
    const value = Number(config?.imagegen?.megapixels);
    if (Number.isFinite(value) && value > 0) {
        return value;
    }
    return 1.0;
}

function resolveMegapixels(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    return getDefaultMegapixels();
}

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

function getWorldOutline() {
    // We need to populate worldOutline with regions and their locations
    let worldOutline = {
        regions: {}
    };

    // Iterate all regions
    let regionMap = Region.getIndexByName();
    // Get name of each region
    for (const [regionName, regionObj] of regionMap) {
        worldOutline.regions[regionObj.name] = [];
        for (const locationObj of regionObj.locations) {
            worldOutline.regions[regionObj.name].push(locationObj.name);
        }
    }
    return worldOutline;
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
    //console.log('Checking existing image for ID:', imageId);
    if (!imageId) {
        console.warn('No image ID provided');
        return false;
    }
    if (generatedImages.has(imageId)) {
        //console.log(`Found existing image in cache for ID: ${imageId}`);
        return true;
    }
    console.log(`No existing image found for ID: ${imageId}`);
    if (imageFileExists(imageId)) {
        //console.log(`Found existing image file for ID: ${imageId}`);
        generatedImages.set(imageId, { id: imageId });
        return true;
    }
    return false;
}

// Create a new image generation job
function createImageJob(jobId, payload = {}) {
    const job = {
        id: jobId,
        status: JOB_STATUS.QUEUED,
        payload,
        progress: 0,
        message: 'Job queued for processing',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        timeout: baseTimeoutMilliseconds, // 2 minutes timeout
        subscribers: new Set()
    };

    if (payload && payload.clientId) {
        job.subscribers.add(payload.clientId);
    }

    imageJobs.set(jobId, job);
    emitJobUpdate(job, { phase: 'queued' });
    return job;
}

function sanitizeJobForRealtime(job, extra = {}) {
    if (!job) {
        return null;
    }

    const jobPayload = job.payload || {};
    const base = {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error || null,
        result: job.result || null,
        payload: {
            entityType: jobPayload.entityType || null,
            entityId: jobPayload.entityId || null,
            isPlayerPortrait: Boolean(jobPayload.isPlayerPortrait),
            isLocationScene: Boolean(jobPayload.isLocationScene),
            isThingImage: Boolean(jobPayload.isThingImage),
            isLocationExitImage: Boolean(jobPayload.isLocationExitImage),
            isCustomImage: Boolean(jobPayload.isCustomImage || jobPayload.customJob)
        }
    };

    return { ...base, ...extra };
}

function emitJobUpdate(job, extra = {}, options = {}) {
    if (!job) {
        return;
    }

    const payload = sanitizeJobForRealtime(job, extra);
    if (!payload) {
        return;
    }

    const recipients = new Set();

    if (options.target) {
        recipients.add(options.target);
    }

    if (Array.isArray(options.targets)) {
        options.targets.forEach(target => {
            if (target) {
                recipients.add(target);
            }
        });
    }

    if (!options.target && !options.targets && job.subscribers && job.subscribers.size) {
        job.subscribers.forEach(clientId => {
            if (clientId) {
                recipients.add(clientId);
            }
        });
    }

    if (options.broadcast) {
        recipients.add(null);
    }

    if (!recipients.size) {
        return;
    }

    for (const clientId of recipients) {
        realtimeHub.emit(clientId || null, 'image_job_update', payload);
    }
}

function addJobSubscriber(jobOrId, clientId, { emitSnapshot = false } = {}) {
    if (!clientId) {
        return null;
    }

    const job = typeof jobOrId === 'string' ? imageJobs.get(jobOrId) : jobOrId;
    if (!job) {
        return null;
    }

    if (!job.subscribers) {
        job.subscribers = new Set();
    }

    job.subscribers.add(clientId);

    if (emitSnapshot) {
        emitJobUpdate(job, { phase: 'snapshot' }, { target: clientId });
    }

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
        emitJobUpdate(job, { phase: 'processing' });

        // Set timeout
        const timeoutId = setTimeout(() => {
            if (job.status === JOB_STATUS.PROCESSING) {
                job.status = JOB_STATUS.TIMEOUT;
                job.error = 'Job timed out after 2 minutes';
                job.completedAt = new Date().toISOString();
                emitJobUpdate(job, { phase: 'timeout' });
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

                emitJobUpdate(job, { phase: 'completed' });
            }

        } catch (error) {
            clearTimeout(timeoutId);

            if (job.status !== JOB_STATUS.TIMEOUT) {
                console.error('❌ Image generation job failed:', {
                    jobId: job.id,
                    entityType: job.payload?.entityType,
                    entityId: job.payload?.entityId,
                    error: error?.message,
                    stack: error?.stack
                });
                job.status = JOB_STATUS.FAILED;
                job.error = error.message;
                job.message = `Generation failed: ${error.message}`;
                job.completedAt = new Date().toISOString();
                if (job.payload.isLocationScene && job.payload.locationId) {
                    pendingLocationImages.delete(job.payload.locationId);
                }
                emitJobUpdate(job, { phase: 'failed' });
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
    const { prompt, width, height, steps, seed, negative_prompt, megapixels } = job.payload;

    // Generate unique image ID
    const imageId = generateImageId();

    // Prepare template variables
    const fallbackNegativePrompt = buildNegativePrompt();
    const effectiveNegativePrompt = (typeof negative_prompt === 'string' && negative_prompt.trim()) || fallbackNegativePrompt || 'blurry, low quality, distorted';
    const effectiveMegapixels = resolveMegapixels(megapixels);
    const templateVars = {
        image: {
            prompt: prompt.trim(),
            width: width || config.imagegen.default_settings.image.width || 1024,
            height: height || config.imagegen.default_settings.image.height || 1024,
            steps: steps || config.imagegen.default_settings.sampling.steps || 20,
            checkpoint: config.imagegen.checkpoint || 'sdxl.safetensors',
            lora: config.imagegen.lora || null,
            lora_strength: config.imagegen.lora_strength || 1,
            seed: seed || config.imagegen.default_settings.image.seed || Math.floor(Math.random() * 1000000),
            negativePrompt: effectiveNegativePrompt,
            megapixels: effectiveMegapixels
        },
        negative_prompt: effectiveNegativePrompt
    };

    const engine = config.imagegen?.engine || 'comfyui';
    const savedImages = [];
    const saveDirectory = path.join(__dirname, 'public', 'generated-images');
    let comfyQueueId = null;

    if (!fs.existsSync(saveDirectory)) {
        try {
            fs.mkdirSync(saveDirectory, { recursive: true });
        } catch (dirError) {
            throw new Error(`Failed to create images directory: ${dirError.message}`);
        }
    }

    if (engine === 'nanogpt' || engine === 'openai') {
        job.progress = 30;
        job.message = `Requesting ${engine === 'nanogpt' ? 'NanoGPT' : 'OpenAI'} image...`;

        const generationResult = await withRetry(async () => {
            return await comfyUIClient.generateImage({
                prompt: templateVars.image.prompt,
                negativePrompt: templateVars.negative_prompt,
                width: templateVars.image.width,
                height: templateVars.image.height,
                seed: templateVars.image.seed
            });
        });

        if (!generationResult || !generationResult.imageBuffer) {
            throw new Error(`${engine === 'nanogpt' ? 'NanoGPT' : 'OpenAI'} image response missing data`);
        }

        job.progress = 70;
        job.message = `Saving ${engine === 'nanogpt' ? 'NanoGPT' : 'OpenAI'} image...`;

        const saveResult = await comfyUIClient.saveImage(
            generationResult.imageBuffer,
            imageId,
            `${generationResult.requestId}.png`,
            saveDirectory
        );

        savedImages.push({
            imageId,
            filename: saveResult.filename,
            url: `/generated-images/${saveResult.filename}`,
            size: saveResult.size
        });
        job.progress = 90;
        job.message = `${engine === 'nanogpt' ? 'NanoGPT' : 'OpenAI'} image saved.`;
        comfyQueueId = generationResult.requestId;
    } else {
        job.progress = 20;
        job.message = 'Rendering workflow template...';

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

        const queueResult = await withRetry(async () => {
            return await comfyUIClient.queuePrompt(workflow);
        });

        if (!queueResult.success) {
            throw new Error(`Failed to queue prompt: ${queueResult.error}`);
        }

        comfyQueueId = queueResult.promptId;

        job.progress = 50;
        job.message = 'Waiting for generation to complete...';

        const completionResult = await withRetry(async () => {
            return await comfyUIClient.waitForCompletion(queueResult.promptId);
        });

        if (!completionResult.success) {
            throw new Error(`Generation failed: ${completionResult.error}`);
        }

        job.progress = 80;
        job.message = 'Downloading and saving images...';

        for (const imageInfo of completionResult.images) {
            try {
                const imageData = await withRetry(async () => {
                    return await comfyUIClient.getImage(
                        imageInfo.filename,
                        imageInfo.subfolder,
                        imageInfo.type
                    );
                });

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
            }
        }

        if (savedImages.length === 0) {
            throw new Error('No images were successfully saved');
        }
        job.progress = 90;
        job.message = 'Images saved successfully.';
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
        comfyUIPromptId: comfyQueueId,
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

        if (config.imagegen.engine === 'nanogpt') {
            if (!config.imagegen.apiKey && !process.env.NANOGPT_API_KEY) {
                validationErrors.push('Image generation: imagegen.apiKey (or NANOGPT_API_KEY env) is required for NanoGPT engine');
            }
            if (!config.imagegen.model) {
                validationErrors.push('Image generation: imagegen.model is required for NanoGPT engine');
            }
        } else if (config.imagegen.engine === 'openai') {
            if (!config.imagegen.apiKey && !process.env.OPENAI_API_KEY) {
                validationErrors.push('Image generation: imagegen.apiKey (or OPENAI_API_KEY env) is required for OpenAI engine');
            }
            if (!config.imagegen.model) {
                validationErrors.push('Image generation: imagegen.model is required for OpenAI engine');
            }
        } else if (config.imagegen.engine === 'comfyui' || !config.imagegen.engine) {
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
        } else {
            validationErrors.push(`Image generation: unknown engine '${config.imagegen.engine}'`);
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
async function initializeImageEngine() {
    if (!config.imagegen || !config.imagegen.enabled) {
        console.log('🎨 Image generation disabled in configuration');
        return;
    }

    const engine = config.imagegen.engine || 'comfyui';

    if (engine === 'comfyui') {
        try {
            comfyUIClient = new ComfyUIClient(config);
            console.log(`🎨 ComfyUI client initialized for ${config.imagegen.server.host}:${config.imagegen.server.port}`);

            console.log('🔌 Testing ComfyUI server connectivity...');
            const testResponse = await axios.get(`http://${config.imagegen.server.host}:${config.imagegen.server.port}/queue`, {
                timeout: baseTimeoutMilliseconds
            });

            if (testResponse.status === 200) {
                console.log('✅ ComfyUI server is accessible');
            } else {
                throw new Error(`ComfyUI returned status ${testResponse.status}`);
            }
        } catch (error) {
            throw new Error(`ComfyUI initialization failed: ${error.message}`);
        }
    } else if (engine === 'nanogpt') {
        try {
            comfyUIClient = new NanoGPTImageClient(config);
            console.log('🎨 NanoGPT image client initialized.');
        } catch (error) {
            throw new Error(`NanoGPT initialization failed: ${error.message}`);
        }
    } else if (engine === 'openai') {
        try {
            comfyUIClient = new OpenAIImageClient(config);
            console.log('🎨 OpenAI image client initialized.');
        } catch (error) {
            throw new Error(`OpenAI initialization failed: ${error.message}`);
        }
    } else {
        throw new Error(`Unknown image generation engine '${engine}'`);
    }
}

// In-memory chat history storage
let chatHistory = [];
let currentTurnToken = null;

let baseContextMemoryCache = {
    turnKey: null,
    selections: new Map()
};

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

function normalizeSettingValue(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return fallback;
}

function normalizeSettingList(value) {
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
        playerRace: '',
        startingCurrency: 0
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
        ? Math.max(0, Math.min(100, parsedSkillCount))
        : defaults.numSkills;

    const existingSkills = Array.isArray(settingSnapshot.defaultExistingSkills)
        ? settingSnapshot.defaultExistingSkills
        : (typeof settingSnapshot.defaultExistingSkills === 'string'
            ? settingSnapshot.defaultExistingSkills.split(/\r?\n/)
            : []);

    defaults.existingSkills = existingSkills
        .map(skill => (typeof skill === 'string' ? skill.trim() : ''))
        .filter(skill => skill.length > 0);

    const classList = normalizeSettingList(settingSnapshot.availableClasses);
    const raceList = normalizeSettingList(settingSnapshot.availableRaces);

    defaults.availableClasses = classList;
    defaults.availableRaces = raceList;

    const parsedDefaultCurrency = Number.parseInt(settingSnapshot.defaultStartingCurrency, 10);
    if (Number.isFinite(parsedDefaultCurrency)) {
        defaults.startingCurrency = Math.max(0, parsedDefaultCurrency);
    }
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

function buildSettingPromptContext(settingSnapshot = null, { descriptionFallback = null } = {}) {
    const fallbackDescription = typeof descriptionFallback === 'string' && descriptionFallback
        ? descriptionFallback
        : describeSettingForPrompt(settingSnapshot);

    const context = {
        name: normalizeSettingValue(settingSnapshot?.name, ''),
        description: normalizeSettingValue(settingSnapshot?.description, fallbackDescription || ''),
        theme: normalizeSettingValue(settingSnapshot?.theme, ''),
        genre: normalizeSettingValue(settingSnapshot?.genre, ''),
        startingLocationType: normalizeSettingValue(settingSnapshot?.startingLocationType, ''),
        magicLevel: normalizeSettingValue(settingSnapshot?.magicLevel, ''),
        techLevel: normalizeSettingValue(settingSnapshot?.techLevel, ''),
        tone: normalizeSettingValue(settingSnapshot?.tone, ''),
        difficulty: normalizeSettingValue(settingSnapshot?.difficulty, ''),
        currencyName: normalizeSettingValue(settingSnapshot?.currencyName, ''),
        currencyNamePlural: normalizeSettingValue(settingSnapshot?.currencyNamePlural, ''),
        currencyValueNotes: normalizeSettingValue(settingSnapshot?.currencyValueNotes, ''),
        writingStyleNotes: normalizeSettingValue(settingSnapshot?.writingStyleNotes, '')
    };

    if (!context.description && fallbackDescription) {
        context.description = fallbackDescription;
    }

    context.races = normalizeSettingList(settingSnapshot?.availableRaces);

    return context;
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
const levelUpAbilityPromises = new Map(); // Track in-flight level-up ability generations per character

function generateChatMessageId() {
    if (typeof randomUUID === 'function') {
        try {
            return randomUUID();
        } catch (_) {
            // fall through to fallback ID generation below
        }
    }
    return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeChatEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    if (!entry.id) {
        entry.id = generateChatMessageId();
    }
    if (!entry.timestamp) {
        entry.timestamp = new Date().toISOString();
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'parentId')) {
        entry.parentId = null;
    }
    return entry;
}

function collectNpcNamesForContext(entry = null) {
    const names = new Set();

    const addNpcId = (npcId) => {
        if (!npcId || typeof npcId !== 'string') {
            return;
        }
        const npc = players.get(npcId);
        if (npc && npc.isNPC) {
            const label = typeof npc.name === 'string' && npc.name.trim()
                ? npc.name.trim()
                : npcId;
            names.add(label);
        }
    };

    let locationId = null;
    if (entry && entry.locationId) {
        locationId = entry.locationId;
    } else if (entry?.metadata?.locationId) {
        locationId = entry.metadata.locationId;
    } else if (currentPlayer?.currentLocation) {
        locationId = currentPlayer.currentLocation;
    }

    if (locationId) {
        let locationRecord = gameLocations.get(locationId) || null;
        if (!locationRecord && typeof Location?.get === 'function') {
            try {
                locationRecord = Location.get(locationId) || null;
            } catch (_) {
                locationRecord = null;
            }
        }

        if (locationRecord && Array.isArray(locationRecord.npcIds)) {
            locationRecord.npcIds.forEach(addNpcId);
        }
    }

    if (currentPlayer) {
        const partyMembers = typeof currentPlayer.getPartyMembers === 'function'
            ? currentPlayer.getPartyMembers()
            : (Array.isArray(currentPlayer.party) ? currentPlayer.party : []);

        if (Array.isArray(partyMembers)) {
            partyMembers.forEach(addNpcId);
        } else if (partyMembers && typeof partyMembers.forEach === 'function') {
            partyMembers.forEach(addNpcId);
        }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function pushChatEntry(entry, collector = null, locationId = null) {
    const normalized = normalizeChatEntry(entry);
    if (!normalized) {
        return null;
    }

    const resolvedLocationId = (() => {
        if (locationId && typeof locationId === 'string' && locationId.trim()) {
            return locationId.trim();
        }
        if (typeof normalized.locationId === 'string' && normalized.locationId.trim()) {
            return normalized.locationId.trim();
        }
        const metadataLocation = normalized.metadata && typeof normalized.metadata === 'object'
            ? normalized.metadata.locationId
            : null;
        if (typeof metadataLocation === 'string' && metadataLocation.trim()) {
            return metadataLocation.trim();
        }
        throw new Error('pushChatEntry is missing a valid locationId');
    })();

    normalized.locationId = resolvedLocationId;
    const existingMetadata = normalized.metadata && typeof normalized.metadata === 'object'
        ? normalized.metadata
        : {};
    normalized.metadata = {
        ...existingMetadata,
        locationId: resolvedLocationId
    };

    if (!normalized.travel) {
        const npcNames = collectNpcNamesForContext(normalized);
        if (npcNames.length) {
            normalized.metadata = {
                ...normalized.metadata,
                npcNames
            };
        }
    }

    chatHistory.push(normalized);
    if (Array.isArray(collector)) {
        collector.push(normalized);
    }
    return normalized;
}

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

function serializeNpcForClient(npc, options = {}) {
    const { includePartyMembers = true } = options || {};
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

    let importantMemories = [];
    try {
        importantMemories = Array.isArray(npc.importantMemories)
            ? npc.importantMemories.slice(0)
            : (typeof npc.getImportantMemories === 'function' ? npc.getImportantMemories() : []);
    } catch (_) {
        importantMemories = [];
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
            const equippedResolver = typeof npc.getEquippedSlotForThing === 'function'
                ? (itemLike) => npc.getEquippedSlotForThing(itemLike)
                : () => null;
            inventory = npc.getInventoryItems().map(item => {
                const serialized = typeof item.toJSON === 'function' ? item.toJSON() : { ...item };
                const equippedSlot = equippedResolver(item);
                serialized.isEquipped = Boolean(equippedSlot);
                if (equippedSlot) {
                    serialized.equippedSlot = equippedSlot;
                }
                return serialized;
            });
        }
    } catch (_) {
        inventory = [];
    }

    let currency = null;
    try {
        if (typeof npc.getCurrency === 'function') {
            currency = npc.getCurrency();
        } else if (npc.currency !== undefined && npc.currency !== null) {
            currency = npc.currency;
        }
        if (currency !== null) {
            const numericCurrency = Number.parseInt(currency, 10);
            currency = Number.isFinite(numericCurrency) && numericCurrency >= 0 ? numericCurrency : null;
        }
    } catch (_) {
        currency = null;
    }

    let experience = null;
    try {
        if (npc.experience !== undefined && npc.experience !== null) {
            const numericExperience = Number.parseInt(npc.experience, 10);
            experience = Number.isFinite(numericExperience) && numericExperience >= 0 ? numericExperience : null;
        }
    } catch (_) {
        experience = null;
    }

    const playerId = Player.getCurrentPlayerId ? Player.getCurrentPlayerId() : null;
    const dispositionDefinitions = Player.dispositionDefinitions || {};
    const dispositionTypes = dispositionDefinitions.types || {};
    const dispositionsTowardPlayer = {};
    let hostileToPlayer = false;
    if (playerId && playerId !== npc.id) {
        for (const def of Object.values(dispositionTypes)) {
            if (!def) {
                continue;
            }
            const key = def.key || def.label;
            if (!key || typeof npc.getDisposition !== 'function') {
                continue;
            }
            const value = npc.getDisposition(playerId, key);
            if (Number.isFinite(value)) {
                dispositionsTowardPlayer[key] = value;
                if (def.hostileThreshold !== null && def.hostileThreshold !== undefined) {
                    const threshold = Number(def.hostileThreshold);
                    if (Number.isFinite(threshold) && value <= threshold) {
                        hostileToPlayer = true;
                    }
                }
            }
        }
    }

    let personality = null;
    try {
        const npcStatus = typeof npc.getStatus === 'function' ? npc.getStatus() : null;
        personality = extractPersonality(npcStatus, npc);
    } catch (_) {
        personality = extractPersonality(null, npc);
    }

    let partyMembers = null;
    if (includePartyMembers && typeof npc.getPartyMembers === 'function') {
        try {
            const rawMemberIds = npc.getPartyMembers();
            const memberIds = Array.isArray(rawMemberIds)
                ? rawMemberIds
                : (rawMemberIds instanceof Set ? Array.from(rawMemberIds) : []);

            partyMembers = memberIds
                .map(id => players.get(id))
                .filter(Boolean)
                .map(member => serializeNpcForClient(member, { includePartyMembers: false }));
        } catch (_) {
            partyMembers = [];
        }
    }

    const serialized = {
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
        isPlayer: !Boolean(npc.isNPC),
        isHostile: Boolean(npc.isHostile),
        isDead: Boolean(npc.isDead),
        isInPlayerParty: Boolean(npc.isInPlayerParty),
        isHostileToPlayer: hostileToPlayer,
        locationId: npc.currentLocation,
        corpseCountdown: Number.isFinite(npc.corpseCountdown) ? npc.corpseCountdown : (npc.corpseCountdown ?? null),
        attributes,
        skills,
        abilities,
        importantMemories,
        statusEffects,
        unspentSkillPoints,
        inventory,
        currency,
        experience,
        needBars: typeof npc.getNeedBars === 'function' ? npc.getNeedBars() : [],
        personality,
        personalityType: personality?.type ?? null,
        personalityTraits: personality?.traits ?? null,
        personalityNotes: personality?.notes ?? null,
        createdAt: npc.createdAt,
        lastUpdated: npc.lastUpdated,
        dispositionsTowardPlayer
    };

    if (typeof npc.getCurrentQuests === 'function') {
        try {
            const activeQuests = npc.getCurrentQuests();
            serialized.quests = Array.isArray(activeQuests)
                ? activeQuests.map(quest => (typeof quest?.toJSON === 'function' ? quest.toJSON() : { ...quest }))
                : [];
        } catch (_) {
            serialized.quests = [];
        }
    }

    if (typeof npc.getCompletedQuests === 'function') {
        try {
            const pastQuests = npc.getCompletedQuests();
            serialized.completedQuests = Array.isArray(pastQuests)
                ? pastQuests.map(quest => (typeof quest?.toJSON === 'function' ? quest.toJSON() : { ...quest }))
                : [];
        } catch (_) {
            serialized.completedQuests = [];
        }
    }

    if (includePartyMembers) {
        serialized.partyMembers = Array.isArray(partyMembers) ? partyMembers : [];
    }

    return serialized;
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

function findActorById(id) {
    if (!id || typeof id !== 'string') {
        return null;
    }

    if (currentPlayer && currentPlayer.id === id) {
        return currentPlayer;
    }

    if (players instanceof Map) {
        const actor = players.get(id);
        if (actor) {
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
    const existingNames = new SanitizedStringSet(Player.getAll().map(npc => npc.name));

    const generated = await generateNpcFromEvent({
        name,
        location: resolvedLocation,
        region: resolvedRegion,
        oldItem: context.oldItem || null
    });

    if (!generated) {
        throw new Error(`Failed to generate NPC: ${name}`);
    }

    await enforceBannedNpcNameForPlayer({
        npc: generated,
        location: resolvedLocation,
        region: resolvedRegion,
        existingNames
    });

    return generated;
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
    const settingContext = buildSettingPromptContext(activeSetting, { descriptionFallback: settingDescription });
    const generatedThingRarity = Thing.generateRandomRarityDefinition();

    const needBarDefinitions = Player.getNeedBarDefinitionsForContext();
    const attributeEntriesForPrompt = Object.keys(attributeDefinitionsForPrompt || {})
        .filter(name => typeof name === 'string' && name.trim())
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const equipmentSlotTypesForPrompt = getGearSlotTypes();
    const gearSlotNamesForPrompt = getGearSlotNames();

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

    const locationDetails = location ? location.getDetails() : null;
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

    const exitSummaries = [];
    if (locationDetails && typeof locationDetails.exits === 'object' && locationDetails.exits !== null) {
        for (const [directionKey, exitInfo] of Object.entries(locationDetails.exits)) {
            if (!exitInfo) {
                continue;
            }

            //console.log('Exit info:', directionKey, exitInfo);

            const label = exitInfo.relativeName;
            exitSummaries.push({
                name: label,
                isVehicle: Boolean(exitInfo.isVehicle),
                vehicleType: typeof exitInfo.vehicleType === 'string' ? exitInfo.vehicleType : null
            });
        }
    }


    const currentLocationContext = location ? {
        name: locationDetails?.name || location?.name || 'Unknown Location',
        description: locationDetails?.description || location?.description || 'No description available.',
        statusEffects: normalizeStatusEffects(location || locationDetails),
        exits: exitSummaries,
        items: location.items,
        scenery: location.scenery
    } : null;

    const regionStatus = region && typeof region.toJSON === 'function' ? region.toJSON() : null;
    const regionLocations = [];

    /*  <worldOutline>
    {% for region in worldOutline.regions %}
    <region name="{{ region.name }}">
      <name>{{ region.name }}</name>
      <locations>
        {% for loc in region.locations %}<name>{{ loc.name }}</name>
        {% endfor %}
      </locations>
    </region>
    {% endfor %}
    </worldOutline> */

    let worldOutline = getWorldOutline();

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
        locations: regionLocations,
        secrets: regionStatus?.secrets || []
    };

    const mapItemContext = (item, equippedSlot = null) => {
        if (!item) {
            return null;
        }

        const name = item.name || item.title || 'Unknown Item';
        const description = item.description || item.summary || '';
        const statusEffects = normalizeStatusEffects(item);
        const equipped = equippedSlot || null;
        const metadataIsScenery = typeof item?.metadata?.isScenery === 'boolean'
            ? item.metadata.isScenery
            : null;

        const resolveTypeValue = (value) => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            return trimmed ? trimmed.toLowerCase() : null;
        };

        const normalizedThingType = resolveTypeValue(
            item?.thingType
            ?? item?.itemOrScenery
            ?? item?.type
            ?? item?.itemTypeDetail
        );

        let isScenery = null;
        if (typeof item?.isScenery === 'boolean') {
            isScenery = item.isScenery;
        } else if (metadataIsScenery !== null) {
            isScenery = metadataIsScenery;
        } else if (normalizedThingType) {
            isScenery = normalizedThingType === 'scenery';
        }

        if (isScenery === null) {
            isScenery = false;
        }

        return {
            name,
            description,
            statusEffects,
            equippedSlot: equipped,
            isScenery,
            thingType: normalizedThingType || (isScenery ? 'scenery' : null),
            rarity: item.rarity || null,
            attributeBonuses: Array.isArray(item.attributeBonuses) ? item.attributeBonuses : [],
            causeStatusEffect: item.causeStatusEffect || null,
            value: item.metadata.value,
            weight: item.metadata.weight,
            properties: item.metadata.properties
        };
    };

    const isInterestingSkill = (skillName, rank) => {
        if (!skillName) {
            return false;
        }
        const normalized = skillName.trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const boringPrefixes = ['basic ', 'common ', 'general '];
        if (boringPrefixes.some(prefix => normalized.startsWith(prefix))) {
            return false;
        }

        if (normalized === 'common knowledge' || normalized === 'general knowledge') {
            return false;
        }

        const rankValue = Number.isFinite(rank) ? rank : 0;
        return rankValue >= 2 || normalized.length > 4;
    };

    const mapSkillContext = (skillsSource) => {
        if (!skillsSource) {
            return [];
        }

        const entries = [];
        const skillEntries = skillsSource instanceof Map
            ? Array.from(skillsSource.entries())
            : (typeof skillsSource === 'object' && skillsSource !== null
                ? Object.entries(skillsSource)
                : []);

        for (const [skillName, rank] of skillEntries) {
            if (!skillName) {
                continue;
            }

            const numericRank = Number.isFinite(rank) ? rank : Number(rank);
            if (!isInterestingSkill(skillName, numericRank)) {
                continue;
            }

            let skillDef = skills.get(skillName);
            if (!skillDef && typeof skillName === 'string') {
                const normalized = skillName.trim().toLowerCase();
                for (const [name, definition] of skills.entries()) {
                    if (typeof name === 'string' && name.trim().toLowerCase() === normalized) {
                        skillDef = definition;
                        break;
                    }
                }
            }
            const description = skillDef?.description || skillDef?.details || '';
            entries.push({
                name: skillName,
                value: Number.isFinite(numericRank) ? numericRank : null,
                description
            });
        }

        return entries.sort((a, b) => a.name.localeCompare(b.name));
    };

    const collectActorSkills = (status, actor) => {
        if (status?.skillInfo && Array.isArray(status.skillInfo)) {
            return status.skillInfo;
        }

        if (status?.skills) {
            return mapSkillContext(status.skills);
        }

        if (actor && typeof actor.getSkills === 'function') {
            const source = actor.getSkills();
            if (source) {
                return mapSkillContext(source);
            }
        }

        return [];
    };

    const currentPlayerInventory = Array.isArray(playerStatus?.inventory)
        ? playerStatus.inventory.map(item => mapItemContext(item, item?.equippedSlot || null)).filter(Boolean)
        : [];

    const currentPlayerSkills = collectActorSkills(playerStatus, currentPlayer);

    const collectNeedBarsForPrompt = (actor, status, options = {}) => {
        if (actor && typeof actor.getNeedBarPromptContext === 'function') {
            return actor.getNeedBarPromptContext(options);
        }

        if (Array.isArray(status?.needBars)) {
            return status.needBars.map(bar => ({
                ...bar
            }));
        }

        return [];
    };

    const currentPlayerNeedBars = collectNeedBarsForPrompt(currentPlayer, playerStatus, { includePlayerOnly: true });

    const gearSnapshot = playerStatus?.gear && typeof playerStatus.gear === 'object'
        ? Object.entries(playerStatus.gear).map(([slotName, slotData]) => ({
            slot: slotName,
            itemId: slotData?.itemId || null
        }))
        : [];

    const abilities = currentPlayer.getAbilities() || [];

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
        abilities: abilities,
        skills: currentPlayerSkills,
        gear: gearSnapshot,
        personality: extractPersonality(playerStatus, currentPlayer),
        currency: playerStatus?.currency ?? currentPlayer?.currency ?? 0,
        needBars: currentPlayerNeedBars,
        currentQuests: currentPlayer.currentQuests,
    };

    function computeDispositionsTowardsPlayer(actor) {
        if (!actor || !currentPlayer || typeof currentPlayer.id !== 'string' || !currentPlayer.id || !dispositionTypes.length) {
            return [];
        }

        const dispositions = [];
        for (const dispositionType of dispositionTypes) {
            if (!dispositionType || !dispositionType.key) {
                continue;
            }
            const typeKey = dispositionType.key;
            const typeLabel = dispositionType.label || typeKey;
            let value = 0;
            if (typeof actor.getDispositionTowardsCurrentPlayer === 'function') {
                value = actor.getDispositionTowardsCurrentPlayer(typeKey) ?? 0;
            } else if (typeof actor.getDisposition === 'function') {
                value = actor.getDisposition(currentPlayer.id, typeKey) ?? 0;
            }
            const intensityName = Player.resolveDispositionIntensity(typeKey, value);
            dispositions.push({
                type: typeLabel,
                value,
                intensityName
            });
        }
        return dispositions;
    }

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

            const dispositionsTowardsPlayer = computeDispositionsTowardsPlayer(npc);
            const skills = collectActorSkills(npcStatus, npc);
            const personality = extractPersonality(npcStatus, npc);
            const needBars = collectNeedBarsForPrompt(npc, npcStatus, { includePlayerOnly: false });
            const importantMemories = sanitizeImportantMemories(
                npcStatus?.importantMemories
                || npc?.importantMemories
                || []
            );

            npcs.push({
                id: npc.id,
                name: npcStatus?.name || npc.name || 'Unknown NPC',
                description: npcStatus?.description || npc.description || '',
                class: npcStatus?.class || npc.class || null,
                race: npcStatus?.race || npc.race || null,
                level: npcStatus?.level || npc.level || null,
                health: npcStatus?.health ?? npc.health ?? null,
                maxHealth: npcStatus?.maxHealth ?? npc.maxHealth ?? null,
                statusEffects: normalizeStatusEffects(npc || npcStatus),
                inventory: npcInventory,
                abilities: npc.getAbilities(),
                dispositionsTowardsPlayer,
                skills,
                personality,
                needBars,
                importantMemories,
                selectedImportantMemories: []
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
            const personality = extractPersonality(memberStatus, member);
            const dispositionsTowardsPlayer = computeDispositionsTowardsPlayer(member);
            const skills = collectActorSkills(memberStatus, member);
            const needBars = collectNeedBarsForPrompt(member, memberStatus, { includePlayerOnly: !member.isNPC });
            const importantMemories = sanitizeImportantMemories(
                memberStatus?.importantMemories
                || member?.importantMemories
                || []
            );

            party.push({
                id: member.id,
                name: memberStatus?.name || member.name || 'Unknown Ally',
                description: memberStatus?.description || member.description || '',
                class: memberStatus?.class || member.class || null,
                race: memberStatus?.race || member.race || null,
                level: memberStatus?.level || member.level || null,
                health: memberStatus?.health ?? member.health ?? null,
                maxHealth: memberStatus?.maxHealth ?? member.maxHealth ?? null,
                statusEffects: normalizeStatusEffects(member || memberStatus),
                inventory: memberInventory,
                abilities: member.getAbilities(),
                personality,
                skills,
                dispositionsTowardsPlayer,
                needBars,
                importantMemories,
                selectedImportantMemories: []
            });
        }
    }

    if (!npcs.length && party.length) {
        npcs.push(...party.map(member => ({ ...member })));
    }

    const itemsInScene = [];
    if (location) {
        for (const thing of things.values()) {
            const metadata = thing.metadata || {};
            if (metadata.locationId === location.id && !metadata.ownerId) {
                const mappedThing = mapItemContext(thing);
                if (mappedThing) {
                    itemsInScene.push(mappedThing);
                }
            }
        }
    } else {
        console.warn('No location available to collect items in scene.');
        console.trace();
    }

    const historyEntries = Array.isArray(chatHistory) ? chatHistory : [];
    const summaryConfig = config?.summaries || {};
    const rawMaxUnsummarized = Number(summaryConfig.max_unsummarized_log_entries);
    const maxUnsummarizedEntries = Number.isInteger(rawMaxUnsummarized) && rawMaxUnsummarized > 0
        ? rawMaxUnsummarized
        : 0;
    const rawMaxSummarized = Number(summaryConfig.max_summarized_log_entries);
    const maxSummarizedEntries = Number.isInteger(rawMaxSummarized) && rawMaxSummarized > 0
        ? rawMaxSummarized
        : 0;

    const formatSeenBySuffix = (entry) => {
        if (!entry || entry.travel) {
            return '';
        }
        const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null;
        const seen = Array.isArray(metadata?.npcNames) ? metadata.npcNames : null;
        if (!seen || !seen.length) {
            return '';
        }
        return ` [Seen by ${seen.join(', ')}]`;
    };

    const formatLocationSuffix = (entry) => {
        if (!entry) {
            return '';
        }

        const isPlayerAction = entry.type === 'player-action';
        const isRandomAction = entry.type === 'random-event' || entry.randomEvent === true;
        const isNpcAction = entry.isNpcTurn === true;
        if (!isPlayerAction && !isRandomAction && !isNpcAction) {
            return '';
        }

        const rawLocationId = typeof entry.locationId === 'string' && entry.locationId.trim()
            ? entry.locationId.trim()
            : (typeof entry.metadata?.locationId === 'string' && entry.metadata.locationId.trim()
                ? entry.metadata.locationId.trim()
                : '');
        if (!rawLocationId) {
            return '';
        }

        let locationRecord = gameLocations.get(rawLocationId);
        if (!locationRecord && typeof Location?.get === 'function') {
            try {
                locationRecord = Location.get(rawLocationId) || null;
            } catch (_) {
                locationRecord = null;
            }
        }

        const locationDetails = typeof locationRecord?.getDetails === 'function'
            ? locationRecord.getDetails()
            : null;
        const locationName = locationDetails?.name || locationRecord?.name || '';
        if (!locationName) {
            return '';
        }

        return ` [location: ${locationName}]`;
    };

    const relevantHistory = historyEntries.filter(entry => entry && (entry.content) && entry.type !== 'status-summary');

    const totalHistoryLimit = maxUnsummarizedEntries + maxSummarizedEntries;
    const limitedHistory = totalHistoryLimit > 0
        ? relevantHistory.slice(-totalHistoryLimit)
        : [];

    const tailCount = maxUnsummarizedEntries > 0
        ? Math.min(maxUnsummarizedEntries, limitedHistory.length)
        : 0;
    const tailEntries = tailCount > 0
        ? limitedHistory.slice(-tailCount)
        : [];
    const summaryCandidates = tailCount > 0
        ? limitedHistory.slice(0, -tailCount)
        : limitedHistory;

    const summaryLines = [];
    for (const entry of summaryCandidates) {
        if (!entry) {
            continue;
        }
        const summaryText = typeof entry.summary === 'string' ? entry.summary.trim() : '';
        if (!summaryText) {
            continue;
        }
        const suffix = formatSeenBySuffix(entry);
        const locationSuffix = formatLocationSuffix(entry);
        summaryLines.push(`${summaryText}${locationSuffix}${suffix}`);
    }

    const tailLines = [];
    for (const entry of tailEntries) {
        if (!entry) {
            continue;
        }
        const contentText = typeof entry.content === 'string' ? entry.content.trim() : '';
        if (!contentText) {
            continue;
        }
        const role = typeof entry.role === 'string' && entry.role.trim()
            ? entry.role.trim()
            : 'system';
        const suffix = formatSeenBySuffix(entry);
        const locationSuffix = formatLocationSuffix(entry);
        tailLines.push(`[${role}] ${contentText}${locationSuffix}${suffix}`);
    }

    const combinedHistoryLines = summaryLines.concat(tailLines);
    const gameHistory = combinedHistoryLines.length
        ? combinedHistoryLines.join('\n')
        : 'No significant prior events.';

    const experiencePointValues = getExperiencePointValues();

    const context = {
        setting: settingContext,
        config: config,
        gameHistory,
        currentRegion: currentRegionContext,
        currentLocation: currentLocationContext,
        currentPlayer: currentPlayerContext,
        npcs,
        party,
        itemsInScene,
        dispositionTypes: dispositionTypesForPrompt,
        dispositionRange: dispositionDefinitions?.range || {},
        needBarDefinitions,
        gearSlots: gearSlotNamesForPrompt,
        equipmentSlots: equipmentSlotTypesForPrompt,
        attributes: attributeEntriesForPrompt,
        attributeDefinitions: attributeDefinitionsForPrompt,
        rarityDefinitions: Thing.getAllRarityDefinitions(),
        experiencePointValues,
        generatedThingRarity,
        worldOutline
    };

    populateNpcSelectedMemoriesSync(context);

    return context;
}

function getBaseContextTurnKey() {
    const playerId = currentPlayer?.id || 'no-player';
    if (currentTurnToken) {
        return `${playerId}:${currentTurnToken}`;
    }

    const lastEntry = Array.isArray(chatHistory) && chatHistory.length
        ? chatHistory[chatHistory.length - 1]
        : null;
    const marker = lastEntry?.turnId
        || lastEntry?.timestamp
        || lastEntry?.id
        || '';
    return `${playerId}:${chatHistory.length}:${marker}`;
}

function sanitizeImportantMemories(memories) {
    if (!Array.isArray(memories)) {
        return [];
    }
    return memories
        .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
}

function createSelectedEntries(indices, memories) {
    const uniqueIndices = [];
    for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= memories.length) {
            continue;
        }
        if (!uniqueIndices.includes(index)) {
            uniqueIndices.push(index);
        }
    }
    return uniqueIndices.map(idx => ({
        index: idx,
        displayIndex: idx + 1,
        memory: memories[idx]
    }));
}

function cloneSelectedEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map(entry => ({
        index: entry.index,
        displayIndex: entry.displayIndex,
        memory: entry.memory
    }));
}

function populateNpcSelectedMemoriesSync(baseContext) {
    if (!baseContext || !config) {
        return;
    }

    const maxConfigured = Number(config.max_memories_to_recall);
    const maxMemories = Number.isInteger(maxConfigured) && maxConfigured > 0 ? maxConfigured : 10;

    const turnKey = getBaseContextTurnKey();
    if (baseContextMemoryCache.turnKey !== turnKey) {
        baseContextMemoryCache.turnKey = turnKey;
        baseContextMemoryCache.selections = new Map();
    }

    const actors = [];
    const registerActor = (actor, groupLabel) => {
        if (!actor || typeof actor !== 'object') {
            return;
        }
        const actorId = actor.id || `${groupLabel}:${actor.name || ''}`.trim();
        if (!actorId) {
            return;
        }
        const important = sanitizeImportantMemories(actor.importantMemories
            || actor.memories
            || []);
        actor.importantMemories = important;
        actor.selectedImportantMemories = Array.isArray(actor.selectedImportantMemories)
            ? actor.selectedImportantMemories
            : [];
        actors.push({ actor, actorId, important });
    };

    if (Array.isArray(baseContext.npcs)) {
        baseContext.npcs.forEach(npc => registerActor(npc, 'npc'));
    }
    if (Array.isArray(baseContext.party)) {
        baseContext.party.forEach(member => registerActor(member, 'party'));
    }

    for (const entry of actors) {
        const { actor, actorId, important } = entry;
        if (!important.length) {
            actor.selectedImportantMemories = [];
            continue;
        }

        const signature = `${actorId}::${important.join('||')}`;
        const cached = baseContextMemoryCache.selections.get(actorId);

        if (cached && cached.signature === signature && cached.fromFallback !== true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
            continue;
        }

        if (cached && cached.signature === signature && cached.fromFallback === true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
        }

        if (important.length <= maxMemories) {
            const selected = createSelectedEntries(important.map((_, index) => index), important);
            actor.selectedImportantMemories = selected;
            baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(selected), fromFallback: false });
            continue;
        }

        const fallbackIndices = [];
        for (let i = 0; i < Math.min(maxMemories, important.length); i += 1) {
            fallbackIndices.push(i);
        }
        const fallbackSelected = createSelectedEntries(fallbackIndices, important);
        actor.selectedImportantMemories = fallbackSelected;
        baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(fallbackSelected), fromFallback: true });
    }

    baseContext.maxMemoriesToRecall = maxMemories;
}

function extractIndicesFromText(rawText, maxCount) {
    if (!rawText || typeof rawText !== 'string') {
        return [];
    }
    const matches = rawText.match(/\d+/g);
    if (!matches) {
        return [];
    }
    const indices = [];
    for (const match of matches) {
        const parsed = parseInt(match, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            continue;
        }
        const zeroBased = parsed - 1;
        if (!indices.includes(zeroBased)) {
            indices.push(zeroBased);
            if (maxCount && indices.length >= maxCount) {
                break;
            }
        }
    }
    return indices;
}

function parseChooseImportantMemoriesResponse(responseText, maxCount) {
    const selections = new Map();
    if (!responseText || typeof responseText !== 'string') {
        return selections;
    }

    let doc;
    try {
        doc = Utils.parseXmlDocument(`<root>${responseText}</root>`, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent || 'choose_important_memories response contained parser errors');
        }
    } catch (error) {
        console.warn('Failed to parse choose_important_memories response as XML:', error.message);
        return selections;
    }

    const npcNodes = Array.from(doc.getElementsByTagName('npc'));
    for (const node of npcNodes) {
        const nameNode = node.getElementsByTagName('name')[0];
        const recalledNode = node.getElementsByTagName('recalledMemories')[0];
        const name = nameNode?.textContent?.trim();
        const recalledText = recalledNode?.textContent || '';
        if (!name) {
            continue;
        }
        const indices = extractIndicesFromText(recalledText, maxCount);
        if (indices.length) {
            selections.set(name.trim().toLowerCase(), indices);
        }
    }

    return selections;
}

async function populateNpcSelectedMemories(baseContext) {
    if (!baseContext || !config || !Globals.gameLoaded) {
        return;
    }

    const maxConfigured = Number(config.max_memories_to_recall);
    const maxMemories = Number.isInteger(maxConfigured) && maxConfigured > 0 ? maxConfigured : 10;

    const turnKey = getBaseContextTurnKey();
    if (baseContextMemoryCache.turnKey !== turnKey) {
        baseContextMemoryCache.turnKey = turnKey;
        baseContextMemoryCache.selections = new Map();
    }

    const actors = [];
    const registerActor = (actor, groupLabel) => {
        if (!actor || typeof actor !== 'object') {
            return;
        }
        const actorId = actor.id || `${groupLabel}:${actor.name || ''}`.trim();
        if (!actorId) {
            return;
        }
        const important = sanitizeImportantMemories(actor.importantMemories
            || actor.memories
            || []);
        actor.importantMemories = important;
        actor.selectedImportantMemories = Array.isArray(actor.selectedImportantMemories)
            ? actor.selectedImportantMemories
            : [];
        actors.push({ actor, actorId, groupLabel, important });
    };

    if (Array.isArray(baseContext.npcs)) {
        baseContext.npcs.forEach(npc => registerActor(npc, 'npc'));
    }
    if (Array.isArray(baseContext.party)) {
        baseContext.party.forEach(member => registerActor(member, 'party'));
    }

    const pendingActors = [];

    for (const entry of actors) {
        const { actor, actorId, important } = entry;
        if (!important.length) {
            actor.selectedImportantMemories = [];
            continue;
        }

        const signature = `${actorId}::${important.join('||')}`;
        const cached = baseContextMemoryCache.selections.get(actorId);

        if (cached && cached.signature === signature && cached.fromFallback !== true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
            continue;
        }

        if (cached && cached.signature === signature && cached.fromFallback === true) {
            actor.selectedImportantMemories = cloneSelectedEntries(cached.selected);
        }

        if (important.length <= maxMemories) {
            const selected = createSelectedEntries(important.map((_, index) => index), important);
            actor.selectedImportantMemories = selected;
            baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(selected), fromFallback: false });
            continue;
        }

        pendingActors.push({ actor, actorId, important, signature });
    }

    if (!pendingActors.length) {
        baseContext.maxMemoriesToRecall = maxMemories;
        return;
    }

    const canCallAi = Boolean(config?.ai?.endpoint && config.ai.apiKey && config.ai.model);
    let selectionsByName = new Map();

    if (canCallAi) {
        let textToCheck = baseContext.gameHistory || '';

        baseContext.gameHistory = textToCheck;
        const templatePayload = {
            npcs: pendingActors.map(({ actor, important }) => ({
                name: actor.name || actor.id || 'Unknown NPC',
                memories: important
            })),
            textToCheck: baseContext.gameHistory || '',
            max_memories_to_recall: maxMemories
        };

        let parsedTemplate = null;
        try {
            const renderedTemplate = promptEnv.render('choose_important_memories.njk', templatePayload);
            parsedTemplate = parseXMLTemplate(renderedTemplate);
        } catch (error) {
            console.warn('Failed to prepare choose_important_memories prompt:', error.message);
        }

        if (parsedTemplate?.systemPrompt && parsedTemplate?.generationPrompt) {
            try {
                const messages = [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ];

                const requestStart = Date.now();
                const responseText = await LLMClient.chatCompletion({
                    messages,
                    metadataLabel: 'choose_important_memories'
                });

                selectionsByName = parseChooseImportantMemoriesResponse(responseText, maxMemories);

                const promptForLog = [
                    '--- SYSTEM PROMPT ---',
                    parsedTemplate.systemPrompt || '(none)',
                    '',
                    '--- GENERATION PROMPT ---',
                    parsedTemplate.generationPrompt || '(none)'
                ].join('\n');
                logChooseImportantMemories({
                    prompt: promptForLog,
                    responseText,
                    durationSeconds: (Date.now() - requestStart) / 1000
                });
            } catch (error) {
                console.warn('choose_important_memories request failed:', error.message);
            }
        }
    } else {
        console.warn('Skipping choose_important_memories prompt: AI configuration incomplete.');
    }

    for (const entry of pendingActors) {
        const { actor, actorId, important, signature } = entry;
        const normalizedName = (actor.name || actor.id || '').trim().toLowerCase();
        const selectedIndices = selectionsByName.get(normalizedName) || [];

        let indicesToUse = selectedIndices.slice(0, maxMemories);
        if (!indicesToUse.length) {
            const fallback = [];
            for (let i = 0; i < Math.min(maxMemories, important.length); i += 1) {
                fallback.push(i);
            }
            indicesToUse = fallback;
        }

        const selected = createSelectedEntries(indicesToUse, important);
        actor.selectedImportantMemories = selected;
        baseContextMemoryCache.selections.set(actorId, { signature, selected: cloneSelectedEntries(selected), fromFallback: false });
    }

    baseContext.maxMemoriesToRecall = maxMemories;
}

async function prepareBasePromptContext(options = {}) {
    const baseContext = buildBasePromptContext(options);
    await populateNpcSelectedMemories(baseContext);
    return baseContext;
}

function parsePlausibilityOutcome(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return null;
    }

    try {
        const trimmed = xmlSnippet.trim();
        const match = trimmed.match(/<plausibility[\s\S]*?<\/plausibility>/i);
        const targetXml = match ? match[0] : `<wrapper>${trimmed}</wrapper>`;

        const doc = Utils.parseXmlDocument(targetXml, 'text/xml');

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
            const collectCircumstanceModifiers = (parentNode) => {
                if (!parentNode || typeof parentNode.getElementsByTagName !== 'function') {
                    return [];
                }

                const modifierNodes = Array.from(parentNode.getElementsByTagName('circumstanceModifier') || []);
                const modifiers = [];

                for (const modifierNode of modifierNodes) {
                    if (!modifierNode || typeof modifierNode.getElementsByTagName !== 'function') {
                        continue;
                    }

                    const amountNode = modifierNode.getElementsByTagName('amount')?.[0] || null;
                    const reasonNode = modifierNode.getElementsByTagName('reason')?.[0] || null;

                    const amountText = amountNode && typeof amountNode.textContent === 'string'
                        ? amountNode.textContent.trim()
                        : null;
                    const reasonText = reasonNode && typeof reasonNode.textContent === 'string'
                        ? reasonNode.textContent.trim()
                        : null;

                    const amount = amountText !== null && amountText !== '' ? Number(amountText) : null;
                    const hasReason = reasonText && reasonText.toLowerCase() !== 'n/a';

                    if (!Number.isFinite(amount) && !hasReason) {
                        continue;
                    }

                    modifiers.push({
                        amount: Number.isFinite(amount) ? amount : 0,
                        reason: hasReason ? reasonText : null
                    });
                }

                return modifiers;
            };

            const parsedModifiers = collectCircumstanceModifiers(skillCheckNode);
            const circumstanceModifierRaw = getText(skillCheckNode, 'circumstanceModifier');
            const legacyCircumstanceModifier = circumstanceModifierRaw !== null ? Number(circumstanceModifierRaw) : null;
            const circumstanceModifierReason = getText(skillCheckNode, 'circumstanceModifierReason');

            if (skill || attribute || difficulty || skillReason) {
                skillCheck = {
                    skill: skill && skill.toLowerCase() !== 'n/a' ? skill : null,
                    attribute: attribute && attribute.toLowerCase() !== 'n/a' ? attribute : null,
                    difficulty: difficulty && difficulty.toLowerCase() !== 'n/a' ? difficulty : null,
                    reason: skillReason
                };

                if (parsedModifiers.length) {
                    skillCheck.circumstanceModifiers = parsedModifiers;
                    const totalModifier = parsedModifiers.reduce((sum, entry) => {
                        return sum + (Number.isFinite(entry?.amount) ? entry.amount : 0);
                    }, 0);
                    skillCheck.circumstanceModifier = totalModifier;

                    const combinedReasons = parsedModifiers
                        .map(entry => (entry && entry.reason && entry.reason.toLowerCase() !== 'n/a') ? entry.reason : null)
                        .filter(Boolean);
                    if (combinedReasons.length) {
                        skillCheck.circumstanceModifierReason = combinedReasons.join('; ');
                    }
                } else {
                    if (Number.isFinite(legacyCircumstanceModifier)) {
                        skillCheck.circumstanceModifier = legacyCircumstanceModifier;
                        skillCheck.circumstanceModifiers = [{
                            amount: legacyCircumstanceModifier,
                            reason: circumstanceModifierReason && circumstanceModifierReason.toLowerCase() !== 'n/a'
                                ? circumstanceModifierReason
                                : null
                        }];
                    }

                    if (circumstanceModifierReason && circumstanceModifierReason.toLowerCase() !== 'n/a') {
                        skillCheck.circumstanceModifierReason = circumstanceModifierReason;
                    }
                }
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
        return { label: 'critical success', degree: 'critical_success', success: true };
    }
    if (margin >= 6) {
        return { label: 'major success', degree: 'major_success', success: true };
    }
    if (margin >= 3) {
        return { label: 'success', degree: 'success', success: true };
    }
    if (margin >= 0) {
        return { label: 'barely succeeded', degree: 'barely_succeeded', success: true };
    }
    if (margin <= -10) {
        return { label: 'critical failure', degree: 'critical_failure', success: false };
    }
    if (margin <= -6) {
        return { label: 'major failure', degree: 'major_failure', success: false };
    }
    if (margin <= -3) {
        return { label: 'minor failure', degree: 'minor_failure', success: false };
    }
    return { label: 'barely failed', degree: 'barely_failed', success: false };
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
            success: true,
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
            label: 'failure - implausible',
            degree: 'implausible_failure',
            success: false,
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
    const circumstanceModifiers = Array.isArray(skillCheck.circumstanceModifiers)
        ? skillCheck.circumstanceModifiers.map(entry => ({
            amount: Number.isFinite(entry?.amount) ? entry.amount : 0,
            reason: entry && entry.reason && entry.reason.toLowerCase() !== 'n/a'
                ? entry.reason
                : null
        }))
        : [];

    const legacyCircumstanceValueRaw = Number(skillCheck.circumstanceModifier);
    const legacyCircumstanceValue = Number.isFinite(legacyCircumstanceValueRaw) ? legacyCircumstanceValueRaw : 0;

    const summedCircumstanceValue = circumstanceModifiers.reduce((sum, entry) => {
        return sum + (Number.isFinite(entry.amount) ? entry.amount : 0);
    }, 0);

    const circumstanceModifier = circumstanceModifiers.length ? summedCircumstanceValue : legacyCircumstanceValue;

    const circumstanceModifierReasonRaw = typeof skillCheck.circumstanceModifierReason === 'string'
        ? skillCheck.circumstanceModifierReason.trim()
        : null;
    const combinedCircumstanceReason = circumstanceModifiers
        .map(entry => entry.reason && entry.reason.toLowerCase() !== 'n/a' ? entry.reason : null)
        .filter(Boolean);
    const circumstanceModifierReason = combinedCircumstanceReason.length
        ? combinedCircumstanceReason.join('; ')
        : (circumstanceModifierReasonRaw && circumstanceModifierReasonRaw.toLowerCase() !== 'n/a'
            ? circumstanceModifierReasonRaw
            : null);

    const dc = difficultyToDC(resolvedDifficulty);
    if (!dc) {
        return {
            label: 'success',
            degree: 'success',
            success: true,
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
    const total = dieRoll + skillValue + attributeBonus + circumstanceModifier;
    const margin = total - dc;
    const outcome = classifyOutcomeMargin(margin);

    console.log(`🎲 Skill check result: d20(${dieRoll}) + skill(${skillValue}) + attribute(${attributeBonus}) + circumstances(${circumstanceModifier}) = ${total} vs DC ${dc} (${resolvedDifficulty || 'Unknown'}). Outcome: ${outcome.label}`);

    return {
        label: outcome.label,
        degree: outcome.degree,
        success: outcome.success,
        type: type,
        reason: plausibility.reason || skillCheck.reason || null,
        roll: {
            die: dieRoll,
            detail: rollResult.detail,
            skillValue,
            attributeBonus,
            circumstanceModifier,
            circumstanceModifiers,
            circumstanceReason: circumstanceModifierReason,
            total
        },
        difficulty: {
            label: resolvedDifficulty,
            dc
        },
        skill: skillValueInfo.key,
        attribute: attributeKey,
        margin,
        circumstanceModifier,
        circumstanceModifiers,
        circumstanceReason: circumstanceModifierReason
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

        const baseContext = await prepareBasePromptContext({ locationOverride: location });

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

        const requestStart = Date.now();
        const plausibilityResponse = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'plausibility_check'
        });

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
    if (OPPOSITE_DIRECTION_MAP[normalized]) {
        return OPPOSITE_DIRECTION_MAP[normalized];
    }

    if (normalized.startsWith('return_')) {
        const original = normalized.slice('return_'.length);
        return original || null;
    }

    if (/^[a-z0-9_]+$/.test(normalized)) {
        return `return_${normalized}`;
    }

    return null;
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

function ensureExitConnection(fromLocation, toLocation, { description, bidirectional = false, destinationRegion, isVehicle = undefined, vehicleType = undefined } = {}) {
    if (!fromLocation || !toLocation) {
        console.log('🧭 ensureExitConnection aborted: missing from/to location');
        console.trace();
        return null;
    }

    const fromLabel = `${fromLocation.name || fromLocation.id || 'unknown'} (${fromLocation.id || 'no-id'})`;
    const toLabel = `${toLocation.name || toLocation.id || 'unknown'} (${toLocation.id || 'no-id'})`;

    if (fromLocation.id && toLocation.id && fromLocation.id === toLocation.id) {
        const error = new Error(`Refusing to create self-referential exit for ${fromLabel}.`);
        console.warn(`[ensureExitConnection] ${error.message}`);
        console.debug([error]);
        throw error;
    }

    //console.log(`🧭 ensureExitConnection: ${fromLabel} -> ${toLabel} | requested bidirectional=${Boolean(bidirectional)} isVehicle=${isVehicle === undefined ? 'keep' : Boolean(isVehicle)} vehicleType=${vehicleType === undefined ? 'keep' : (vehicleType || 'null')} destinationRegion=${destinationRegion || 'null'}`);
    //console.trace();

    if (destinationRegion !== undefined && destinationRegion !== null && typeof destinationRegion !== 'string') {
        throw new Error('[ensureExitConnection] destinationRegion must be a string, null, or undefined.');
    }

    const normalizedDestinationRegion = destinationRegion !== undefined
        ? (typeof destinationRegion === 'string'
            ? (destinationRegion.trim() || null)
            : null)
        : undefined;

    const { getAvailableDirections, getExit, addExit } = fromLocation || {};

    let directionKey = null;
    if (typeof getAvailableDirections === 'function' && typeof getExit === 'function') {
        directionKey = getAvailableDirections.call(fromLocation).find(dir => {
            const candidate = getExit.call(fromLocation, dir);
            return candidate && candidate.destination === toLocation.id;
        }) || null;
    }

    if (!directionKey) {
        const baseKey = directionKeyFromName(toLocation.name || toLocation.id) || `path_${randomIntInclusive(100, 999)}`;
        directionKey = baseKey;
        if (typeof getExit === 'function') {
            let attempt = directionKey;
            let suffix = 2;
            while (getExit.call(fromLocation, attempt)) {
                attempt = `${directionKey}_${suffix++}`;
            }
            directionKey = attempt;
        }
    }

    let exit = typeof getExit === 'function' ? getExit.call(fromLocation, directionKey) : null;

    if (!exit && typeof getAvailableDirections === 'function' && typeof getExit === 'function') {
        // Double-check for any existing exit pointing to the target by iterating again in case the computed key conflicts.
        const existingKey = getAvailableDirections.call(fromLocation).find(dir => {
            const candidate = getExit.call(fromLocation, dir);
            return candidate && candidate.destination === toLocation.id;
        });
        if (existingKey) {
            directionKey = existingKey;
            exit = getExit.call(fromLocation, directionKey);
        }
    }

    if (!exit) {
        const exitDescription = description || `${toLocation.name || 'an unknown location'}`;
        exit = new LocationExit({
            description: exitDescription,
            destination: toLocation.id,
            destinationRegion: normalizedDestinationRegion !== undefined ? normalizedDestinationRegion : null,
            bidirectional: Boolean(bidirectional),
            isVehicle: typeof isVehicle === 'boolean' ? isVehicle : false,
            vehicleType: vehicleType !== undefined ? vehicleType : null
        });

        if (typeof addExit === 'function') {
            addExit.call(fromLocation, directionKey, exit);
        }
        gameLocationExits.set(exit.id, exit);
        console.log(`  ↳ created new exit ${exit.id} on direction "${directionKey}" (bidirectional=${exit.bidirectional})`);
    } else {
        if (description) {
            try {
                exit.description = description;
            } catch (_) {
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
        console.log(`  ↳ reusing existing exit ${exit.id} on direction "${directionKey}"`);
    }

    if (isVehicle !== undefined) {
        exit.isVehicle = Boolean(isVehicle);
    }

    if (vehicleType !== undefined) {
        exit.vehicleType = vehicleType;
    }

    const resolvedIsVehicle = isVehicle !== undefined ? Boolean(isVehicle) : Boolean(exit?.isVehicle);
    const resolvedVehicleType = vehicleType !== undefined
        ? (vehicleType || null)
        : (exit?.vehicleType || null);

    console.log(`  ↳ final exit state: id=${exit.id} isVehicle=${exit.isVehicle} vehicleType=${exit.vehicleType || 'null'} bidirectional=${exit.bidirectional} direction="${directionKey}" destinationRegion=${exit.destinationRegion || 'null'}`);

    if (bidirectional) {
        let reverseDestinationRegion = null;
        const reverseRegion = findRegionByLocationId(fromLocation.id);
        if (reverseRegion) {
            reverseDestinationRegion = reverseRegion.id;
        } else if (fromLocation.stubMetadata?.regionId) {
            reverseDestinationRegion = fromLocation.stubMetadata.regionId;
        }

        console.log(`  ↳ ensuring reverse connection ${toLabel} -> ${fromLabel} (destinationRegion=${reverseDestinationRegion || 'null'})`);
        ensureExitConnection(
            toLocation,
            fromLocation,
            {
                description: `Path back to ${fromLocation.name || fromLocation.id}`,
                bidirectional: false,
                destinationRegion: reverseDestinationRegion,
                isVehicle: resolvedIsVehicle,
                vehicleType: resolvedVehicleType
            }
        );
    }

    return exit;
}

async function createLocationFromEvent({ name, originLocation = null, descriptionHint = null, directionHint = null, expandStub = true, targetRegionId = null, vehicleType = null, isVehicle = false } = {}) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
        return null;
    }

    const normalizedVehicleType = typeof vehicleType === 'string' ? vehicleType.trim() : '';
    const resolvedVehicleType = normalizedVehicleType ? normalizedVehicleType : null;
    const resolvedIsVehicle = isVehicle === true || Boolean(resolvedVehicleType);

    const originRegion = originLocation ? findRegionByLocationId(originLocation.id) : null;
    const targetRegion = targetRegionId ? regions.get(targetRegionId) || null : null;
    const pendingTargetRegion = (!targetRegion && targetRegionId) ? pendingRegionStubs.get(targetRegionId) || null : null;
    const effectiveRegion = targetRegion || originRegion;
    const effectiveRegionId = targetRegion?.id
        || pendingTargetRegion?.id
        || originRegion?.id
        || originLocation?.stubMetadata?.regionId
        || null;
    const effectiveRegionName = targetRegion?.name
        || pendingTargetRegion?.name
        || originRegion?.name
        || originLocation?.stubMetadata?.regionName
        || null;

    if (!effectiveRegionId) {
        throw new Error('Unable to determine region for new location.');
    }

    let existing = findLocationByNameLoose(trimmedName);
    if (existing) {
        if (originLocation && directionHint) {
            ensureExitConnection(originLocation, existing, {
                description: descriptionHint || `${existing.name || trimmedName}`,
                bidirectional: false
            });
        }

        if (effectiveRegion && typeof effectiveRegion.addLocationId === 'function') {
            effectiveRegion.addLocationId(existing.id);
        }
        return existing;
    }

    const settingSnapshot = getActiveSettingSnapshot();
    const normalizedDirectionHint = normalizeDirection(directionHint);
    const resolvedDirection = normalizedDirectionHint || directionKeyFromName(trimmedName);

    const stub = new Location({
        name: trimmedName,
        description: null,
        regionId: effectiveRegionId,
        isStub: true,
        stubMetadata: {
            originLocationId: originLocation?.id || null,
            originDirection: resolvedDirection,
            shortDescription: descriptionHint || `An unexplored area referred to as ${trimmedName}.`,
            locationPurpose: 'Area referenced during event-driven travel.',
            settingDescription: describeSettingForPrompt(settingSnapshot),
            regionId: effectiveRegionId,
            regionName: effectiveRegionName,
            allowRename: false,
            vehicleType: resolvedVehicleType,
            isVehicle: resolvedIsVehicle
        },
        checkRegionId: !pendingTargetRegion
    });

    gameLocations.set(stub.id, stub);

    try {
        await ensureLocationNameAllowed(stub);
    } catch (error) {
        console.warn(`Failed to ensure location name for event-created stub ${stub.id}:`, error.message);
    }

    if (originLocation) {
        const destinationRegionForExit = effectiveRegionId && originRegion?.id !== effectiveRegionId
            ? effectiveRegionId
            : null;
        const exitOptions = {
            description: descriptionHint || `${stub.name || trimmedName}`,
            bidirectional: false,
            destinationRegion: destinationRegionForExit
        };

        if (resolvedIsVehicle) {
            exitOptions.isVehicle = true;
            exitOptions.vehicleType = resolvedVehicleType;
        }

        ensureExitConnection(originLocation, stub, exitOptions);
    }

    if (effectiveRegion && typeof effectiveRegion.addLocationId === 'function') {
        effectiveRegion.addLocationId(stub.id);
    } else if (pendingTargetRegion) {
        if (!Array.isArray(pendingTargetRegion.locationIds)) {
            pendingTargetRegion.locationIds = [];
        }
        if (!pendingTargetRegion.locationIds.includes(stub.id)) {
            pendingTargetRegion.locationIds.push(stub.id);
        }
    } else if (originLocation?.stubMetadata?.regionId) {
        const fallbackRegion = regions.get(originLocation.stubMetadata.regionId);
        if (fallbackRegion && typeof fallbackRegion.addLocationId === 'function') {
            fallbackRegion.addLocationId(stub.id);
        }
    }

    if (expandStub) {
        try {
            const expansion = await scheduleStubExpansion(stub);
            if (expansion?.location) {
                return expansion.location;
            }
        } catch (error) {
            console.warn(`Failed to expand event-created stub "${stub.name}":`, error.message);
        }
    }

    return stub;
}

async function createRegionStubFromEvent({ name, originLocation = null, description = null, parentRegionId = null, vehicleType = null, isVehicle = false } = {}) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName || !originLocation) {
        return null;
    }

    const normalizedTargetName = trimmedName.toLowerCase();

    const normalizedVehicleType = typeof vehicleType === 'string' ? vehicleType.trim() : '';
    const resolvedVehicleType = normalizedVehicleType ? normalizedVehicleType : null;
    const resolvedIsVehicle = isVehicle === true || Boolean(resolvedVehicleType);

    const ensureExistingConnection = (targetLocation, destinationRegionId) => {
        if (!targetLocation) {
            return null;
        }

        const exitOptions = {
            description: description || `${targetLocation.name || trimmedName}`,
            bidirectional: true,
            destinationRegion: destinationRegionId || null
        };

        if (resolvedIsVehicle) {
            exitOptions.isVehicle = true;
            exitOptions.vehicleType = resolvedVehicleType;
        }

        return ensureExitConnection(originLocation, targetLocation, exitOptions);
    };

    const existingRegion = findRegionByNameLoose(trimmedName);
    if (existingRegion) {
        const entranceLocationId = existingRegion.entranceLocationId
            || (existingRegion.locationIds || []).find(id => gameLocations.get(id));
        const entranceLocation = entranceLocationId ? gameLocations.get(entranceLocationId) : null;

        if (!entranceLocation) {
            console.warn(`Region "${trimmedName}" exists but no entrance location was found.`);
            return null;
        }

        ensureExistingConnection(entranceLocation, existingRegion.id);
        return entranceLocation;
    }

    for (const pending of pendingRegionStubs.values()) {
        const pendingNameSource = pending ? (pending.originalName || pending.name) : null;
        if (!pendingNameSource) {
            continue;
        }
        if (pendingNameSource.trim().toLowerCase() !== normalizedTargetName) {
            continue;
        }

        const existingStub = pending.entranceStubId ? gameLocations.get(pending.entranceStubId) : null;
        if (existingStub) {
            ensureExistingConnection(existingStub, pending.id || null);
            return existingStub;
        }
    }

    const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : null);

    const matchesExistingEntryStub = (location) => {
        if (!location || typeof location !== 'object') {
            return false;
        }

        if (typeof location.isStub === 'boolean' && !location.isStub) {
            return false;
        }

        try {
            if (!location.isStub) {
                return false;
            }
        } catch (_) {
            return false;
        }

        const metadata = location.stubMetadata || {};
        if (metadata.isRegionEntryStub === false) {
            return false;
        }

        const candidateNames = [
            location.name,
            metadata.targetRegionName,
            metadata.originalName,
            metadata.regionName,
            metadata.shortDescription
        ].map(normalizeName).filter(Boolean);

        return candidateNames.includes(normalizedTargetName);
    };

    const findExistingEntryStub = () => {
        if (typeof Location.findByName === 'function') {
            try {
                const exactMatch = Location.findByName(trimmedName);
                if (matchesExistingEntryStub(exactMatch)) {
                    return exactMatch;
                }
            } catch (_) {
                // Ignore errors from Location.findByName and continue searching.
            }
        }

        for (const candidate of gameLocations.values()) {
            if (matchesExistingEntryStub(candidate)) {
                return candidate;
            }
        }

        return null;
    };

    const existingEntryStub = findExistingEntryStub();
    if (existingEntryStub) {
        const metadata = existingEntryStub.stubMetadata || {};
        const destinationRegionId = metadata.targetRegionId || metadata.regionId || null;
        ensureExistingConnection(existingEntryStub, destinationRegionId);
        return existingEntryStub;
    }

    const exits = typeof originLocation.getAvailableDirections === 'function'
        ? originLocation.getAvailableDirections()
        : [];

    const hasExistingMatchingExit = exits.some(direction => {
        const exit = originLocation.getExit(direction);
        if (!exit) {
            return false;
        }

        if (exit.destinationRegion) {
            const pending = pendingRegionStubs.get(exit.destinationRegion);
            const pendingName = pending ? (pending.originalName || pending.name) : null;
            if (pendingName && pendingName.trim().toLowerCase() === normalizedTargetName) {
                return true;
            }
            const destinationRegion = regions.get(exit.destinationRegion);
            if (destinationRegion?.name?.trim().toLowerCase() === normalizedTargetName) {
                return true;
            }
        }

        const destinationLocation = gameLocations.get(exit.destination);
        const stubTargetName = destinationLocation?.stubMetadata?.targetRegionName?.trim().toLowerCase() || null;
        return Boolean(stubTargetName && stubTargetName === normalizedTargetName);
    });

    if (hasExistingMatchingExit) {
        return null;
    }

    const newRegionId = generateRegionStubId();
    const descriptionText = description || `An unexplored region known as ${trimmedName}.`;
    const currentRegion = findRegionByLocationId(originLocation.id) || null;
    const settingSnapshot = getActiveSettingSnapshot();
    const settingDescription = describeSettingForPrompt(settingSnapshot);

    let directionKey = directionKeyFromName(trimmedName, `to_${newRegionId}`);
    if (!directionKey) {
        directionKey = `to_${newRegionId}`;
    }

    let stubName = trimmedName;
    if (typeof Location.findByName === 'function') {
        let suffix = 2;
        let candidate = stubName;
        while (Location.findByName(candidate)) {
            candidate = `${stubName} ${suffix++}`;
        }
        stubName = candidate;
    }

    const stubMetadata = {
        originLocationId: originLocation.id,
        originRegionId: currentRegion?.id || null,
        originDirection: directionKey,
        regionId: newRegionId,
        shortDescription: descriptionText,
        locationPurpose: `Entrance to ${trimmedName}`,
        allowRename: false,
        isRegionEntryStub: true,
        targetRegionId: newRegionId,
        targetRegionName: trimmedName,
        targetRegionDescription: descriptionText,
        targetRegionParentId: parentRegionId || null,
        targetRegionRelationship: 'Adjacent',
        targetRegionRelativeLevel: 0,
        settingDescription,
        vehicleType: resolvedVehicleType,
        isVehicle: resolvedIsVehicle
    };

    if (currentRegion && Number.isFinite(currentRegion.averageLevel)) {
        stubMetadata.regionAverageLevel = currentRegion.averageLevel;
    }

    const regionEntryStub = new Location({
        name: stubName,
        description: null,
        regionId: newRegionId,
        checkRegionId: false,
        isStub: true,
        stubMetadata
    });

    gameLocations.set(regionEntryStub.id, regionEntryStub);

    try {
        await ensureLocationNameAllowed(regionEntryStub);
    } catch (error) {
        console.warn(`Failed to ensure location name for region stub ${regionEntryStub.id}:`, error.message);
    }

    const exitOptions = {
        description: description || `${regionEntryStub.name || trimmedName}`,
        bidirectional: false,
        destinationRegion: newRegionId
    };

    if (resolvedIsVehicle) {
        exitOptions.isVehicle = true;
        exitOptions.vehicleType = resolvedVehicleType;
    }

    ensureExitConnection(originLocation, regionEntryStub, exitOptions);

    let resolvedOriginDirection = directionKey;
    if (typeof originLocation.getAvailableDirections === 'function'
        && typeof originLocation.getExit === 'function') {
        const directions = originLocation.getAvailableDirections();
        const matchedDirection = directions.find(dir => {
            const exit = originLocation.getExit(dir);
            return exit && exit.destination === regionEntryStub.id;
        });
        if (matchedDirection) {
            resolvedOriginDirection = matchedDirection;
        }
    }

    if (resolvedOriginDirection && resolvedOriginDirection !== directionKey) {
        stubMetadata.originDirection = resolvedOriginDirection;
    }

    pendingRegionStubs.set(newRegionId, {
        id: newRegionId,
        name: regionEntryStub.name || trimmedName,
        originalName: trimmedName,
        description: regionEntryStub.stubMetadata?.targetRegionDescription || descriptionText,
        relationship: 'Adjacent',
        relativeLevel: 0,
        parentRegionId: parentRegionId || null,
        sourceRegionId: currentRegion?.id || null,
        exitLocationId: originLocation.id,
        entranceStubId: regionEntryStub.id,
        originDirection: stubMetadata.originDirection,
        createdAt: new Date().toISOString()
    });

    console.log(`🌐 Created region stub "${regionEntryStub.name}" (${newRegionId}) from event at ${originLocation.name || originLocation.id}.`);

    return regionEntryStub;
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

async function createStubNeighbors(location, context = {}) {
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
            regionId: location.stubMetadata?.regionId || null,
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
        try {
            await ensureLocationNameAllowed(stub);
        } catch (error) {
            console.warn(`Failed to ensure location name for stub neighbor ${stub.id}:`, error.message);
        }
        const exitDescription = `Unexplored path leading ${direction} toward ${stub.name}`;
        ensureExitConnection(location, stub, { description: exitDescription, bidirectional: false });

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
const regionEntryExpansionPromises = new Map();

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

function extractRegionCharacterConcepts(stubResponse) {
    // Find the strings inside <concept> tags inside <characterConcepts>. 

    const concepts = [];
    if (!stubResponse || typeof stubResponse !== 'string') {
        return concepts;
    }

    const xmlDoc = Utils.parseXmlDocument(stubResponse, 'text/xml');
    const characterConcepts = xmlDoc.getElementsByTagName("characterConcepts");
    if (characterConcepts.length > 0) {
        const conceptElements = characterConcepts[0].getElementsByTagName("concept");
        for (let i = 0; i < conceptElements.length; i++) {
            concepts.push(conceptElements[i].textContent.trim());
        }
    }

    return concepts;
}

function extractRegionSecrets(stubResponse) {
    // Find the strings inside <secret> tags inside <regionSecrets>.
    const secrets = [];
    if (!stubResponse || typeof stubResponse !== 'string') {
        return secrets;
    }

    const xmlDoc = Utils.parseXmlDocument(stubResponse, 'text/xml');
    const regionSecrets = xmlDoc.getElementsByTagName("secrets");
    if (regionSecrets.length > 0) {
        const secretElements = regionSecrets[0].getElementsByTagName("secret");
        for (let i = 0; i < secretElements.length; i++) {
            secrets.push(secretElements[i].textContent.trim());
        }
    }

    return secrets;
}

async function expandRegionEntryStub(stubLocation) {
    if (!stubLocation || !stubLocation.isStub) {
        return null;
    }

    if (regionEntryExpansionPromises.has(stubLocation.id)) {
        return regionEntryExpansionPromises.get(stubLocation.id);
    }

    const expansionPromise = (async () => {
        const metadata = stubLocation.stubMetadata || {};
        const targetRegionId = metadata.targetRegionId || null;
        if (!targetRegionId) {
            return null;
        }

        const settingDescription = metadata.settingDescription || describeSettingForPrompt(getActiveSettingSnapshot());
        const themeHint = metadata.themeHint || null;
        let regionAverageLevel = null;

        let region = regions.get(targetRegionId) || null;
        const pendingInfo = pendingRegionStubs.get(targetRegionId) || null;
        //console.log("Pending region info for expansion:", pendingInfo);
        const pendingRelativeLevel = Number.isFinite(pendingInfo?.relativeLevel)
            ? pendingInfo.relativeLevel
            : null;
        const metadataRelativeLevel = Number.isFinite(metadata.targetRegionRelativeLevel)
            ? metadata.targetRegionRelativeLevel
            : (Number.isFinite(metadata.relativeLevel) ? metadata.relativeLevel : null);
        const combinedRelativeLevel = pendingRelativeLevel !== null ? pendingRelativeLevel : metadataRelativeLevel;

        const resolveEntranceLocation = (targetRegion) => {
            if (!targetRegion) {
                return null;
            }
            const entranceLocationId = targetRegion.entranceLocationId || null;
            let entranceLocation = entranceLocationId ? gameLocations.get(entranceLocationId) : null;
            if (!entranceLocation && Array.isArray(targetRegion.locationIds)) {
                entranceLocation = targetRegion.locationIds
                    .map(id => gameLocations.get(id))
                    .find(Boolean) || null;
            }
            if (entranceLocation) {
                targetRegion.entranceLocationId = entranceLocation.id;
            }
            return entranceLocation || null;
        };

        const targetRegionName = (pendingInfo?.name || metadata.targetRegionName || '').trim();
        let originLocation = metadata.originLocationId ? gameLocations.get(metadata.originLocationId) : null;
        if (targetRegionName) {
            const existingRegionByName = Region.getByName(targetRegionName);
            if (existingRegionByName) {
                metadata.targetRegionId = existingRegionByName.id;
                metadata.targetRegionName = existingRegionByName.name;

                if (!metadata.originLocationId) {
                    const originMatch = Array.from(gameLocations.values()).find(location => {
                        if (!location || typeof location.getAvailableDirections !== 'function') {
                            return false;
                        }
                        return location.getAvailableDirections().some(direction => {
                            const exit = location.getExit(direction);
                            if (!exit || exit.destination !== stubLocation.id) {
                                return false;
                            }
                            metadata.originDirection = metadata.originDirection || direction;
                            return true;
                        });
                    });
                    if (originMatch) {
                        metadata.originLocationId = originMatch.id;
                        originLocation = originMatch;
                    }
                }

                stubLocation.stubMetadata = metadata;

                const entranceLocation = resolveEntranceLocation(existingRegionByName);
                if (entranceLocation) {
                    if (originLocation && typeof originLocation.removeExit === 'function' && typeof originLocation.getAvailableDirections === 'function') {
                        for (const direction of originLocation.getAvailableDirections()) {
                            const exit = originLocation.getExit(direction);
                            if (exit && exit.destination === stubLocation.id) {
                                originLocation.removeExit(direction);
                            }
                        }
                    }

                    await finalizeRegionEntry({
                        stubLocation,
                        entranceLocation,
                        region: existingRegionByName,
                        originDescription: metadata.shortDescription || stubLocation.description || `${existingRegionByName.name}`
                    });

                    if (originLocation) {
                        const originDescription = metadata.shortDescription || stubLocation.description || `${existingRegionByName.name}`;
                        const originVehicleType = typeof metadata.vehicleType === 'string' ? metadata.vehicleType : null;
                        const originIsVehicle = Boolean(metadata.isVehicleExit || originVehicleType);

                        const hasExistingReturn = typeof originLocation.getAvailableDirections === 'function'
                            && originLocation.getAvailableDirections().some(direction => {
                                const exit = originLocation.getExit(direction);
                                return exit && exit.destination === entranceLocation.id;
                            });

                        if (!hasExistingReturn) {
                            ensureExitConnection(originLocation, entranceLocation, {
                                description: originDescription,
                                bidirectional: true,
                                destinationRegion: existingRegionByName.id,
                                isVehicle: originIsVehicle,
                                vehicleType: originVehicleType
                            });
                        }
                    }

                    pendingRegionStubs.delete(targetRegionId);
                    regionEntryExpansionPromises.delete(stubLocation.id);
                    return entranceLocation;
                }
            }
        }

        if (pendingInfo?.parentRegionId && region && !region.parentRegionId) {
            region.parentRegionId = pendingInfo.parentRegionId;
        }

        let stubPrompt = null;
        let stubResponse = null;

        if (!region || !Array.isArray(region.locationIds) || region.locationIds.length === 0) {
            const regionName = pendingInfo?.name || metadata.targetRegionName || 'Uncharted Region';
            const regionDescription = pendingInfo?.description || metadata.targetRegionDescription || 'No description available.';
            const parentRegionId = pendingInfo?.parentRegionId || metadata.targetRegionParentId || null;

            console.log(`🌐 Beginning region stub expansion for ${regionName} (${regionDescription})...`);

            stubPrompt = await renderRegionStubPrompt({
                settingDescription,
                regionNotes: regionDescription,
                region: {
                    name: regionName,
                    regionNotes: regionDescription
                },
                previousRegion: currentPlayer.currentLocation.region
            });

            if (!stubPrompt) {
                return null;
            }

            const messages = [
                { role: 'system', content: stubPrompt.systemPrompt },
                { role: 'user', content: stubPrompt.generationPrompt }
            ];

            try {
                console.log(`🌐 Generating locations for region stub ${regionName} (${targetRegionId})...`);
                const requestStart = Date.now();
                stubResponse = await LLMClient.chatCompletion({
                    messages,
                    metadataLabel: 'region_stub_locations'
                });

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
            const exitDefinitions = parseRegionExitsResponse(stubResponse);
            const characterConcepts = extractRegionCharacterConcepts(stubResponse);
            const secrets = extractRegionSecrets(stubResponse);

            console.log("Character concepts extracted for region NPC generation:", characterConcepts);

            if (!locationDefinitions.length) {
                console.warn('Region stub generation returned no locations.');
                return null;
            }

            if (!Number.isFinite(metadata.regionAverageLevel)) {
                console.log(`ℹ️ Region stub '${pendingInfo?.name || targetRegionId}' missing regionAverageLevel metadata; defaulting to player level ${currentPlayer?.level || 1}.`);
            }

            const baseAverageLevel = Number.isFinite(metadata.regionAverageLevel)
                ? metadata.regionAverageLevel
                : (currentPlayer?.level || 1);

            if (Number.isFinite(combinedRelativeLevel)) {
                regionAverageLevel = clampLevel(baseAverageLevel + combinedRelativeLevel, baseAverageLevel);
                console.log(`📈 Region stub '${pendingInfo?.name || metadata.targetRegionName || targetRegionId}' relative offset ${combinedRelativeLevel} applied: base ${baseAverageLevel} -> ${regionAverageLevel}`);
            } else {
                regionAverageLevel = baseAverageLevel;
                console.log(`📊 Region stub '${pendingInfo?.name || metadata.targetRegionName || targetRegionId}' using base level ${baseAverageLevel} (no relative offset).`);
                console.trace();
            }

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
                    predefinedExitDefinitions: exitDefinitions
                });
            } catch (instantiationError) {
                console.warn('Failed to instantiate region from stub:', instantiationError.message);
                console.debug(instantiationError);
            }

            try {
                await generateRegionNPCs({
                    region,
                    systemPrompt: stubPrompt.systemPrompt,
                    generationPrompt: stubPrompt.generationPrompt,
                    aiResponse: stubResponse,
                    characterConcepts,
                    secrets
                });
            } catch (npcError) {
                console.warn('Failed to generate important NPCs for region stub:', npcError.message);
                console.debug(npcError);
            }

            const entranceInfo = await chooseRegionEntrance({
                region,
                stubMap,
                systemPrompt: stubPrompt.systemPrompt,
                generationPrompt: stubPrompt.generationPrompt,
                aiResponse: stubResponse
            });

            const entranceLocation = entranceInfo.location || (entranceInfo.locationId ? gameLocations.get(entranceInfo.locationId) : null);
            if (!entranceLocation) {
                return null;
            }

            await finalizeRegionEntry({
                stubLocation,
                entranceLocation,
                region,
                originDescription: metadata.shortDescription || stubLocation.description || `${region.name}`
            });

            pendingRegionStubs.delete(targetRegionId);
            return entranceLocation;
        }

        // Region already exists
        const entranceLocation = resolveEntranceLocation(region);

        if (!entranceLocation) {
            return null;
        }

        await finalizeRegionEntry({
            stubLocation,
            entranceLocation,
            region,
            originDescription: metadata.shortDescription || stubLocation.description || `${region.name}`
        });

        pendingRegionStubs.delete(targetRegionId);
        return entranceLocation;
    })();

    regionEntryExpansionPromises.set(stubLocation.id, expansionPromise);

    try {
        return await expansionPromise;
    } finally {
        regionEntryExpansionPromises.delete(stubLocation.id);
    }
}

async function finalizeRegionEntry({ stubLocation, entranceLocation, region, originDescription }) {
    if (!stubLocation || !entranceLocation) {
        return entranceLocation || null;
    }

    const metadata = stubLocation.stubMetadata || {};
    const originLocation = metadata.originLocationId ? gameLocations.get(metadata.originLocationId) : null;
    let originDirection = metadata.originDirection || null;

    if (originLocation) {
        const originVehicleType = typeof metadata.vehicleType === 'string' ? metadata.vehicleType : null;
        const originIsVehicle = Boolean(metadata.isVehicleExit || originVehicleType);

        let existingOriginExit = null;
        if (originDirection && typeof originLocation.getExit === 'function') {
            existingOriginExit = originLocation.getExit(originDirection);
        }

        if (!existingOriginExit && typeof originLocation.getAvailableDirections === 'function') {
            for (const direction of originLocation.getAvailableDirections()) {
                const candidate = originLocation.getExit(direction);
                if (candidate && candidate.destination === stubLocation.id) {
                    existingOriginExit = candidate;
                    originDirection = direction;
                    metadata.originDirection = originDirection;
                    break;
                }
            }
        }

        if (existingOriginExit) {
            try {
                existingOriginExit.destination = entranceLocation.id;
            } catch (_) {
                existingOriginExit.update({ destination: entranceLocation.id });
            }
            try {
                existingOriginExit.description = originDescription;
            } catch (_) {
                existingOriginExit.update({ description: originDescription });
            }
            try {
                existingOriginExit.bidirectional = true;
            } catch (_) {
                existingOriginExit.update({ bidirectional: true });
            }
            existingOriginExit.isVehicle = originIsVehicle;
            existingOriginExit.vehicleType = originVehicleType;
        }

        ensureExitConnection(originLocation, entranceLocation, {
            description: originDescription,
            bidirectional: true,
            destinationRegion: region.id,
            isVehicle: originIsVehicle,
            vehicleType: originVehicleType
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

        const description = exit.description || `${targetLocation.name || exit.destination}`;
        ensureExitConnection(entranceLocation, targetLocation, {
            description,
            bidirectional: exit.bidirectional !== false,
            destinationRegion: exit.destinationRegion || null,
            isVehicle: Boolean(exit.isVehicle),
            vehicleType: exit.vehicleType || null
        });
    }

    for (const direction of stubDirections) {
        const exit = stubLocation.getExit(direction);
        if (exit) {
            gameLocationExits.delete(exit.id);
        }
    }

    const stubThingIds = Array.isArray(stubLocation.thingIds)
        ? [...stubLocation.thingIds]
        : (typeof stubLocation.getThingIds === 'function' ? Array.from(stubLocation.getThingIds()) : []);

    if (stubThingIds.length) {
        const entranceNameFallback = entranceLocation.name
            || entranceLocation.stubMetadata?.shortDescription
            || (region?.name ? `${region.name} Entrance` : entranceLocation.id);

        for (const thingId of stubThingIds) {
            if (!thingId) {
                continue;
            }
            const thing = things.get(thingId) || (typeof Thing.getById === 'function' ? Thing.getById(thingId) : null);
            if (!thing) {
                continue;
            }

            Events.removeThingFromLocation(thing, stubLocation);
            Events.addThingToLocation(thing, entranceLocation);

            const metadata = thing.metadata && typeof thing.metadata === 'object' ? { ...thing.metadata } : {};
            metadata.locationId = entranceLocation.id;
            metadata.locationName = entranceNameFallback;
            delete metadata.ownerId;
            delete metadata.ownerID;
            thing.metadata = metadata;

            if (things instanceof Map) {
                things.set(thing.id, thing);
            }
        }
    }

    const stubNpcIds = Array.isArray(stubLocation.npcIds) ? [...stubLocation.npcIds] : [];
    if (stubNpcIds.length) {
        for (const npcId of stubNpcIds) {
            if (!npcId) {
                continue;
            }
            const npc = players.get(npcId);
            if (npc) {
                try {
                    npc.setLocation(entranceLocation.id);
                } catch (error) {
                    console.warn(`Failed to update NPC ${npcId} location during region entry finalization:`, error.message);
                }
            }
            if (typeof stubLocation.removeNpcId === 'function') {
                stubLocation.removeNpcId(npcId);
            }
            if (typeof entranceLocation.addNpcId === 'function') {
                entranceLocation.addNpcId(npcId);
            }
        }
    }

    gameLocations.delete(stubLocation.id);

    const replacementLocationId = entranceLocation.id;
    if (players && typeof players.values === 'function') {
        for (const player of players.values()) {
            if (!player || player.currentLocation !== stubLocation.id) {
                continue;
            }
            try {
                player.setLocation(replacementLocationId);
            } catch (error) {
                console.warn(`Failed to update player ${player?.id || 'unknown'} during region entry finalization:`, error.message);
            }
        }
    }

    if (currentPlayer && currentPlayer.currentLocation === stubLocation.id) {
        try {
            currentPlayer.setLocation(replacementLocationId);
        } catch (error) {
            console.warn('Failed to update current player location during region entry finalization:', error.message);
        }
    }

    const currentRegionLocationIds = region.locationIds || [];
    if (Array.isArray(currentRegionLocationIds) && currentRegionLocationIds.includes(stubLocation.id)) {
        region.locationIds = currentRegionLocationIds.filter(id => id !== stubLocation.id);
    }

    if (region && typeof region.addLocationId === 'function') {
        region.addLocationId(entranceLocation.id);
    }

    if (Array.isArray(region.locationIds) && !region.locationIds.includes(entranceLocation.id)) {
        region.locationIds.push(entranceLocation.id);
    }

    if (originLocation && typeof originLocation.removeNpcId === 'function') {
        // no-op, placeholder in case stub stored NPCs
    }

    return entranceLocation;
}

const HOST = config.server.host;

// Configure Nunjucks for views
const viewsEnv = nunjucks.configure('views', {
    autoescape: true,
    express: app
});

// Configure Nunjucks for prompts (no autoescape for prompts)
const promptEnv = nunjucks.configure('prompts', {
    autoescape: false,
    dev: true
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

const rarityDefinitions = Thing.getAllRarityDefinitions();
[viewsEnv, promptEnv, imagePromptEnv].forEach(env => {
    if (env && typeof env.addGlobal === 'function') {
        env.addGlobal('rarityDefinitions', rarityDefinitions);
    }
});

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
        if (xmlContent === undefined || xmlContent === null) {
            throw new Error('XML template content is empty');
        }

        if (typeof xmlContent !== 'string') {
            xmlContent = String(xmlContent);
        }

        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

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

// Function to render player portrait prompt from template
function renderPlayerPortraitPrompt(player) {
    try {
        const templateName = getImagePromptTemplateName('character', 'player-portrait.xml.njk');
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

        let characterGear = [];
        if (typeof player.getGear === 'function') {
            try {
                const gearSnapshot = player.getGear();
                if (gearSnapshot && typeof gearSnapshot === 'object') {
                    for (const entry of Object.values(gearSnapshot)) {
                        if (!entry || !entry.item) {
                            continue;
                        }
                        const { item, slotType } = entry;
                        if (!item || typeof item !== 'object') {
                            continue;
                        }
                        const itemName = typeof item.name === 'string' && item.name.trim()
                            ? item.name.trim()
                            : `Equipped Item (${slotType || 'unknown slot'})`;
                        const itemDescription = typeof item.description === 'string' && item.description.trim()
                            ? item.description.trim()
                            : 'No description available.';
                        const slotLabel = typeof item.slot === 'string' && item.slot.trim()
                            ? item.slot.trim()
                            : (slotType || 'unknown');

                        characterGear.push({
                            name: itemName,
                            description: itemDescription,
                            slot: slotLabel
                        });
                    }
                }
            } catch (error) {
                throw new Error(`Failed to load equipped gear for portrait prompt: ${error?.message || error}`);
            }
        }

        const globalsLocation = Globals?.location || null;
        const playerLocationObject = typeof player.currentLocationObject === 'object' && player.currentLocationObject
            ? player.currentLocationObject
            : (player.location || globalsLocation || null);

        const locationPayload = (() => {
            if (!playerLocationObject && !globalsLocation) {
                return {
                    name: 'Unknown Location',
                    description: 'The character\'s current location is unknown.',
                    globalsLocation: null
                };
            }

            const source = playerLocationObject || globalsLocation;
            if (!source) {
                throw new Error('Failed to resolve a location object for the player portrait prompt.');
            }

            const base = {
                name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : (source.id || 'Unknown Location'),
                description: typeof source.description === 'string' && source.description.trim()
                    ? source.description.trim()
                    : 'No location description available.',
                globalsLocation: null
            };

            if (globalsLocation) {
                base.globalsLocation = {
                    id: globalsLocation.id || null,
                    name: typeof globalsLocation.name === 'string' && globalsLocation.name.trim() ? globalsLocation.name.trim() : globalsLocation.id || null,
                    description: typeof globalsLocation.description === 'string' && globalsLocation.description.trim()
                        ? globalsLocation.description.trim()
                        : null
                };
            }

            return base;
        })();

        const variables = {
            setting: settingDescription,
            characterDescription,
            characterClass: player.class || '',
            characterRace: player.race || '',
            additionalInstructions: Globals.config.imagegen?.image_prompt_instructions?.character || '',
            characterGear,
            location: locationPayload
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

async function generateInventoryForCharacter({ character, characterDescriptor = {}, region = null, location = null, timeoutScale = 1, autoEquip = true } = {}) {
    try {
        if (config.omit_item_generation) {
            return [];
        }

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

        timeoutScale = Math.max(1, Number(timeoutScale) || 1);

        const requestStart = Date.now();
        const inventoryContent = await LLMClient.chatCompletion({
            messages,
            timeoutScale,
            metadataLabel: 'inventory_generation'
        });

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

            const scaledAttributeBonuses = scaleAttributeBonusesForItem(
                Array.isArray(item.attributeBonuses) ? item.attributeBonuses : [],
                { level: computedLevel, rarity: item.rarity }
            );

            const bonusSummary = scaledAttributeBonuses.length
                ? scaledAttributeBonuses
                    .map(bonus => {
                        const attr = bonus.attribute || 'Attribute';
                        const value = Number.isFinite(bonus.bonus) ? bonus.bonus : 0;
                        const sign = value >= 0 ? `+${value}` : `${value}`;
                        return `${attr} ${sign}`;
                    })
                    .join(', ')
                : '';
            if (bonusSummary) {
                detailParts.push(`Bonuses: ${bonusSummary}`);
            }

            console.log(
                `[ItemGeneration] Calculated stats for "${item.name}": ownerLevel=${ownerLevel}, relativeLevel=${relativeLevel}, computedLevel=${computedLevel}, rarity=${item.rarity || 'unknown'}, slot=${item.slot || 'none'}, bonuses=${bonusSummary || 'none'}`
            );

            const extendedDescription = [item.description, detailParts.join(' | ')].filter(Boolean).join(' ');

            try {
                const metadata = sanitizeMetadataObject({
                    rarity: item.rarity || null,
                    itemType: item.type || null,
                    value: item.value || null,
                    weight: item.weight || null,
                    properties: item.properties || null,
                    slot: item.slot || null,
                    attributeBonuses: scaledAttributeBonuses.length ? scaledAttributeBonuses : null,
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
                    attributeBonuses: scaledAttributeBonuses,
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
                        //console.log(`🎒 Skipping image generation for item ${thing.name} (${thing.id}) - not in player inventory`);
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

        if (autoEquip) {
            try {
                await equipBestGearForCharacter({
                    character,
                    characterDescriptor,
                    region,
                    location,
                    settingDescription,
                    timeoutScale: timeoutScale
                });
            } catch (equipError) {
                console.warn('Failed to run equip-best flow:', equipError.message);
            }
        }

        if (createdThings.length) {
            try {
                await ensureUniqueThingNames({ things: createdThings, owner: character, location });
            } catch (error) {
                console.warn('Failed to enforce unique thing names for inventory generation:', error.message);
            }
        }

        return createdThings;
    } catch (error) {
        console.warn(`Inventory generation failed for character ${character?.name || 'unknown'}:`, error);
        return [];
    }
}

function restoreCharacterHealthToMaximum(character) {
    if (!character || typeof character.setHealth !== 'function') {
        return;
    }

    const maxHealth = Number(character?.maxHealth);
    if (!Number.isFinite(maxHealth) || maxHealth <= 0) {
        return;
    }

    try {
        character.setHealth(Math.round(maxHealth));
    } catch (error) {
        const characterName = character?.name || character?.id || 'character';
        console.warn(`Failed to restore health for ${characterName}:`, error?.message || error);
    }
}

async function generateItemsByNames({ itemNames = [], location = null, owner = null, region = null, seeds = [] } = {}) {
    const normalized = Array.from(new Set(
        (itemNames || [])
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
    ));

    if (!normalized.length) {
        return [];
    }

    const missing = normalized;

    const normalizeThingSeed = (seed = {}) => {
        if (!seed || typeof seed !== 'object') {
            return null;
        }

        const normalizedSeed = {};

        if (typeof seed.name === 'string') {
            const trimmedName = seed.name.trim();
            if (trimmedName) {
                normalizedSeed.name = trimmedName;
            }
        }

        if (typeof seed.description === 'string') {
            const trimmedDescription = seed.description.trim();
            if (trimmedDescription) {
                normalizedSeed.description = trimmedDescription;
            }
        }

        if (typeof seed.type === 'string') {
            const trimmedType = seed.type.trim();
            if (trimmedType) {
                normalizedSeed.type = trimmedType;
            }
        }

        if (typeof seed.slot === 'string') {
            const trimmedSlot = seed.slot.trim();
            if (trimmedSlot) {
                normalizedSeed.slot = trimmedSlot;
            }
        }

        if (typeof seed.rarity === 'string') {
            const trimmedRarity = seed.rarity.trim();
            if (trimmedRarity) {
                normalizedSeed.rarity = trimmedRarity;
            }
        }

        if (seed.value !== undefined && seed.value !== null && seed.value !== '') {
            const numericValue = Number(seed.value);
            normalizedSeed.value = Number.isFinite(numericValue) ? numericValue : seed.value;
        }

        if (seed.weight !== undefined && seed.weight !== null && seed.weight !== '') {
            const numericWeight = Number(seed.weight);
            normalizedSeed.weight = Number.isFinite(numericWeight) ? numericWeight : seed.weight;
        }

        if (seed.relativeLevel !== undefined && seed.relativeLevel !== null && seed.relativeLevel !== '') {
            const numericRelative = Number(seed.relativeLevel);
            if (Number.isFinite(numericRelative)) {
                const clampedRelative = Math.max(-10, Math.min(10, Math.round(numericRelative)));
                normalizedSeed.relativeLevel = clampedRelative;
            }
        }

        if (typeof seed.itemOrScenery === 'string') {
            const normalizedType = seed.itemOrScenery.trim().toLowerCase();
            normalizedSeed.itemOrScenery = normalizedType === 'scenery' ? 'scenery' : 'item';
        }

        return normalizedSeed;
    };

    const seedLookup = new Map();
    if (Array.isArray(seeds)) {
        seeds.forEach(seed => {
            const normalizedSeed = normalizeThingSeed(seed);
            if (!normalizedSeed || !normalizedSeed.name) {
                return;
            }
            const key = normalizedSeed.name.toLowerCase();
            if (!seedLookup.has(key)) {
                seedLookup.set(key, normalizedSeed);
            }
        });
    }

    let resolvedLocation = location || null;
    if (!resolvedLocation && owner?.currentLocation) {
        try {
            resolvedLocation = Location.get(owner.currentLocation);
        } catch (_) {
            resolvedLocation = null;
        }
    }

    const resolvedRegion = region || (resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null);

    const createFallbackThing = (name) => {
        if (!name) {
            return null;
        }
        try {
            const seed = seedLookup.get(name.toLowerCase()) || {};
            const fallbackType = typeof seed.itemOrScenery === 'string' && seed.itemOrScenery.toLowerCase() === 'scenery'
                ? 'scenery'
                : 'item';
            const thing = new Thing({
                name,
                description: seed.description || `An item called ${name}.`,
                thingType: fallbackType,
                metadata: {}
            });
            things.set(thing.id, thing);
            const fallbackMetadata = thing.metadata || {};
            if (Number.isFinite(seed.relativeLevel)) {
                fallbackMetadata.relativeLevel = seed.relativeLevel;
            }
            if (seed.slot) {
                fallbackMetadata.slot = seed.slot;
                thing.slot = seed.slot;
            }
            if (seed.rarity) {
                thing.rarity = seed.rarity;
            }
            if (seed.type) {
                thing.itemTypeDetail = seed.type;
            }
            if (owner && typeof owner.addInventoryItem === 'function') {
                owner.addInventoryItem(thing);
                fallbackMetadata.ownerId = owner.id;
                delete fallbackMetadata.locationId;
            } else if (resolvedLocation) {
                fallbackMetadata.locationId = resolvedLocation.id;
                delete fallbackMetadata.ownerId;
                if (typeof resolvedLocation.addThingId === 'function') {
                    resolvedLocation.addThingId(thing.id);
                }
            }
            thing.metadata = fallbackMetadata;
            return thing;
        } catch (creationError) {
            console.warn(`Failed to create fallback item for "${name}":`, creationError.message);
            return null;
        }
    };

    try {
        const baseContext = await prepareBasePromptContext({ locationOverride: resolvedLocation });
        const attributeList = (baseContext.attributes && baseContext.attributes.length)
            ? baseContext.attributes
            : Object.keys(attributeDefinitionsForPrompt || {})
                .filter(name => typeof name === 'string' && name.trim())
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const equipmentSlotTypes = (baseContext.equipmentSlots && baseContext.equipmentSlots.length)
            ? baseContext.equipmentSlots
            : getGearSlotTypes();
        const gearSlotNames = (baseContext.gearSlots && baseContext.gearSlots.length)
            ? baseContext.gearSlots
            : getGearSlotNames();

        const promptTemplateBase = {
            ...baseContext,
            promptType: 'thing-generator-single',
            equipmentSlots: equipmentSlotTypes,
            gearSlots: gearSlotNames,
            attributes: attributeList,
            attributeDefinitions: baseContext.attributeDefinitions || attributeDefinitionsForPrompt
        };

        const created = [];

        for (const name of missing) {
            const seed = seedLookup.get(name.toLowerCase()) || {};
            const requestedThingType = typeof seed.itemOrScenery === 'string'
                ? seed.itemOrScenery.trim().toLowerCase()
                : null;

            const thingSeed = {
                ...seed,
                name,
                itemOrScenery: requestedThingType
            };

            const rarityDefinitionForSeed = Thing.getRarityDefinition(thingSeed.rarity);
            if (rarityDefinitionForSeed) {
                thingSeed.rarity = rarityDefinitionForSeed.label;
                thingSeed.rarityDescription = rarityDefinitionForSeed.description || `A ${rarityDefinitionForSeed.label} item.`;
            }

            try {
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...promptTemplateBase,
                    thingSeed
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    throw new Error('Thing generation template missing prompts');
                }

                const messages = [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ];

                const requestStart = Date.now();
                const inventoryContent = await LLMClient.chatCompletion({
                    messages,
                    metadataLabel: 'thing_generation'
                });

                if (!inventoryContent || !inventoryContent.trim()) {
                    throw new Error('Empty item generation response from AI');
                }

                const apiDurationSeconds = (Date.now() - requestStart) / 1000;
                const parsedItems = parseInventoryItems(inventoryContent) || [];
                const itemData = parsedItems.find(it => it?.name) || null;
                if (!itemData) {
                    throw new Error('No item data returned by AI');
                }

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
                if (itemData?.causeStatusEffect) {
                    const effectName = itemData.causeStatusEffect.name || 'Status Effect';
                    const effectDescription = itemData.causeStatusEffect.description || '';
                    const effectCombined = [effectName, effectDescription].filter(Boolean).join(' - ');
                    detailParts.push(`Status Effect: ${effectCombined}`);
                }
                let relativeLevel = null;
                if (Number.isFinite(itemData?.relativeLevel)) {
                    relativeLevel = Math.max(-10, Math.min(10, Math.round(itemData.relativeLevel)));
                } else if (Number.isFinite(seed?.relativeLevel)) {
                    relativeLevel = Math.max(-10, Math.min(10, Math.round(seed.relativeLevel)));
                } else {
                    relativeLevel = 0;
                }
                const baseReference = owner?.level
                    ? owner.level
                    : (resolvedLocation?.baseLevel
                        ? resolvedLocation.baseLevel
                        : (resolvedRegion?.averageLevel || currentPlayer?.level || 1));
                const computedLevel = clampLevel(baseReference + relativeLevel, baseReference);

                const scaledAttributeBonuses = itemData?.itemOrScenery === 'item'
                    ? scaleAttributeBonusesForItem(
                        Array.isArray(itemData?.attributeBonuses) ? itemData.attributeBonuses : [],
                        { level: computedLevel, rarity: itemData?.rarity }
                    )
                    : [];

                const bonusSummary = scaledAttributeBonuses.length
                    ? scaledAttributeBonuses
                        .map(bonus => {
                            const attr = bonus.attribute || 'Attribute';
                            const value = Number.isFinite(bonus.bonus) ? bonus.bonus : 0;
                            const sign = value >= 0 ? `+${value}` : `${value}`;
                            return `${attr} ${sign}`;
                        })
                        .join(', ')
                    : '';
                if (bonusSummary) {
                    detailParts.push(`Bonuses: ${bonusSummary}`);
                }

                if (detailParts.length) {
                    descriptionParts.push(detailParts.join(' | '));
                }
                const composedDescription = descriptionParts.join(' ') || `An item named ${name}.`;

                const metadata = sanitizeMetadataObject({
                    rarity: itemData?.rarity || null,
                    itemType: itemData?.type || null,
                    value: itemData?.value || null,
                    weight: itemData?.weight || null,
                    properties: itemData?.properties || null,
                    slot: itemData?.slot || null,
                    attributeBonuses: scaledAttributeBonuses.length ? scaledAttributeBonuses : null,
                    causeStatusEffect: itemData?.causeStatusEffect || null,
                    relativeLevel,
                    level: computedLevel
                });

                //console.log(itemData);
                //console.log("Itemdata ^^");

                const thing = new Thing({
                    name,
                    description: composedDescription,
                    thingType: itemData?.thingType,
                    rarity: itemData?.rarity,
                    type: itemData?.type,
                    slot: itemData?.slot,
                    attributeBonuses: scaledAttributeBonuses,
                    causeStatusEffect: itemData?.causeStatusEffect,
                    level: computedLevel,
                    relativeLevel,
                    metadata
                });

                const ownerLevelForLog = owner && Number.isFinite(owner?.level)
                    ? owner.level
                    : (resolvedLocation?.baseLevel ?? resolvedRegion?.averageLevel ?? 'n/a');

                console.log(
                    `[ItemGeneration] Calculated stats for "${name}": ownerLevel=${ownerLevelForLog}, relativeLevel=${relativeLevel}, computedLevel=${computedLevel}, rarity=${itemData?.rarity || 'unknown'}, slot=${itemData?.slot || 'none'}, bonuses=${bonusSummary || 'none'}`
                );
                things.set(thing.id, thing);

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

                created.push(thing);

                try {
                    const logDir = path.join(__dirname, 'logs');
                    if (!fs.existsSync(logDir)) {
                        fs.mkdirSync(logDir, { recursive: true });
                    }
                    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
                    const logPath = path.join(logDir, `event_item_${Date.now()}_${safeName}.log`);
                    const logParts = [
                        formatDurationLine(apiDurationSeconds),
                        '=== ITEM GENERATION SYSTEM PROMPT ===',
                        parsedTemplate.systemPrompt,
                        '',
                        '=== ITEM GENERATION PROMPT ===',
                        parsedTemplate.generationPrompt,
                        '',
                        '=== ITEM GENERATION RESPONSE ===',
                        inventoryContent,
                        '',
                        '=== GENERATED ITEM ===',
                        JSON.stringify(thing.toJSON ? thing.toJSON() : { id: thing.id, name: thing.name }, null, 2),
                        ''
                    ];
                    fs.writeFileSync(logPath, logParts.join("\n"), 'utf8');
                } catch (logError) {
                    console.warn('Failed to log item generation:', logError.message);
                }
            } catch (itemError) {
                console.warn(`Failed to generate detailed items from event for "${name}":`, itemError.message);
                const fallbackThing = createFallbackThing(name);
                if (fallbackThing) {
                    created.push(fallbackThing);
                }
            }
        }

        if (created.length) {
            try {
                await ensureUniqueThingNames({ things: created, location: resolvedLocation, owner, region: resolvedRegion });
            } catch (error) {
                console.warn('Failed to enforce unique thing names for generated items:', error.message);
            }
        }

        return created;
    } catch (error) {
        console.warn('Failed to prepare item generation context:', error.message);
        const fallbacks = [];
        for (const name of missing) {
            const fallbackThing = createFallbackThing(name);
            if (fallbackThing) {
                fallbacks.push(fallbackThing);
            }
        }
        if (fallbacks.length) {
            try {
                await ensureUniqueThingNames({ things: fallbacks, location: resolvedLocation, owner, region: resolvedRegion });
            } catch (error) {
                console.warn('Failed to enforce unique thing names for fallback items:', error.message);
            }
        }
        return fallbacks;
    }
}

function buildThingPromptItem(thing) {
    if (!thing || typeof thing !== 'object') {
        throw new Error('buildThingPromptItem requires a valid Thing instance.');
    }

    const metadata = thing.metadata || {};
    const rawSlot = typeof thing.slot === 'string'
        ? thing.slot
        : (typeof metadata.slot === 'string' ? metadata.slot : null);
    const cleanedSlot = rawSlot && rawSlot.trim().toLowerCase() !== 'n/a'
        ? rawSlot.trim()
        : null;

    const normalizeBonuses = entries => (
        Array.isArray(entries)
            ? entries
                .map(entry => {
                    if (!entry) {
                        return null;
                    }
                    if (typeof entry === 'object') {
                        const attribute = typeof entry.attribute === 'string'
                            ? entry.attribute.trim()
                            : (typeof entry.name === 'string' ? entry.name.trim() : '');
                        if (!attribute) {
                            return null;
                        }
                        const parsed = Number(entry.bonus ?? entry.value);
                        return {
                            attribute,
                            bonus: Number.isFinite(parsed) ? parsed : 0
                        };
                    }
                    if (typeof entry === 'string') {
                        const trimmed = entry.trim();
                        if (!trimmed) {
                            return null;
                        }
                        return { attribute: trimmed, bonus: 0 };
                    }
                    return null;
                })
                .filter(Boolean)
            : []
    );

    const itemOrScenery = thing.thingType === 'scenery' ? 'scenery' : 'item';
    const rarity = thing.rarity || metadata.rarity || getDefaultRarityLabel();

    // iterate through attributeBonuses (array of {attribute, bonus}) and set them all to 4 * bonus + Thing.getMaxAttributeBonus(rarity, thing.level)
    const attributeBonuses = normalizeBonuses(
        Array.isArray(thing.attributeBonuses) && thing.attributeBonuses.length
            ? thing.attributeBonuses
            : metadata.attributeBonuses
    ).map(({ attribute, bonus }) => {
        const finalBonus = bonus / roundAwayFromZero(Thing.getMaxAttributeBonus(rarity, thing.level)) * 4;
        return { attribute, bonus: finalBonus };
    });

    return {
        name: thing.name,
        description: thing.description || '',
        itemOrScenery,
        type: thing.itemTypeDetail
            || metadata.itemTypeDetail
            || metadata.itemType
            || (itemOrScenery === 'scenery' ? 'scenery' : 'item'),
        slot: cleanedSlot ? [cleanedSlot] : [],
        rarity,
        value: metadata.value ?? '',
        weight: metadata.weight ?? '',
        relativeLevel: metadata.relativeLevel ?? thing.relativeLevel ?? 0,
        isVehicle: Boolean(metadata.isVehicle),
        attributeBonuses: attributeBonuses,
        causeStatusEffect: thing.causeStatusEffect || metadata.causeStatusEffect || null,
        properties: metadata.properties || ''
    };
}

async function alterThingByPrompt({
    thing,
    changeDescription = '',
    newName = null,
    location = null,
    owner = null
} = {}) {
    if (!thing || typeof thing !== 'object' || typeof thing.name !== 'string') {
        throw new Error('alterThingByPrompt requires a valid Thing instance.');
    }

    const metadata = thing.metadata || {};

    let resolvedOwner = owner || null;
    if (!resolvedOwner && metadata.ownerId) {
        resolvedOwner = players.get(metadata.ownerId) || null;
    }

    let resolvedLocation = location || null;
    if (!resolvedLocation && metadata.locationId) {
        try {
            resolvedLocation = Location.get(metadata.locationId);
        } catch (_) {
            resolvedLocation = null;
        }
    }
    if (!resolvedLocation && resolvedOwner?.currentLocation) {
        try {
            resolvedLocation = Location.get(resolvedOwner.currentLocation);
        } catch (_) {
            resolvedLocation = null;
        }
    }

    const resolvedRegion = resolvedLocation ? findRegionByLocationId(resolvedLocation.id) : null;

    const baseContext = await prepareBasePromptContext({ locationOverride: resolvedLocation });
    const itemForPrompt = buildThingPromptItem(thing);
    const originalState = thing.toJSON();

    const targetName = typeof newName === 'string' && newName.trim() ? newName.trim() : thing.name;

    const thingSeed = {
        name: targetName,
        description: itemForPrompt.description,
        itemOrScenery: itemForPrompt.itemOrScenery,
        type: itemForPrompt.type,
        slot: itemForPrompt.slot.length ? itemForPrompt.slot[0] : 'N/A',
        rarity: itemForPrompt.rarity,
        value: itemForPrompt.value,
        weight: itemForPrompt.weight,
        relativeLevel: 0,
        isVehicle: itemForPrompt.isVehicle ? 'true' : 'false',
        properties: itemForPrompt.properties,
        attributeBonuses: itemForPrompt.attributeBonuses,
        causeStatusEffect: itemForPrompt.causeStatusEffect
    };

    const rarityDefinitionForSeed = Thing.getRarityDefinition(thingSeed.rarity, { fallbackToDefault: true });
    thingSeed.rarityDescription = rarityDefinitionForSeed
        ? (rarityDefinitionForSeed.description || `A ${rarityDefinitionForSeed.label} item.`)
        : `A ${thingSeed.rarity || getDefaultRarityLabel()} item.`;

    const promptTemplateBase = {
        ...baseContext,
        promptType: 'thing-alter',
        changeDescription: changeDescription || 'Describe how this item has been altered.',
        thingSeed,
        item: itemForPrompt
    };

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        throw new Error('AI configuration missing; cannot alter item.');
    }

    let renderedTemplate;
    try {
        renderedTemplate = promptEnv.render('base-context.xml.njk', promptTemplateBase);
    } catch (renderError) {
        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const debugPath = path.join(logDir, `event_item_alter_render_error_${Date.now()}.log`);
            const debugPayload = {
                message: renderError.message,
                stack: renderError.stack,
                promptTemplateBase
            };
            fs.writeFileSync(debugPath, JSON.stringify(debugPayload, null, 2), 'utf8');
        } catch (logError) {
            console.warn('Failed to log item alteration render error:', logError.message);
        }
        throw renderError;
    }

    const parsedTemplate = parseXMLTemplate(renderedTemplate);

    if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
        throw new Error('Thing alteration template did not produce prompts.');
    }

    const messages = [
        { role: 'system', content: parsedTemplate.systemPrompt },
        { role: 'user', content: parsedTemplate.generationPrompt }
    ];

    const requestStart = Date.now();
    const aiResponse = await LLMClient.chatCompletion({
        messages,
        temperature: parsedTemplate.temperature,
        metadataLabel: 'alter_thing'
    });

    const apiDurationSeconds = (Date.now() - requestStart) / 1000;

    if (!aiResponse || !aiResponse.trim()) {
        throw new Error('Empty item alteration response from AI.');
    }

    const parsedItems = parseInventoryItems(aiResponse);
    if (!Array.isArray(parsedItems) || !parsedItems.length) {
        throw new Error('Thing alteration response did not include an item definition.');
    }

    const updatedItem = parsedItems[0];
    const originalName = thing.name;
    const updatedName = typeof updatedItem.name === 'string' && updatedItem.name.trim()
        ? updatedItem.name.trim()
        : targetName;
    const normalizedType = (updatedItem.itemOrScenery || thing.thingType || 'item').trim().toLowerCase() === 'scenery'
        ? 'scenery'
        : 'item';

    const previousMetadata = { ...metadata };
    const previousOwnerId = previousMetadata.ownerId || null;
    const previousLocationId = previousMetadata.locationId || null;

    const ownerCandidate = resolvedOwner || (previousOwnerId ? players.get(previousOwnerId) || null : null);

    if (ownerCandidate && ownerCandidate !== resolvedOwner) {
        resolvedOwner = ownerCandidate;
    }

    const relativeLevelRaw = Number(updatedItem.relativeLevel);
    const relativeLevel = Number.isFinite(relativeLevelRaw)
        ? Math.max(-10, Math.min(10, Math.round(relativeLevelRaw)))
        : (previousMetadata.relativeLevel ?? thing.relativeLevel ?? 0);

    const baseReference = (() => {
        if (resolvedOwner && Number.isFinite(resolvedOwner.level)) {
            return resolvedOwner.level;
        }
        if (resolvedLocation && Number.isFinite(resolvedLocation.baseLevel)) {
            return resolvedLocation.baseLevel;
        }
        if (resolvedRegion && Number.isFinite(resolvedRegion.averageLevel)) {
            return resolvedRegion.averageLevel;
        }
        if (Number.isFinite(previousMetadata.level)) {
            return previousMetadata.level;
        }
        if (Number.isFinite(thing.level)) {
            return thing.level;
        }
        return currentPlayer?.level || 1;
    })();

    const computedLevel = clampLevel(
        (Number.isFinite(baseReference) ? baseReference : 1) + (Number.isFinite(relativeLevel) ? relativeLevel : 0),
        baseReference
    );

    const rarity = updatedItem.rarity || thing.rarity || getDefaultRarityLabel();
    const slotValue = updatedItem.slot && typeof updatedItem.slot === 'string'
        && updatedItem.slot.trim().toLowerCase() !== 'n/a'
        ? updatedItem.slot.trim()
        : null;

    const scaledAttributeBonuses = normalizedType === 'item'
        ? scaleAttributeBonusesForItem(updatedItem.attributeBonuses || [], {
            level: computedLevel,
            rarity
        })
        : [];

    const updatedMetadata = {
        ...previousMetadata,
        rarity,
        itemType: updatedItem.type || previousMetadata.itemType || null,
        itemTypeDetail: updatedItem.type || previousMetadata.itemTypeDetail || null,
        value: updatedItem.value ?? previousMetadata.value,
        weight: updatedItem.weight ?? previousMetadata.weight,
        properties: updatedItem.properties ?? previousMetadata.properties,
        causeStatusEffect: normalizedType === 'item' ? updatedItem.causeStatusEffect || null : null,
        attributeBonuses: normalizedType === 'item' ? scaledAttributeBonuses : undefined,
        relativeLevel,
        level: computedLevel
    };

    if (normalizedType === 'scenery') {
        delete updatedMetadata.ownerId;
        if (resolvedLocation) {
            updatedMetadata.locationId = resolvedLocation.id;
            updatedMetadata.locationName = resolvedLocation.name || resolvedLocation.id;
        }
    } else if (resolvedOwner && typeof resolvedOwner.id === 'string') {
        updatedMetadata.ownerId = resolvedOwner.id;
        delete updatedMetadata.locationId;
        delete updatedMetadata.locationName;
    } else if (resolvedLocation) {
        updatedMetadata.locationId = resolvedLocation.id;
        updatedMetadata.locationName = resolvedLocation.name || resolvedLocation.id;
    }

    const sanitizedMetadata = sanitizeMetadataObject(updatedMetadata);

    const previousOwner = previousOwnerId ? players.get(previousOwnerId) || null : null;
    const previousLocation = previousLocationId ? (() => {
        try {
            return Location.get(previousLocationId);
        } catch (_) {
            return null;
        }
    })() : null;

    if (previousOwner && previousOwner !== resolvedOwner && typeof previousOwner.removeInventoryItem === 'function') {
        try {
            previousOwner.removeInventoryItem(thing);
        } catch (error) {
            console.warn(`Failed to remove ${originalName} from ${previousOwner.name || previousOwner.id}:`, error.message);
        }
    }

    const newLocationId = sanitizedMetadata.locationId || null;
    if (previousLocation && previousLocation.id !== newLocationId && typeof previousLocation.removeThingId === 'function') {
        try {
            previousLocation.removeThingId(thing.id);
        } catch (error) {
            console.warn(`Failed to detach ${thing.id} from location ${previousLocation.id}:`, error.message);
        }
    }

    if (resolvedOwner && typeof resolvedOwner.addInventoryItem === 'function' && sanitizedMetadata.ownerId === resolvedOwner.id) {
        try {
            resolvedOwner.addInventoryItem(thing);
        } catch (error) {
            console.warn(`Failed to add ${thing.name} to ${resolvedOwner.name || resolvedOwner.id}:`, error.message);
        }
    }

    if (newLocationId) {
        try {
            const locationCandidate = Location.get(newLocationId);
            if (locationCandidate && typeof locationCandidate.addThingId === 'function') {
                locationCandidate.addThingId(thing.id);
            }
        } catch (error) {
            console.warn(`Failed to attach ${thing.id} to location ${newLocationId}:`, error.message);
        }
    }

    thing.thingType = normalizedType;
    thing.name = updatedName;
    thing.description = updatedItem.description || thing.description;
    thing.itemTypeDetail = updatedItem.type || null;
    thing.rarity = rarity;
    thing.slot = slotValue;
    thing.attributeBonuses = normalizedType === 'item' ? scaledAttributeBonuses : [];
    thing.causeStatusEffect = normalizedType === 'item' ? updatedItem.causeStatusEffect || null : null;
    thing.level = computedLevel;
    thing.relativeLevel = Number.isFinite(relativeLevel) ? relativeLevel : null;
    thing.metadata = sanitizedMetadata;

    if (normalizedType === 'scenery') {
        thing.slot = null;
        thing.attributeBonuses = [];
        thing.causeStatusEffect = null;
    }

    if (thing.imageId) {
        thing.imageId = null;
    }

    if (ensureUniqueThingNames) {
        try {
            await ensureUniqueThingNames({
                things: [thing],
                location: sanitizedMetadata.locationId ? Location.get(sanitizedMetadata.locationId) || null : resolvedLocation,
                owner: resolvedOwner || null
            });
        } catch (error) {
            console.warn('Failed to enforce unique thing names after alteration:', error.message);
        }
    }

    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const safeName = (thing.name || targetName || 'item')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'item';
        const logPath = path.join(logDir, `event_item_alter_${Date.now()}_${safeName}.log`);
        const logParts = [
            formatDurationLine(apiDurationSeconds),
            '=== ITEM ALTERATION SYSTEM PROMPT ===',
            parsedTemplate.systemPrompt,
            '',
            '=== ITEM ALTERATION PROMPT ===',
            parsedTemplate.generationPrompt,
            '',
            '=== ITEM ALTERATION RESPONSE ===',
            aiResponse,
            '',
            '=== ORIGINAL ITEM STATE ===',
            JSON.stringify(originalState, null, 2),
            '',
            '=== UPDATED ITEM ===',
            JSON.stringify(thing.toJSON(), null, 2),
            ''
        ];
        fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
    } catch (logError) {
        console.warn('Failed to log item alteration:', logError.message);
    }

    return {
        originalName,
        newName: thing.name,
        changeDescription: changeDescription || '',
        thing: thing
    };
}

function renderLocationNpcPrompt(location, options = {}) {
    try {
        const templateName = 'location-generator-npcs.xml.njk';
        const generationHints = location && typeof location === 'object' && typeof location.generationHints === 'object'
            ? location.generationHints
            : {};

        const normalizeCount = (value, fallback) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric >= 0) {
                return Math.max(0, Math.round(numeric));
            }
            const fallbackNumeric = Number(fallback);
            if (Number.isFinite(fallbackNumeric) && fallbackNumeric >= 0) {
                return Math.max(0, Math.round(fallbackNumeric));
            }
            return 0;
        };

        const resolvedNumNpcs = normalizeCount(
            options.numNpcs ?? generationHints.numNpcs,
            options.desiredCount ?? 3
        );

        const resolvedNumHostiles = normalizeCount(
            options.numHostiles ?? generationHints.numHostiles,
            Math.max(0, Math.round(resolvedNumNpcs / 2))
        );

        return promptEnv.render(templateName, {
            locationName: location.name || 'Unknown Location',
            locationDescription: location.description || 'No description provided.',
            regionTheme: options.regionTheme || null,
            desiredCount: options.desiredCount || 3,
            numNpcs: resolvedNumNpcs,
            numHostiles: resolvedNumHostiles,
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
        /*
        const safeRegion = region ? {
            id: region.id,
            name: region.name,
            description: region.description
        } : { id: null, name: 'Unknown Region', description: '' };
        */

        return promptEnv.render(templateName, {
            region: region,
            allLocationsInRegion: options.allLocationsInRegion || [],
            existingNpcsInOtherRegions: options.existingNpcsInOtherRegions || [],
            attributeDefinitions: options.attributeDefinitions || attributeDefinitionsForPrompt,
            bannedWords: options.bannedWords || getBannedNpcWords(),
            characterConcepts: options.characterConcepts || []
        });
    } catch (error) {
        console.error('Error rendering region NPC template:', error);
        return null;
    }
}

function normalizeNpcPromptSeed(seed = {}) {
    const normalized = {};
    if (!seed || typeof seed !== 'object') {
        return normalized;
    }

    const copyTrimmed = (key, options = {}) => {
        const value = seed[key];
        if (value === undefined || value === null) {
            return;
        }
        const asString = String(value);
        const trimmed = options.allowEmpty ? asString.trim() : asString.trim();
        if (trimmed || options.allowEmpty) {
            normalized[key] = trimmed;
        }
    };

    const name = typeof seed.name === 'string' ? seed.name.trim() : '';
    if (name) {
        normalized.name = name;
    }

    copyTrimmed('description');
    copyTrimmed('shortDescription');
    copyTrimmed('role');
    copyTrimmed('class');
    copyTrimmed('race');

    if (Object.prototype.hasOwnProperty.call(seed, 'isHostile')) {
        normalized.isHostile = Boolean(seed.isHostile);
    }

    if (Object.prototype.hasOwnProperty.call(seed, 'relativeLevel')) {
        const relative = Number(seed.relativeLevel);
        if (Number.isFinite(relative)) {
            const clamped = Math.max(-10, Math.min(10, Math.round(relative)));
            normalized.relativeLevel = clamped;
        }
    }

    if (Object.prototype.hasOwnProperty.call(seed, 'currency')) {
        const currencyValue = Number(seed.currency);
        if (Number.isFinite(currencyValue)) {
            normalized.currency = Math.max(0, Math.round(currencyValue));
        }
    }

    const resolveGoals = (value) => {
        const goals = [];
        const add = (entry) => {
            if (typeof entry !== 'string') {
                return;
            }
            const trimmed = entry.trim();
            if (trimmed && !goals.includes(trimmed)) {
                goals.push(trimmed);
            }
        };
        const walk = (input) => {
            if (input === null || input === undefined) {
                return;
            }
            if (typeof input === 'string') {
                add(input);
                return;
            }
            if (Array.isArray(input)) {
                input.forEach(walk);
                return;
            }
            if (typeof input === 'object') {
                for (const entry of Object.values(input)) {
                    walk(entry);
                }
            }
        };
        walk(value);
        return goals;
    };

    const rawGoals = seed.goals ?? seed.personality?.goals;
    const normalizedGoals = resolveGoals(rawGoals);
    if (normalizedGoals.length) {
        normalized.goals = normalizedGoals;
    }

    return normalized;
}

async function renderSingleNpcPrompt({ npc, settingSnapshot = null, location = null, region = null, existingNpcSummaries = [], oldItem = null } = {}) {
    try {
        const baseContext = await prepareBasePromptContext({ locationOverride: location || null });

        const safeRegion = region ? {
            name: region.name || 'Unknown Region',
            description: region.description || 'No description provided.'
        } : {
            name: baseContext.currentRegion?.name || location?.stubMetadata?.regionName || 'Unknown Region',
            description: baseContext.currentRegion?.description || location?.stubMetadata?.regionDescription || 'No description provided.'
        };

        const safeLocation = location ? {
            name: location.name || 'Unknown Location',
            description: location.description || location.stubMetadata?.blueprintDescription || 'No description provided.'
        } : {
            name: baseContext.currentLocation?.name || 'Unknown Location',
            description: baseContext.currentLocation?.description || 'No description provided.'
        };

        const npcSeed = normalizeNpcPromptSeed(npc || {});

        const oldItemContext = (() => {
            if (!oldItem || typeof oldItem !== 'object') {
                return null;
            }
            const name = typeof oldItem.name === 'string' ? oldItem.name.trim() : '';
            const description = typeof oldItem.description === 'string' ? oldItem.description.trim() : '';
            const transformationDescription = typeof oldItem.transformationDescription === 'string'
                ? oldItem.transformationDescription.trim()
                : '';
            if (!name && !description && !transformationDescription) {
                return null;
            }
            return {
                name: name || '',
                description: description || '',
                transformationDescription: transformationDescription || ''
            };
        })();

        return promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'npc-generator-single',
            region: safeRegion,
            location: safeLocation,
            existingNpcSummaries: existingNpcSummaries || [],
            npc: npcSeed,
            attributeDefinitions: baseContext.attributeDefinitions || attributeDefinitionsForPrompt,
            oldItem: oldItemContext,
            setting: baseContext.setting
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

async function generateNpcFromEvent({ name, npc = null, location = null, region = null, oldItem = null } = {}) {
    const seedSource = (npc && typeof npc === 'object') ? { ...npc } : {};
    let trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName && typeof seedSource.name === 'string') {
        trimmedName = seedSource.name.trim();
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

        const npcSeed = normalizeNpcPromptSeed({ ...seedSource, name: trimmedName });

        const renderedTemplate = await renderSingleNpcPrompt({
            npc: npcSeed,
            settingSnapshot,
            location: resolvedLocation,
            region: resolvedRegion,
            existingNpcSummaries: existingNpcSummaries.slice(0, 25),
            oldItem
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

        const requestStart = Date.now();
        const npcResponse = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'npc_generation_single'
        });

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

        const parsedResult = parseLocationNpcs(npcResponse);
        const parsedNpcs = Array.isArray(parsedResult?.npcs) ? parsedResult.npcs : [];
        const generatedMemories = parsedResult?.memories instanceof Map ? parsedResult.memories : new Map();
        const baseConversation = [
            ...messages,
            { role: 'assistant', content: npcResponse }
        ];

        let skillAssignments = new Map();
        let abilityAssignments = new Map();
        let skillConversation = baseConversation;

        const logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logsDir)) {
            try {
                fs.mkdirSync(logsDir, { recursive: true });
            } catch (mkdirError) {
                console.warn('Failed to ensure logs directory for NPC generation:', mkdirError?.message || mkdirError);
            }
        }

        try {
            const skillLogPath = path.join(logsDir, `npc_single_skills_${Date.now()}.log`);
            const skillResult = await requestNpcSkillAssignments({
                baseMessages: baseConversation,
                logPath: skillLogPath
            });
            if (skillResult?.assignments instanceof Map) {
                skillAssignments = skillResult.assignments;
            }
            if (Array.isArray(skillResult?.conversation) && skillResult.conversation.length) {
                skillConversation = skillResult.conversation;
            }
        } catch (skillError) {
            console.warn('Failed to generate skills for single NPC:', skillError?.message || skillError);
        }

        try {
            const abilityLogPath = path.join(logsDir, `npc_single_abilities_${Date.now()}.log`);
            const abilityResult = await requestNpcAbilityAssignments({
                baseMessages: skillConversation,
                logPath: abilityLogPath
            });
            if (abilityResult?.assignments instanceof Map) {
                abilityAssignments = abilityResult.assignments;
            }
        } catch (abilityError) {
            console.warn('Failed to generate abilities for single NPC:', abilityError?.message || abilityError);
        }

        let npcData = parsedNpcs && parsedNpcs.length ? parsedNpcs[0] : null;
        if (npcData) {
            npcData = { ...normalizeNpcPromptSeed(npcSeed), ...npcData };
            npcData.name = npcData.name || trimmedName;
        } else {
            npcData = {
                ...normalizeNpcPromptSeed(npcSeed),
                name: trimmedName,
                description: npcSeed.description || `${trimmedName} steps into the scene with purpose.`,
                shortDescription: npcSeed.shortDescription || '',
                role: npcSeed.role || 'mysterious figure'
            };
        }

        npcData.description = applyNpcNameTemplate(npcData.description, npcData.name);
        npcData.shortDescription = applyNpcNameTemplate(npcData.shortDescription, npcData.name);

        const attributes = {};
        const attrSource = npcData?.attributes || {};
        for (const attrName of Object.keys(attributeDefinitionsForPrompt)) {
            const lowerKey = attrName.toLowerCase();
            const rating = attrSource[attrName] ?? attrSource[lowerKey];
            attributes[attrName] = mapNpcRatingToValue(rating);
        }

        const npc = new Player({
            name: npcData?.name || trimmedName,
            description: npcData?.description || `${trimmedName} is drawn into the story.`,
            shortDescription: npcData?.shortDescription || '',
            class: npcData?.class || npcData?.role || 'citizen',
            race: npcData?.race || 'human',
            level: 1,
            location: resolvedLocation?.id || null,
            attributes,
            isNPC: true,
            isHostile: Boolean(npcData?.isHostile),
            healthAttribute: npcData?.healthAttribute,
            personalityType: npcData?.personalityType || null,
            personalityTraits: npcData?.personalityTraits || null,
            personalityNotes: npcData?.personalityNotes || null,
            goals: Array.isArray(npcData?.goals) ? npcData.goals : null
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

        const normalizedNpcName = (npc.name || '').trim().toLowerCase();
        if (normalizedNpcName && skillAssignments instanceof Map) {
            const skillEntry = skillAssignments.get(normalizedNpcName);
            if (skillEntry && Array.isArray(skillEntry.skills) && skillEntry.skills.length) {
                applyNpcSkillAllocations(npc, skillEntry.skills);
            }
        }

        if (normalizedNpcName && abilityAssignments instanceof Map) {
            const abilityEntry = abilityAssignments.get(normalizedNpcName);
            if (abilityEntry && Array.isArray(abilityEntry.abilities) && abilityEntry.abilities.length) {
                applyNpcAbilities(npc, abilityEntry.abilities);
            }
        }

        if (normalizedNpcName && generatedMemories instanceof Map) {
            const memoryEntry = generatedMemories.get(normalizedNpcName);
            if (Array.isArray(memoryEntry) && memoryEntry.length) {
                try {
                    npc.importantMemories = memoryEntry.slice(0);
                } catch (memoryError) {
                    console.warn(`Failed to assign generated memories to NPC ${npc.name}:`, memoryError.message);
                }
            }
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
                location: resolvedLocation
            });
        } catch (inventoryError) {
            console.warn('Failed to generate inventory for new NPC:', inventoryError.message);
        }

        restoreCharacterHealthToMaximum(npc);

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
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

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
    timeoutScale = 1
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
            rarity: item.rarity || metadata.rarity || getDefaultRarityLabel(),
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

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    timeoutScale = Math.max(1, Number(timeoutScale) || 1);

    let equipResponse = '';
    const requestStart = Date.now();
    try {
        equipResponse = await LLMClient.chatCompletion({
            messages,
            timeoutScale,
            metadataLabel: 'equip_best'
        });
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

Player.setLevelUpHandler(({ character, previousLevel, newLevel }) => {
    if (!character) {
        return null;
    }
    return generateLevelUpAbilitiesForCharacter(character, { previousLevel, newLevel });
});

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

function parseIntegerFromText(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).replace(/[,]/g, ' ').trim();
    if (!text) {
        return null;
    }
    const match = text.match(/-?\d+/);
    if (!match) {
        return null;
    }
    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationNpcs(xmlContent) {
    const result = { npcs: [], memories: new Map() };
    if (!xmlContent || typeof xmlContent !== 'string') {
        return result;
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const responseRoot = doc.getElementsByTagName('response')[0] || doc;
        const npcContainer = responseRoot.getElementsByTagName('npcs')[0] || responseRoot;
        const hostileContainer = responseRoot.getElementsByTagName('hostiles')[0] || responseRoot;

        const memoryNodes = Array.from(responseRoot.getElementsByTagName('npcMemories'));
        for (const memoryNode of memoryNodes) {
            const nameNode = memoryNode.getElementsByTagName('npcName')[0] || null;
            const rawName = nameNode ? nameNode.textContent : '';
            const normalizedName = rawName ? rawName.trim().toLowerCase() : '';
            if (!normalizedName) {
                continue;
            }
            const memoryEntries = Array.from(memoryNode.getElementsByTagName('memory'))
                .map(entry => (entry.textContent || '').trim())
                .filter(Boolean);
            if (memoryEntries.length) {
                result.memories.set(normalizedName, memoryEntries.slice(0, 3));
            }
        }

        const npcNodes = [
            ...npcContainer.getElementsByTagName('npc'),
            ...hostileContainer.getElementsByTagName('hostile'),
        ];

        for (const node of npcNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            const descriptionNode = node.getElementsByTagName('description')[0];
            const shortDescriptionNode = node.getElementsByTagName('shortDescription')[0];
            const roleNode = node.getElementsByTagName('role')[0];
            const attributesNode = node.getElementsByTagName('attributes')[0];
            const classNode = node.getElementsByTagName('class')[0];
            const raceNode = node.getElementsByTagName('race')[0];
            const genderNode = node.getElementsByTagName('gender')[0];
            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const healthAttributeNode = node.getElementsByTagName('healthAttribute')[0];
            const personalityNode = node.getElementsByTagName('personality')[0];
            const currencyNode = node.getElementsByTagName('currency')[0];
            const isHostileNode = node.getElementsByTagName('isHostile')[0];
            const isHostile = isHostileNode
                ? /^\s*(true|1|yes|hostile)\s*$/i.test(isHostileNode.textContent)
                : false;

            const className = classNode ? classNode.textContent.trim() : null;
            const race = raceNode ? raceNode.textContent.trim() : null;
            const name = nameNode ? nameNode.textContent.trim() : null;
            const description = descriptionNode ? descriptionNode.textContent.trim() : '';
            const shortDescription = shortDescriptionNode ? shortDescriptionNode.textContent.trim() : '';
            const role = roleNode ? roleNode.textContent.trim() : null;
            const gender = genderNode ? genderNode.textContent.trim() : null;
            const attributes = {};
            const relativeLevel = relativeLevelNode ? Number(relativeLevelNode.textContent.trim()) : null;
            const healthAttribute = healthAttributeNode ? healthAttributeNode.textContent.trim() : null;
            const currencyValue = currencyNode ? parseIntegerFromText(currencyNode.textContent) : null;

            let personalityType = null;
            let personalityTraits = null;
            let personalityNotes = null;
            let goals = [];
            if (personalityNode) {
                const typeNode = personalityNode.getElementsByTagName('type')[0];
                const traitsNode = personalityNode.getElementsByTagName('traits')[0];
                const notesNode = personalityNode.getElementsByTagName('notes')[0];
                const goalsNode = personalityNode.getElementsByTagName('goals')[0];
                if (typeNode && typeof typeNode.textContent === 'string') {
                    const value = typeNode.textContent.trim();
                    if (value) {
                        personalityType = value;
                    }
                }
                if (traitsNode && typeof traitsNode.textContent === 'string') {
                    const value = traitsNode.textContent.trim();
                    if (value) {
                        personalityTraits = value;
                    }
                }
                if (notesNode && typeof notesNode.textContent === 'string') {
                    const value = notesNode.textContent.trim();
                    if (value) {
                        personalityNotes = value;
                    }
                }
                if (goalsNode) {
                    const goalNodes = Array.from(goalsNode.getElementsByTagName('goal'));
                    goals = goalNodes
                        .map(goalNode => (goalNode && typeof goalNode.textContent === 'string'
                            ? goalNode.textContent.trim()
                            : ''))
                        .filter(Boolean);
                }
            }

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
                result.npcs.push({
                    name,
                    description,
                    shortDescription,
                    role,
                    class: className,
                    race,
                    gender,
                    attributes,
                    relativeLevel: Number.isFinite(relativeLevel) ? Math.max(-10, Math.min(10, Math.round(relativeLevel))) : null,
                    healthAttribute: healthAttribute && healthAttribute.toLowerCase() !== 'n/a' ? healthAttribute : null,
                    currency: Number.isFinite(currencyValue) && currencyValue >= 0 ? currencyValue : null,
                    personalityType,
                    personalityTraits,
                    personalityNotes,
                    goals,
                    isHostile
                });
            }
        }
    } catch (error) {
        console.warn('Failed to parse NPC XML:', error.message);
        console.debug(error);
    }

    return result;
}

function parseRegionNpcs(xmlContent) {
    const result = { npcs: [], memories: new Map() };
    if (!xmlContent || typeof xmlContent !== 'string') {
        return result;
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const responseRoot = doc.getElementsByTagName('response')[0] || doc;
        const npcContainer = responseRoot.getElementsByTagName('npcs')[0] || responseRoot;

        const memoryNodes = Array.from(responseRoot.getElementsByTagName('npcMemories'));
        for (const memoryNode of memoryNodes) {
            const nameNode = memoryNode.getElementsByTagName('npcName')[0] || null;
            const rawName = nameNode ? nameNode.textContent : '';
            const normalizedName = rawName ? rawName.trim().toLowerCase() : '';
            if (!normalizedName) {
                continue;
            }
            const memoryEntries = Array.from(memoryNode.getElementsByTagName('memory'))
                .map(entry => (entry.textContent || '').trim())
                .filter(Boolean);
            if (memoryEntries.length) {
                result.memories.set(normalizedName, memoryEntries.slice(0, 3));
            }
        }

        const npcNodes = Array.from(npcContainer.getElementsByTagName('npc'));

        for (const node of npcNodes) {
            const nameNode = node.getElementsByTagName('name')[0];
            const descriptionNode = node.getElementsByTagName('description')[0];
            const shortDescriptionNode = node.getElementsByTagName('shortDescription')[0];
            const roleNode = node.getElementsByTagName('role')[0];
            const classNode = node.getElementsByTagName('class')[0];
            const raceNode = node.getElementsByTagName('race')[0];
            const genderNode = node.getElementsByTagName('gender')[0];
            const locationNode = node.getElementsByTagName('location')[0];
            const attributesNode = node.getElementsByTagName('attributes')[0];
            const relativeLevelNode = node.getElementsByTagName('relativeLevel')[0];
            const healthAttributeNode = node.getElementsByTagName('healthAttribute')[0];
            const personalityNode = node.getElementsByTagName('personality')[0];
            const currencyNode = node.getElementsByTagName('currency')[0];
            const isHostileNode = node.getElementsByTagName('isHostile')[0];
            const isHostile = isHostileNode
                ? /^\s*(true|1|yes|hostile)\s*$/i.test(isHostileNode.textContent)
                : false;

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
            const gender = genderNode ? genderNode.textContent.trim() : null;

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
            const currencyValue = currencyNode ? parseIntegerFromText(currencyNode.textContent) : null;

            let personalityType = null;
            let personalityTraits = null;
            let personalityNotes = null;
            let goals = [];
            if (personalityNode) {
                const typeNode = personalityNode.getElementsByTagName('type')[0];
                const traitsNode = personalityNode.getElementsByTagName('traits')[0];
                const notesNode = personalityNode.getElementsByTagName('notes')[0];
                const goalsNode = personalityNode.getElementsByTagName('goals')[0];

                if (typeNode && typeof typeNode.textContent === 'string') {
                    const value = typeNode.textContent.trim();
                    if (value) {
                        personalityType = value;
                    }
                }
                if (traitsNode && typeof traitsNode.textContent === 'string') {
                    const value = traitsNode.textContent.trim();
                    if (value) {
                        personalityTraits = value;
                    }
                }
                if (notesNode && typeof notesNode.textContent === 'string') {
                    const value = notesNode.textContent.trim();
                    if (value) {
                        personalityNotes = value;
                    }
                }
                if (goalsNode) {
                    const goalNodes = Array.from(goalsNode.getElementsByTagName('goal'));
                    goals = goalNodes
                        .map(goalNode => (goalNode && typeof goalNode.textContent === 'string'
                            ? goalNode.textContent.trim()
                            : ''))
                        .filter(Boolean);
                }
            }

            result.npcs.push({
                name,
                description,
                shortDescription,
                role,
                class: className,
                race,
                gender,
                location: locationName,
                attributes,
                relativeLevel: Number.isFinite(relativeLevel) ? Math.max(-10, Math.min(10, Math.round(relativeLevel))) : null,
                healthAttribute: healthAttribute && healthAttribute.toLowerCase() !== 'n/a' ? healthAttribute : null,
                currency: Number.isFinite(currencyValue) && currencyValue >= 0 ? currencyValue : null,
                personalityType,
                personalityTraits,
                personalityNotes,
                goals,
                isHostile
            });
        }
    } catch (error) {
        console.warn('Failed to parse region NPC XML:', error.message);
    }

    return result;
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
        console.debug(error);
        return null;
    }
}

function parseNpcSkillAssignments(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return new Map();
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');
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

async function requestNpcSkillAssignments({ baseMessages = [], logPath, timeoutScale = 1 }) {
    console.log(`Requesting NPC skill assignments from LLM... (timeoutScale=${timeoutScale})`);
    try {
        const availableSkillsMap = Player.getAvailableSkills();
        if (!availableSkillsMap || availableSkillsMap.size === 0) {
            console.log('No available skills found for NPC skill assignment.');
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
            console.log('No valid skills found for NPC skill assignment.');
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const skillsPrompt = renderNpcSkillsPrompt(skillsForPrompt);
        if (!skillsPrompt) {
            console.log('Failed to render NPC skills prompt.');
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const messages = [...baseMessages, { role: 'user', content: skillsPrompt }];

        timeoutScale = Math.max(1, Number(timeoutScale) || 1);

        const requestStart = Date.now();
        const skillResponse = await LLMClient.chatCompletion({
            messages,
            timeoutScale,
            metadataLabel: 'npc_skill_assignments'
        });

        if (!skillResponse || !skillResponse.trim()) {
            console.log('NPC skill assignments returned empty response.');
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const durationSeconds = (Date.now() - requestStart) / 1000;
        const normalizedResponse = typeof skillResponse === 'string' ? skillResponse.trim() : '';
        if (!normalizedResponse) {
            console.log('NPC skill assignments returned no result.');
            return null;
        }

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
        console.debug(error);
        return null;
    }
}

function parseNpcAbilityAssignments(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        return new Map();
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');
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

async function requestNpcAbilityAssignments({ baseMessages = [], logPath, timeoutScale = 1 }) {
    try {
        const abilitiesPrompt = renderNpcAbilitiesPrompt();
        if (!abilitiesPrompt) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

        const messages = [...baseMessages, { role: 'user', content: abilitiesPrompt }];

        timeoutScale = Math.max(1, Number(timeoutScale) || 1);


        const requestStart = Date.now();
        const abilityResponse = await LLMClient.chatCompletion({
            messages,
            timeoutScale: timeoutScale,
            metadataLabel: 'npc_ability_assignments'
        });

        if (!abilityResponse || !abilityResponse.trim()) {
            return {
                assignments: new Map(),
                conversation: [...baseMessages]
            };
        }

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
        console.debug(error);
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

function buildLevelUpSummaryForCharacter(character, { previousLevel = null } = {}) {
    if (!character || typeof character.name !== 'string') {
        return null;
    }

    const name = character.name.trim();
    if (!name) {
        return null;
    }

    const currentLevel = Number(character.level);
    const race = typeof character.race === 'string' ? character.race.trim() : '';
    const className = typeof character.class === 'string' ? character.class.trim() : '';

    const descriptorParts = [];
    if (Number.isFinite(currentLevel)) {
        if (Number.isFinite(previousLevel) && previousLevel !== currentLevel) {
            descriptorParts.push(`Level ${currentLevel} (was ${previousLevel})`);
        } else {
            descriptorParts.push(`Level ${currentLevel}`);
        }
    }
    if (race) {
        descriptorParts.push(race);
    }
    if (className) {
        descriptorParts.push(className);
    }

    const descriptor = descriptorParts.join(' ');

    let description = '';
    if (typeof character.shortDescription === 'string' && character.shortDescription.trim()) {
        description = character.shortDescription.trim();
    } else if (typeof character.description === 'string' && character.description.trim()) {
        description = character.description.trim();
    }

    const summaryParts = [];
    if (descriptor) {
        summaryParts.push(descriptor);
    }
    if (description) {
        summaryParts.push(description);
    }

    let shortDescription = summaryParts.length ? summaryParts.join(' - ') : 'No description provided.';
    if (shortDescription.length > 280) {
        shortDescription = `${shortDescription.slice(0, 277)}...`;
    }

    return {
        name,
        shortDescription
    };
}

function collectNpcSummariesForLevelUp({ character, locationObj, regionObj, previousLevel = null } = {}) {
    const summaries = new Map();

    const addSummary = (npc, opts = {}) => {
        if (!npc) {
            return;
        }
        const summary = buildLevelUpSummaryForCharacter(npc, opts);
        if (!summary || !summary.name) {
            return;
        }
        const key = summary.name.toLowerCase();
        if (!summaries.has(key)) {
            summaries.set(key, summary);
        }
    };

    if (character) {
        addSummary(character, { previousLevel });
    }

    if (locationObj && Array.isArray(locationObj.npcIds)) {
        for (const npcId of locationObj.npcIds) {
            if (!npcId || (character && npcId === character.id)) {
                continue;
            }
            const npc = players.get(npcId);
            addSummary(npc);
        }
    }

    if (regionObj && Array.isArray(regionObj.locationIds)) {
        for (const locId of regionObj.locationIds) {
            if (!locId) {
                continue;
            }
            if (locationObj && locId === locationObj.id) {
                continue;
            }
            const otherLocation = gameLocations.get(locId);
            if (!otherLocation || !Array.isArray(otherLocation.npcIds)) {
                continue;
            }
            for (const npcId of otherLocation.npcIds) {
                if (!npcId || (character && npcId === character.id)) {
                    continue;
                }
                const npc = players.get(npcId);
                addSummary(npc);
            }
        }
    }

    return Array.from(summaries.values()).slice(0, 30);
}

async function generateLevelUpAbilitiesForCharacter(character, { previousLevel = null, newLevel = null } = {}) {
    if (!character || typeof character.name !== 'string') {
        console.error('generateLevelUpAbilitiesForCharacter: Invalid character object.');
        return null;
    }

    console.log(`Generating level-up abilities for ${character.name}...`);

    const trimmedName = character.name.trim();
    if (!trimmedName) {
        return null;
    }

    const characterKey = (typeof character.id === 'string' && character.id.trim())
        ? character.id.trim()
        : trimmedName.toLowerCase();

    if (levelUpAbilityPromises.has(characterKey)) {
        return levelUpAbilityPromises.get(characterKey);
    }

    const abilityPromise = (async () => {
        const settingSnapshot = getActiveSettingSnapshot();
        const settingContext = buildSettingPromptContext(settingSnapshot);

        const locationId = typeof character.currentLocation === 'string'
            ? character.currentLocation
            : null;

        let locationObj = null;
        if (locationId) {
            locationObj = gameLocations.get(locationId) || null;
            if (!locationObj) {
                try {
                    locationObj = Location.get(locationId);
                } catch (_) {
                    locationObj = null;
                }
            }
        }

        const locationContext = {
            name: locationObj?.name || 'Unknown Location',
            description: (locationObj?.description && typeof locationObj.description === 'string'
                ? locationObj.description.trim()
                : locationObj?.stubMetadata?.blueprintDescription || 'No description provided.')
        };

        const regionObj = locationObj ? findRegionByLocationId(locationObj.id) : null;
        const regionContext = {
            name: regionObj?.name || 'Unknown Region',
            description: regionObj?.description || 'No description provided.'
        };

        const currentLevel = Number.isFinite(newLevel)
            ? newLevel
            : (Number(character.level) || null);
        const priorLevel = Number.isFinite(previousLevel)
            ? previousLevel
            : (Number.isFinite(currentLevel) ? currentLevel - 1 : null);

        const baseContext = await prepareBasePromptContext({ locationOverride: locationObj || null });

        const levelUpLine = `[system] ${trimmedName} advanced ${Number.isFinite(priorLevel) ? `from level ${priorLevel} ` : ''}to level ${Number.isFinite(currentLevel) ? currentLevel : 'unknown'}.`;
        const baseHistoryText = typeof baseContext?.gameHistory === 'string' ? baseContext.gameHistory.trim() : '';
        const gameHistory = baseHistoryText ? `${baseHistoryText}\n${levelUpLine}` : levelUpLine;

        const existingNpcSummaries = collectNpcSummariesForLevelUp({
            character,
            locationObj,
            regionObj,
            previousLevel: priorLevel
        });

        const activePlayer = Player.getCurrentPlayer?.() || currentPlayer || null;
        const currentPlayerContext = activePlayer ? {
            name: activePlayer.name || '',
            description: activePlayer.description || '',
            level: Number.isFinite(activePlayer.level) ? activePlayer.level : null,
            class: activePlayer.class || '',
            race: activePlayer.race || ''
        } : {
            name: '',
            description: '',
            level: null,
            class: '',
            race: ''
        };

        const promptTemplateBase = {
            ...baseContext,
            promptType: 'npc-generate-abilities-levelup',
            gameHistory,
            existingNpcSummaries,
            levelUpSummary: levelUpLine,
            character: {
                id: character.id || null,
                name: trimmedName,
                description: character.description || '',
                race: character.race || '',
                class: character.class || '',
                level: Number.isFinite(currentLevel) ? currentLevel : null,
                previousLevel: Number.isFinite(priorLevel) ? priorLevel : null
            },
            locationContext,
            regionContext,
            currentPlayer: currentPlayerContext
        };

        let renderedTemplate;
        try {
            renderedTemplate = promptEnv.render('base-context.xml.njk', promptTemplateBase);
        } catch (error) {
            console.warn(`Failed to render level-up ability template for ${trimmedName}:`, error?.message || error);
            return;
        }

        let parsedTemplate;
        try {
            parsedTemplate = parseXMLTemplate(renderedTemplate);
        } catch (error) {
            console.warn(`Failed to parse level-up ability template for ${trimmedName}:`, error?.message || error);
            return;
        }

        const systemPrompt = parsedTemplate.systemPrompt;
        const generationPrompt = parsedTemplate.generationPrompt;
        if (!systemPrompt || !generationPrompt) {
            console.warn(`Level-up ability template missing prompts for ${trimmedName}.`);
            return;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        const requestStart = Date.now();
        let abilityResponse = '';
        try {
            abilityResponse = await LLMClient.chatCompletion({
                messages,
                temperature: parsedTemplate.temperature,
                metadataLabel: 'levelup_abilities'
            });
            if (!abilityResponse || !abilityResponse.trim()) {
                console.warn(`Level-up ability generation returned no choices for ${trimmedName}.`);
                return;
            }
        } catch (error) {
            console.warn(`Level-up ability generation request failed for ${trimmedName}:`, error?.message || error);
            return;
        }
        const durationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logsDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const timestamp = Date.now();
            const safeId = typeof character.id === 'string' ? character.id.replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
            const safeName = trimmedName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
            const logFilename = `levelup_abilities_${timestamp}_${safeId}_${safeName}.log`;
            const logPath = path.join(logsDir, logFilename);
            const logLines = [
                formatDurationLine(durationSeconds),
                `Character: ${trimmedName}`,
                `Previous Level: ${Number.isFinite(priorLevel) ? priorLevel : 'unknown'}`,
                `New Level: ${Number.isFinite(currentLevel) ? currentLevel : 'unknown'}`,
                '=== LEVEL-UP ABILITIES SYSTEM PROMPT ===',
                systemPrompt,
                '',
                '=== LEVEL-UP ABILITIES GENERATION PROMPT ===',
                generationPrompt,
                '',
                '=== LEVEL-UP ABILITIES RESPONSE ===',
                abilityResponse,
                ''
            ];
            fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
        } catch (logError) {
            console.warn(`Failed to log level-up abilities prompt for ${trimmedName}:`, logError?.message || logError);
        }

        const assignments = parseNpcAbilityAssignments(abilityResponse);
        if (!assignments || !(assignments instanceof Map)) {
            console.warn(`Unable to parse level-up abilities for ${trimmedName}.`);
            return;
        }

        const normalizedName = trimmedName.toLowerCase();
        const assignmentEntry = assignments.get(normalizedName);
        if (!assignmentEntry || !Array.isArray(assignmentEntry.abilities) || assignmentEntry.abilities.length === 0) {
            console.warn(`No ability assignments found for ${trimmedName} in level-up response.`);
            return;
        }

        const currentAbilities = typeof character.getAbilities === 'function'
            ? character.getAbilities()
            : [];
        const existingNames = new Set(
            currentAbilities
                .map(ability => typeof ability.name === 'string' ? ability.name.trim().toLowerCase() : null)
                .filter(Boolean)
        );

        const filteredAbilities = assignmentEntry.abilities.filter(ability => {
            if (!ability || typeof ability.name !== 'string') {
                return false;
            }
            const abilityName = ability.name.trim();
            if (!abilityName) {
                return false;
            }
            const abilityLevel = Number(ability.level);
            if (Number.isFinite(currentLevel) && Number.isFinite(abilityLevel) && abilityLevel > currentLevel) {
                return false;
            }
            return true;
        });

        const additions = [];
        for (const ability of filteredAbilities) {
            const abilityName = ability.name.trim();
            const nameKey = abilityName.toLowerCase();
            if (existingNames.has(nameKey)) {
                continue;
            }
            const abilityLevel = Number(ability.level);
            if (!Number.isFinite(abilityLevel) || abilityLevel <= 0) {
                ability.level = Number.isFinite(currentLevel) ? currentLevel : 1;
            }
            additions.push({ ...ability, name: abilityName });
            existingNames.add(nameKey);
        }

        if (!additions.length) {
            console.log(`Level-up abilities for ${trimmedName} produced no new entries.`);
            return;
        }

        const mergedAbilities = [...currentAbilities, ...additions];
        mergedAbilities.sort((a, b) => {
            const levelA = Number(a.level) || 0;
            const levelB = Number(b.level) || 0;
            if (levelA !== levelB) {
                return levelA - levelB;
            }
            const nameA = typeof a.name === 'string' ? a.name.toLowerCase() : '';
            const nameB = typeof b.name === 'string' ? b.name.toLowerCase() : '';
            return nameA.localeCompare(nameB);
        });

        if (typeof character.setAbilities === 'function') {
            character.setAbilities(mergedAbilities);
            const addedCount = additions.length;
            const levelLabel = Number.isFinite(currentLevel) ? currentLevel : character.level;
            console.log(`🎓 Added ${addedCount} new abilit${addedCount === 1 ? 'y' : 'ies'} for ${trimmedName} (Level ${levelLabel}).`);
        }
    })();

    levelUpAbilityPromises.set(characterKey, abilityPromise);

    try {
        await abilityPromise;
        console.log(`Completed level-up ability generation for ${trimmedName}.`);
    } catch (error) {
        console.warn(`Error during level-up ability generation for ${trimmedName}:`, error?.message || error);
        console.debug(error);
    } finally {
        levelUpAbilityPromises.delete(characterKey);
    }

    return abilityPromise;
}

Globals.generateLevelUpAbilitiesForCharacter = generateLevelUpAbilitiesForCharacter;

function parseInventoryItems(xmlContent) {
    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const collectTags = ['item', 'scenery', 'thing'];
        const itemNodes = collectTags.flatMap(tag => Array.from(doc.getElementsByTagName(tag)));
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

            const itemOrSceneryNode = node.getElementsByTagName('itemOrScenery')[0];
            const itemOrScenery = itemOrSceneryNode ? itemOrSceneryNode.textContent.trim().toLowerCase() : '';

            const item = {
                name: nameNode.textContent.trim(),
                description: node.getElementsByTagName('description')[0]?.textContent?.trim() || '',
                type: node.getElementsByTagName('type')[0]?.textContent?.trim() || 'item',
                slot: node.getElementsByTagName('slot')[0]?.textContent?.trim() || '',
                rarity: node.getElementsByTagName('rarity')[0]?.textContent?.trim() || getDefaultRarityLabel(),
                value: node.getElementsByTagName('value')[0]?.textContent?.trim() || '0',
                weight: node.getElementsByTagName('weight')[0]?.textContent?.trim() || '0',
                properties: node.getElementsByTagName('properties')[0]?.textContent?.trim() || '',
                relativeLevel,
                thingType: itemOrScenery,
                itemOrScenery,
                attributeBonuses,
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

function getBannedNpcRegexes() {
    if (Array.isArray(cachedBannedNpcRegexes)) {
        return cachedBannedNpcRegexes;
    }

    cachedBannedNpcRegexes = [];

    try {
        const raw = fs.readFileSync(BANNED_NPC_NAMES_PATH, 'utf8');
        const parsed = yaml.load(raw) || {};
        const regexes = Array.isArray(parsed.banned_npc_name_regexes) ? parsed.banned_npc_name_regexes : [];
        for (const regexStr of regexes) {
            if (typeof regexStr !== 'string') {
                continue;
            }
            const sanitized = regexStr.trim();
            if (!sanitized) {
                continue;
            }
            let pattern = sanitized;
            let flags = '';
            const match = sanitized.match(/^\/(.*)\/([a-z]*)$/i);
            if (match) {
                pattern = match[1];
                flags = match[2] || '';
            }
            if (!pattern) {
                continue;
            }
            try {
                const regex = new RegExp(pattern, flags);
                cachedBannedNpcRegexes.push(regex);
            } catch (regexError) {
                console.warn('Invalid banned NPC name regex:', regexStr, regexError.message);
            }
        }
    } catch (error) {
        console.warn('Failed to load banned NPC name regexes:', error.message);
    }

    return cachedBannedNpcRegexes;
}

function getBannedLocationNameSet() {
    if (cachedBannedLocationNames instanceof Set) {
        return cachedBannedLocationNames;
    }

    try {
        const raw = fs.readFileSync(BANNED_LOCATION_NAMES_PATH, 'utf8');
        const parsed = yaml.load(raw) || {};
        const names = Array.isArray(parsed.banned_location_names)
            ? parsed.banned_location_names
            : [];
        cachedBannedLocationNames = new Set(
            names
                .map(entry => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
                .filter(Boolean)
        );
    } catch (error) {
        console.warn('Failed to load banned location names:', error.message);
        cachedBannedLocationNames = new Set();
    }

    return cachedBannedLocationNames;
}

function isLocationNameBanned(name, bannedSet = getBannedLocationNameSet()) {
    if (!name || typeof name !== 'string' || !(bannedSet instanceof Set) || bannedSet.size === 0) {
        return false;
    }

    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
        return false;
    }

    for (const banned of bannedSet) {
        if (!banned) {
            continue;
        }
        if (normalizedName.includes(banned)) {
            return true;
        }
    }

    return false;
}

async function ensureLocationNameAllowed(location, { maxAttempts = 3 } = {}) {
    if (!location || typeof location !== 'object') {
        return;
    }

    const bannedSet = getBannedLocationNameSet();
    if (!(bannedSet instanceof Set) || bannedSet.size === 0) {
        return;
    }

    const originalName = typeof location.name === 'string' ? location.name : '';
    let attempts = 0;
    while (attempts < maxAttempts && isLocationNameBanned(location.name, bannedSet)) {
        attempts += 1;
        try {
            await regenerateLocationName(location);
        } catch (error) {
            console.warn(`Failed to regenerate name for location ${location.name || location.id}:`, error.message);
            break;
        }
    }

    if (isLocationNameBanned(location.name, bannedSet)) {
        console.warn(`Location "${location.name}" (${location.id || 'unknown id'}) remains on the banned list after ${attempts} attempt(s).`);
    }

    if (location.stubMetadata && typeof location.stubMetadata === 'object'
        && location.stubMetadata.targetRegionName
        && typeof location.name === 'string'
        && location.name !== originalName) {
        location.stubMetadata.targetRegionName = location.name;
    }
}

async function ensureRegionNameAllowed(region, { maxAttempts = 3 } = {}) {
    if (!region || typeof region !== 'object') {
        return;
    }

    const bannedSet = getBannedLocationNameSet();
    if (!(bannedSet instanceof Set) || bannedSet.size === 0) {
        return;
    }

    let attempts = 0;
    while (attempts < maxAttempts && isLocationNameBanned(region.name, bannedSet)) {
        attempts += 1;
        try {
            await regenerateRegionName(region);
        } catch (error) {
            console.warn(`Failed to regenerate name for region ${region.name || region.id}:`, error.message);
            break;
        }
    }

    if (isLocationNameBanned(region.name, bannedSet)) {
        console.warn(`Region "${region.name}" (${region.id || 'unknown id'}) remains on the banned list after ${attempts} attempt(s).`);
    }

    if (pendingRegionStubs.has(region.id)) {
        const pending = pendingRegionStubs.get(region.id);
        if (pending && typeof region.name === 'string') {
            pending.name = region.name;
        }
    }
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

function normalizeNpcName(name) {
    return typeof name === 'string' ? name.trim() : '';
}

function normalizeNameForComparison(name) {
    const normalized = normalizeNpcName(name);
    return normalized ? normalized.toLowerCase() : '';
}

function isNpcNameAllowed(name, { bannedWords = getBannedNpcWords(), bannedRegexes = getBannedNpcRegexes(), forbiddenNames = null } = {}) {
    const normalized = normalizeNpcName(name);
    if (!normalized) {
        return false;
    }

    if (npcNameContainsBannedWord(normalized, bannedWords)) {
        return false;
    }

    // It's case sensitive, so we don't normalize it.
    for (const regex of bannedRegexes) {
        if (regex.test(name)) {
            console.log(`NPC name "${name}" rejected by banned regex: ${regex.toString()}`);
            return false;
        }
    }

    if (forbiddenNames instanceof Set) {
        const comparison = normalized.toLowerCase();
        if (comparison && forbiddenNames.has(comparison)) {
            return false;
        }
    } else if (Array.isArray(forbiddenNames)) {
        const comparison = normalized.toLowerCase();
        for (const entry of forbiddenNames) {
            if (typeof entry === 'string' && entry.trim().toLowerCase() === comparison) {
                return false;
            }
        }
    }

    return true;
}

function applyNpcNameTemplate(template, name) {
    if (typeof template !== 'string' || !template.trim()) {
        return null;
    }
    return template.includes('%NAME%')
        ? template.split('%NAME%').join(name)
        : template;
}

function pullRegeneratedNpcEntry(mapping, name) {
    if (!mapping || typeof mapping.get !== 'function') {
        return null;
    }
    const key = normalizeNameForComparison(name);
    if (!key) {
        return null;
    }
    const bucket = mapping.get(key);
    if (!Array.isArray(bucket) || bucket.length === 0) {
        return null;
    }
    const entry = bucket.shift();
    if (!bucket.length) {
        mapping.delete(key);
    }
    return entry;
}

function selectFirstAllowedNpcName(candidates, { bannedWords = getBannedNpcWords(), bannedRegexes = getBannedNpcRegexes(), forbiddenNames = null } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        if (isNpcNameAllowed(candidate, { bannedWords, bannedRegexes, forbiddenNames })) {
            return normalizeNpcName(candidate);
        }
    }
    return null;
}

function formatDurationLine(durationSeconds) {
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
        return `=== API CALL DURATION: ${durationSeconds.toFixed(3)}s ===`;
    }
    return '=== API CALL DURATION: N/A ===';
}

function clampLevel(value, fallback = 1) {
    if (!Number.isFinite(value)) {
        console.warn(`clampLevel: Invalid level value "${value}", using fallback ${fallback}.`);
        console.trace();
        return fallback;
    }
    return Math.max(1, Math.round(value));
}

function roundAwayFromZero(value) {
    if (!Number.isFinite(value) || value === 0) {
        return 0;
    }
    return value > 0 ? Math.ceil(value) : Math.floor(value);
}

function scaleAttributeBonusesForItem(rawBonuses, { level = 1, rarity = null } = {}) {
    if (!Array.isArray(rawBonuses) || !rawBonuses.length) {
        return [];
    }

    const normalizedEntries = [];
    for (const entry of rawBonuses) {
        if (!entry) {
            continue;
        }
        let attribute = null;
        let bonusValue = null;

        if (typeof entry === 'string') {
            attribute = entry.trim();
        } else if (typeof entry === 'object') {
            if (typeof entry.attribute === 'string') {
                attribute = entry.attribute.trim();
            } else if (typeof entry.name === 'string') {
                attribute = entry.name.trim();
            }
            const bonusRaw = entry.bonus ?? entry.value;
            const parsed = Number(bonusRaw);
            if (Number.isFinite(parsed)) {
                bonusValue = parsed;
            }
        }

        if (!attribute) {
            continue;
        }

        if (!Number.isFinite(bonusValue)) {
            const fallback = Number(entry?.bonus ?? entry?.value);
            bonusValue = Number.isFinite(fallback) ? fallback : 0;
        }

        normalizedEntries.push({
            attribute,
            bonus: bonusValue
        });
    }

    if (!normalizedEntries.length) {
        return [];
    }

    /*
    const effectiveLevel = Number.isFinite(level) && level > 0 ? level : 1;
    const rarityMultiplier = Thing.getRarityAttributeMultiplier(rarity);
    const rarityBonus = Thing.getRarityAttributeBonus(rarity);
    const effectiveMultiplier = Number.isFinite(rarityMultiplier) && rarityMultiplier > 0 ? rarityMultiplier : 1;
    const factor = 0.5 * effectiveLevel * effectiveMultiplier;
    */

    return normalizedEntries.map(({ attribute, bonus }) => {
        const finalBonus = Thing.getMaxAttributeBonus(rarity, level) * bonus / 4;
        const rounded = roundAwayFromZero(finalBonus);

        return { attribute, bonus: rounded };
    });
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
        console.warn('renderNpcNameRegenPrompt: No regeneration candidates provided.');
        console.trace();
        return null;
    }

    try {
        const rendered = promptEnv.render('npc-name-regen.xml.njk', {
            existingNpcs: existingNpcSummaries,
            npcsToRegenerateName: regenerationCandidates,
            bannedWords: getBannedNpcWords()
        });

        const parsed = parseXMLTemplate(rendered);
        return parsed.generationPrompt || null;
    } catch (error) {
        console.warn('Failed to render NPC name regeneration prompt:', error.message);
        return null;
    }
}

async function enforceBannedNpcNames({
    npcDataList,
    existingNames,
    conversationMessages
} = {}) {
    if (!Array.isArray(npcDataList) || !npcDataList.length) {
        console.warn('enforceBannedNpcNames: No NPC data provided.');
        console.trace();
        return npcDataList;
    }

    console.log("NPC Data List for Name Enforcement:", npcDataList);

    const bannedWords = getBannedNpcWords();
    const bannedRegexes = getBannedNpcRegexes();

    if (!bannedWords.length && !bannedRegexes.length) {
        console.log('enforceBannedNpcNames: No banned words or regexes defined.');
        return npcDataList;
    }

    // Get the list of names being checked
    const namesBeingChecked = new Set();
    npcDataList.forEach(npc => {
        if (npc?.name) {
            namesBeingChecked.add(npc.name);
            npc.originalName = npc.name; // Preserve original name for fallback
        }
    });

    console.log("enforceBannedNpcNames: Checking NPC names:", Array.from(namesBeingChecked));
    console.log("enforceBannedNpcNames: Existing NPC names:", existingNames);

    const isNameValid = (name) => {
        if (!name || typeof name !== 'string') return false;

        const trimmedName = name.trim();
        if (!trimmedName) return false;

        const lowerName = trimmedName.toLowerCase();

        // Check banned words
        if (bannedWords.length && npcNameContainsBannedWord(lowerName, bannedWords)) {
            console.log(`NPC name "${trimmedName}" rejected due to banned word.`);
            return false;
        }

        // Check banned regexes
        for (const regex of bannedRegexes) {
            if (regex.test(trimmedName)) {
                console.log(`NPC name "${trimmedName}" rejected by banned regex: ${regex.toString()}`);
                return false;
            }
        }

        // Check duplicates (excluding self)
        if (existingNames.has(lowerName)) {
            console.log(`NPC name "${trimmedName}" rejected due to duplicate name.`);
            return false;
        }

        return true;
    };

    let attempts = 2;

    while (attempts > 0) {
        // Loop through namesBeingChecked
        // If they are valid, add them to existingNames and remove them from namesBeingChecked
        namesBeingChecked.forEach(name => {
            if (isNameValid(name)) {
                existingNames.add(name);
                namesBeingChecked.delete(name);
            }
        });

        if (namesBeingChecked.size === 0) {
            console.log("All NPC names are valid.");
            return npcDataList;
        }

        console.log(`NPC name regeneration attempts remaining: ${attempts}`);
        attempts--;

        // Prepare context for regeneration

        console.log("Names needing regeneration:", Array.from(namesBeingChecked));

        const npcContexts = npcDataList
            .filter(npc => namesBeingChecked.has(npc.name))
            .map(npc => ({
                originalName: npc.originalName,
                shortDescription: npc.shortDescription || '',
                description: npc.description || '',
                race: npc.race || '',
                gender: npc.gender || '',
            }));

        console.log("NPC contexts for regeneration:", npcContexts);

        const existingNpcs = Player.getByNames(existingNames);

        console.log("Existing names after filtering:", existingNames.keys().join(', '));
        console.log("Existing NPCs for context:", existingNpcs.join(', '));

        // Render regeneration prompt
        const prompt = renderNpcNameRegenPrompt({
            existingNpcSummaries: existingNpcs,
            regenerationCandidates: npcContexts
        });

        if (!prompt) {
            console.warn('Failed to render NPC name regeneration prompt');
            break;
        }

        const messages = Array.isArray(conversationMessages)
            ? [...conversationMessages, { role: 'user', content: prompt }]
            : [{ role: 'user', content: prompt }];


        const requestStart = Date.now();
        const regenResponse = await LLMClient.chatCompletion({
            messages,
            temperature: 1,
            metadataLabel: 'npc_name_regen'
        });

        const durationSeconds = (Date.now() - requestStart) / 1000;

        // Log the interaction
        try {
            logNpcNameRegeneration({
                prompt,
                responseText: regenResponse,
                durationSeconds
            });
        } catch (logError) {
            console.warn('Failed to log NPC name regeneration:', logError.message);
        }

        // Process the regeneration prompt
        let regeneratedNames = await parseNpcNameRegenResponse(regenResponse);
        if (!regeneratedNames.size) {
            console.warn('No regenerated names returned from LLM.');
            console.log('regeneratedNames:', regeneratedNames);
            console.trace();
            break;
        }

        console.log("Regenerated NPC names:", regeneratedNames);
        regeneratedNames = Array.from(regeneratedNames.values());

        // Update the NPC data with the new names
        regeneratedNames.forEach(newName => {
            newName = newName[0];
            console.log("Processing regenerated name:", newName);

            let candidates = newName.candidates;
            console.log("Initial candidates:", candidates);

            // Find the NPC in npcDataList
            const npc = npcDataList.find(npcEntry =>
                npcEntry.name.toLowerCase() === newName.originalName.toLowerCase()
            );

            // Remove all non-valid names from candidates
            candidates = candidates.filter(candidate =>
                isNpcNameAllowed(candidate)
            );

            if (candidates.length === 0) {
                console.log(`No valid candidates found for NPC: "${npc.name}" after filtering.`);
            } else {
                console.log(`Updating NPC "${npc.name}" with new name: "${candidates[0]}"`);
                const oldName = npc.name;
                npc.name = candidates[0];
                // replace %NAME$ in description
                if (newName.shortTemplate) {
                    npc.shortDescription = newName.shortTemplate;
                }
                if (newName.descriptionTemplate) {
                    npc.description = newName.descriptionTemplate;
                }

                // Add the new name to existingNames to prevent duplicates
                existingNames.add(npc.name.toLowerCase());
                // Remove from namesBeingChecked
                namesBeingChecked.delete(oldName);
            }

        });
    }

    // Final validation - fall back to original names for any invalid ones
    npcDataList.forEach(npc => {
        if (!isNameValid(npc.name)) {
            console.log(`Falling back to original name for NPC: "${npc.originalName}"`);
            npc.name = npc.originalName;
        }
    });

    return npcDataList;
}
// Final validation - fall back to original names for any invalid ones

/*
// Get existing names (excluding current NPCs being processed)
const existingNames = new Set();
const existingSummaries = Array.isArray(existingNpcSummaries) ? existingNpcSummaries : [];

// Add names from existing summaries
existingSummaries.forEach(summary => {
    if (summary?.name) {
        existingNames.add(summary.name.toLowerCase());
    }
});

// Add names from all players except those being processed
const npcIdsBeingProcessed = new Set(
    npcDataList.map(npc => npc?.tempId || npc?.name).filter(Boolean)
);

Player.getAll().forEach(npc => {
    if (npc?.isNPC && npc?.name && !npcIdsBeingProcessed.has(npc.id)) {
        existingNames.add(npc.name.toLowerCase());
    }
});

// Helper to check if a name passes all validation rules
const isNameValid = (name) => {
    if (!name || typeof name !== 'string') return false;

    const trimmedName = name.trim();
    if (!trimmedName) return false;

    const lowerName = trimmedName.toLowerCase();

    // Check banned words
    if (bannedWords.length && npcNameContainsBannedWord(trimmedName, bannedWords)) {
        return false;
    }

    // Check banned regexes
    for (const regex of bannedRegexes) {
        if (regex.test(trimmedName)) {
            return false;
        }
    }

    // Check duplicates (excluding self)
    if (existingNames.has(lowerName)) {
        return false;
    }

    return true;
};

// Create a copy to work with, preserving original names
const workingNpcs = npcDataList.map((npc, index) => ({
    ...npc,
    originalName: originalNames.get(index) || npc.name
}));

// Filter out NPCs that need regeneration
const npcsNeedingRegen = workingNpcs.filter(npc => !isNameValid(npc.name));

if (!npcsNeedingRegen.length) {
    return workingNpcs;
}

let attempts = 0;
const maxAttempts = 3;

while (attempts < maxAttempts && npcsNeedingRegen.some(npc => !isNameValid(npc.name))) {
    attempts++;
    console.log(`NPC name regeneration attempt ${attempts}/${maxAttempts}`);

    // Prepare context for regeneration
    const npcContexts = npcsNeedingRegen.map(npc => ({
        originalName: npc.originalName,
        shortDescription: npc.shortDescription || '',
        description: npc.description || ''
    }));

    // Collect all existing NPCs for context (excluding those being regenerated)
    const allExistingNpcs = Player.getAll()
        .filter(p => p.isNPC && !npcIdsBeingProcessed.has(p.id))
        .map(p => ({
            name: p.name,
            shortDescription: p.shortDescription || '',
            description: p.description || ''
        }));

    // Add already-valid NPCs from current batch to context
    workingNpcs.forEach(npc => {
        if (isNameValid(npc.name)) {
            allExistingNpcs.push({
                name: npc.name,
                shortDescription: npc.shortDescription || '',
                description: npc.description || ''
            });
        }
    });

    // Render regeneration prompt
    const prompt = renderNpcNameRegenPrompt({
        existingNpcs: allExistingNpcs,
        regenerationCandidates: npcContexts
    });

    if (!prompt) {
        console.warn('Failed to render NPC name regeneration prompt');
        break;
    }

    const messages = Array.isArray(conversationMessages)
        ? [...conversationMessages, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];

    try {
        const requestStart = Date.now();
        const regenResponse = await LLMClient.chatCompletion({
            messages,
            temperature: 1,
            metadataLabel: 'npc_name_regen'
        });

        const durationSeconds = (Date.now() - requestStart) / 1000;

        // Log the interaction
        try {
            logNpcNameRegeneration({
                prompt,
                responseText: regenResponse,
                durationSeconds
            });
        } catch (logError) {
            console.warn('Failed to log NPC name regeneration:', logError.message);
        }

        // Parse and apply new names
        const mapping = parseNpcNameRegenResponse(regenResponse);

        if (mapping.size > 0) {
            npcsNeedingRegen.forEach(npc => {
                const newNameInfo = pullRegeneratedNpcEntry(mapping, npc.originalName);

                if (newNameInfo?.candidates?.length > 0) {
                    for (const candidate of newNameInfo.candidates) {
                        if (isNameValid(candidate)) {
                            npc.name = candidate;

                            if (newNameInfo.shortTemplate) {
                                npc.shortDescription = applyNpcNameTemplate(
                                    newNameInfo.shortTemplate,
                                    candidate
                                );
                            }
                            if (newNameInfo.descriptionTemplate) {
                                npc.description = applyNpcNameTemplate(
                                    newNameInfo.descriptionTemplate,
                                    candidate
                                );
                            }

                            existingNames.add(candidate.trim().toLowerCase());
                            break;
                        }
                    }
                }
            });
        }

    } catch (error) {
        console.warn('NPC name regeneration request failed:', error.message);
        break;
    }
}

// Final validation - fall back to original names for any invalid ones
workingNpcs.forEach(npc => {
    if (!isNameValid(npc.name)) {
        console.log(`Falling back to original name for NPC: "${npc.originalName}"`);
        npc.name = npc.originalName;
    }
});

return workingNpcs;
 
}
*/
// Helper function to parse regeneration response
function parseNpcNameRegenResponse(xmlContent) {
    const mapping = new Map();

    if (!xmlContent || typeof xmlContent !== 'string') {
        return mapping;
    }

    try {
        const doc = Utils.parseXmlDocument(`<root>${xmlContent}</root>`, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];

        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const npcNodes = Array.from(doc.getElementsByTagName('npc'));

        for (const node of npcNodes) {
            const oldNameNode = node.getElementsByTagName('oldName')[0];
            const oldName = oldNameNode ? oldNameNode.textContent?.trim() : null;
            const normalizedKey = normalizeNameForComparison(oldName);

            if (!normalizedKey) {
                continue;
            }

            const candidates = [];
            const nameNodes = Array.from(node.getElementsByTagName('name'));

            for (const nameNode of nameNodes) {
                const name = normalizeNpcName(nameNode.textContent);
                if (name) {
                    candidates.push(name);
                }
            }

            if (!candidates.length) {
                continue;
            }

            // Shuffle candidates to add randomness
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }

            const shortTemplate = node.getElementsByTagName('shortDescription')[0]?.textContent?.trim() || '';
            const descriptionTemplate = node.getElementsByTagName('description')[0]?.textContent?.trim() || '';

            const entry = {
                originalName: normalizeNpcName(oldName),
                candidates,
                shortTemplate,
                descriptionTemplate
            };

            if (!mapping.has(normalizedKey)) {
                mapping.set(normalizedKey, []);
            }
            mapping.get(normalizedKey).push(entry);
        }
    } catch (error) {
        console.warn('Failed to parse NPC name regeneration response:', error.message);
    }

    return mapping;
}

function collectNpcSummariesForNameEnforcement({ location = null, region = null, excludeNpcIds = [] } = {}) {
    const summaries = [];
    const exclusionSet = new Set();

    if (Array.isArray(excludeNpcIds)) {
        for (const id of excludeNpcIds) {
            if (id) {
                exclusionSet.add(id);
            }
        }
    } else if (excludeNpcIds) {
        exclusionSet.add(excludeNpcIds);
    }

    const seenIds = new Set(exclusionSet);
    const addNpcById = (npcId) => {
        if (!npcId || seenIds.has(npcId)) {
            return;
        }
        const npc = players.get(npcId);
        if (!npc || !npc.isNPC) {
            return;
        }
        seenIds.add(npcId);
        const summary = summarizeNpcForNameRegen(npc);
        if (summary) {
            summaries.push(summary);
        }
    };

    /*
    if (location && Array.isArray(location.npcIds)) {
        location.npcIds.forEach(addNpcById);
    }
    */

    if (region && Array.isArray(region.locationIds)) {
        for (const locId of region.locationIds) {
            if (location && locId === location.id) {
                continue;
            }
            const loc = gameLocations.get(locId);
            if (!loc || !Array.isArray(loc.npcIds)) {
                continue;
            }
            loc.npcIds.forEach(addNpcById);
        }
    }

    return summaries;
}

async function enforceBannedNpcNameForPlayer({
    npc,
    location = null,
    region = null,
    existingNames,
    conversationMessages = []
} = {}) {
    if (!npc || typeof npc !== 'object' || typeof npc.name !== 'string') {
        throw new Error('NPC instance with a valid name is required for banned name enforcement');
    }

    if (!npc.isNPC) {
        return npc;
    }

    const bannedWords = getBannedNpcWords();
    if (!bannedWords.length) {
        return npc;
    }

    if (isNpcNameAllowed(npc.name, { bannedWords })) {
        return npc;
    }

    const resolvedConversation = Array.isArray(conversationMessages) ? conversationMessages : [];

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        throw new Error('Missing AI configuration for NPC name enforcement');
    }

    let summaries = Array.isArray(existingNpcSummaries)
        ? existingNpcSummaries.filter(Boolean)
        : null;

    if (!summaries || !summaries.length) {
        summaries = collectNpcSummariesForNameEnforcement({
            location,
            region,
            excludeNpcIds: [npc.id]
        });
    }

    if (!summaries.length) {
        Player.getAll().forEach(existing => {
            if (!existing || !existing.isNPC || existing.id === npc.id) {
                return;
            }
            const summary = summarizeNpcForNameRegen(existing);
            if (summary) {
                summaries.push(summary);
            }
        });
    }

    const npcDataList = [{
        name: npc.name,
        shortDescription: typeof npc.shortDescription === 'string' ? npc.shortDescription : '',
        description: typeof npc.description === 'string' ? npc.description : '',
        role: typeof npc.role === 'string' ? npc.role : (typeof npc.class === 'string' ? npc.class : ''),
        class: typeof npc.class === 'string' ? npc.class : '',
        race: typeof npc.race === 'string' ? npc.race : ''
    }];

    const [result] = await enforceBannedNpcNames({
        npcDataList,
        existingNames,
        conversationMessages: resolvedConversation
    });

    if (!result || typeof result.name !== 'string' || !result.name.trim()) {
        throw new Error(`NPC name enforcement failed for ${npc.name}`);
    }

    if (!isNpcNameAllowed(result.name, { bannedWords })) {
        throw new Error(`NPC name enforcement produced another banned name for ${npc.name}`);
    }

    const trimmedName = result.name.trim();
    if (trimmedName !== npc.name) {
        npc.setName(trimmedName);
    }

    if (typeof result.shortDescription === 'string' && result.shortDescription.trim()) {
        npc.shortDescription = result.shortDescription.trim();
    }

    if (typeof result.description === 'string' && result.description.trim()) {
        npc.description = result.description.trim();
    }

    return npc;
}

// Redundant
//TODO: deduplicate with enforceBannedNpcNames
/* 
async function ensureUniqueNpcNames({
    npcDataList,
    existingNpcSummaries,
    conversationMessages
} = {}) {
    if (!Array.isArray(npcDataList) || !npcDataList.length) {
        return npcDataList;
    }

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        return npcDataList;
    }

    const workingList = npcDataList.map(npc => ({ ...npc }));

    const baseMessages = Array.isArray(conversationMessages) ? [...conversationMessages] : [];
    const bannedWords = getBannedNpcWords();

    const rebuildNameSet = () => {
        const nameSet = new Map();
        for (const npc of Player.getAll()) {
            if (!npc || !npc.isNPC || typeof npc.name !== 'string') {
                continue;
            }
            const key = npc.name.trim().toLowerCase();
            if (!key) {
                continue;
            }
            if (!nameSet.has(key)) {
                nameSet.set(key, []);
            }
            nameSet.get(key).push(npc.name);
        }
        return nameSet;
    };

    let existingNameSet = rebuildNameSet();

    let attempts = 0;
    while (attempts < 2) {
        attempts += 1;
        const seenNew = new Map();
        const duplicates = [];

        for (const npc of workingList) {
            if (!npc || typeof npc.name !== 'string') {
                continue;
            }
            const trimmed = npc.name.trim();
            if (!trimmed) {
                continue;
            }
            const key = trimmed.toLowerCase();
            const seenCount = seenNew.get(key) || 0;
            const hasExisting = existingNameSet.has(key);
            if (hasExisting || seenCount > 0) {
                duplicates.push(npc);
            }
            seenNew.set(key, seenCount + 1);
        }

        if (!duplicates.length) {
            break;
        }

        const contextMap = new Map();
        const addContext = (summary) => {
            if (!summary || !summary.name) {
                return;
            }
            const key = summary.name.trim().toLowerCase();
            if (!key) {
                return;
            }
            if (!contextMap.has(key)) {
                contextMap.set(key, summary);
            }
        };

        if (Array.isArray(existingNpcSummaries)) {
            existingNpcSummaries.forEach(addContext);
        }

        Player.getAll().forEach(npc => addContext(summarizeNpcForNameRegen(npc)));
        workingList.forEach(npc => addContext({
            name: npc?.name,
            shortDescription: npc?.shortDescription || '',
            detailedDescription: npc?.description || ''
        }));

        const regenerationCandidates = duplicates.map(npc => ({
            name: npc.name,
            shortDescription: npc.shortDescription || '',
            detailedDescription: npc.description || ''
        }));

        const prompt = renderNpcNameRegenPrompt({
            existingNpcSummaries: Array.from(contextMap.values()),
            regenerationCandidates
        });

        if (!prompt) {
            break;
        }

        const regenMessages = baseMessages.concat({ role: 'user', content: prompt });

        let regenText = '';
        let apiDurationSeconds = null;
        try {
            const requestStart = Date.now();
            regenText = await LLMClient.chatCompletion({
                messages: regenMessages,
                temperature: 1,
                metadataLabel: 'npc_name_regen_duplicate'
            });
            apiDurationSeconds = (Date.now() - requestStart) / 1000;
        } catch (error) {
            console.warn('NPC duplicate name regeneration failed:', error.message);
            break;
        }

        try {
            logNpcNameRegeneration({ prompt, responseText: regenText, durationSeconds: apiDurationSeconds });
        } catch (logError) {
            console.warn('Failed to log NPC duplicate name regeneration:', logError.message);
        }

        const mapping = parseNpcNameRegenResponse(regenText);
        if (!mapping.size) {
            attempts += 1;
            continue;
        }

        const baseForbiddenNames = new Set();
        existingNameSet.forEach((_, key) => {
            if (key) {
                baseForbiddenNames.add(key);
            }
        });
        for (const npc of workingList) {
            const normalized = normalizeNameForComparison(npc?.name);
            if (normalized) {
                baseForbiddenNames.add(normalized);
            }
        }

        let retryRequired = false;

        for (const npc of duplicates) {
            const entry = pullRegeneratedNpcEntry(mapping, npc.name);
            if (!entry) {
                retryRequired = true;
                continue;
            }

            const candidate = selectFirstAllowedNpcName(entry.candidates, {
                bannedWords,
                forbiddenNames: baseForbiddenNames
            });

            if (!candidate) {
                retryRequired = true;
                continue;
            }

            const shortDescription = applyNpcNameTemplate(entry.shortTemplate, candidate);
            const description = applyNpcNameTemplate(entry.descriptionTemplate, candidate);

            npc.name = candidate;
            if (shortDescription) {
                npc.shortDescription = shortDescription;
            }
            if (description) {
                npc.description = description;
            }

            const normalizedCandidate = normalizeNameForComparison(candidate);
            if (normalizedCandidate) {
                baseForbiddenNames.add(normalizedCandidate);
            }
        }

        existingNameSet = rebuildNameSet();
        workingList.forEach(npc => {
            const normalized = normalizeNameForComparison(npc?.name);
            if (!normalized) {
                return;
            }
            if (!existingNameSet.has(normalized)) {
                existingNameSet.set(normalized, [npc.name]);
            }
        });

        if (retryRequired) {
            attempts += 1;
            continue;
        }
        break;
    }

    return workingList;
}
*/
function computeNpcRenameMap(originalNames = [], updatedNpcs = []) {
    const renameMap = new Map();
    if (!Array.isArray(originalNames) || !Array.isArray(updatedNpcs)) {
        return renameMap;
    }

    const length = Math.min(originalNames.length, updatedNpcs.length);
    for (let index = 0; index < length; index += 1) {
        const originalName = typeof originalNames[index] === 'string'
            ? originalNames[index].trim()
            : '';
        const updatedName = typeof updatedNpcs[index]?.name === 'string'
            ? updatedNpcs[index].name.trim()
            : '';

        if (!originalName || !updatedName) {
            continue;
        }

        const originalKey = originalName.toLowerCase();
        const updatedKey = updatedName.toLowerCase();
        if (originalKey && updatedKey && originalKey !== updatedKey) {
            renameMap.set(originalKey, updatedKey);
        }
    }

    return renameMap;
}

function rekeyNpcLookupMap(sourceMap, renameMap) {
    if (!sourceMap || typeof sourceMap.entries !== 'function' || !renameMap || renameMap.size === 0) {
        return sourceMap;
    }

    const updated = new Map();
    for (const [key, value] of sourceMap.entries()) {
        const normalizedKey = typeof key === 'string' ? key.trim().toLowerCase() : '';
        if (!normalizedKey) {
            continue;
        }
        const replacement = renameMap.get(normalizedKey) || normalizedKey;
        updated.set(replacement, value);
    }

    return updated;
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
        const providedRarityList = context.rarityList || { items: {}, scenery: {} };
        const providedGeneratedRarity = context.generatedThingRarity;
        const generatedThingRarity = providedGeneratedRarity || Thing.generateRandomRarityDefinition();
        const itemCount = Number.isFinite(context.itemCount) ? Math.max(0, Math.round(context.itemCount)) : null;
        const sceneryCount = Number.isFinite(context.sceneryCount) ? Math.max(0, Math.round(context.sceneryCount)) : null;

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
            attributes: attributeNames,
            rarityDefinitions: Thing.getAllRarityDefinitions(),
            generatedThingRarity,
            rarityList: providedRarityList,
            itemCount,
            sceneryCount
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
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const itemNodes = Array.from(doc.getElementsByTagName('item'));
        // Also accept 'thing' and 'scenery' as top-level tags
        itemNodes.push(...Array.from(doc.getElementsByTagName('thing')));
        itemNodes.push(...Array.from(doc.getElementsByTagName('scenery')));

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

            const rawItemOrScenery = node.getElementsByTagName('itemOrScenery')[0]?.textContent?.trim();
            const fallbackKind = (() => {
                const tagName = typeof node.tagName === 'string' ? node.tagName.trim().toLowerCase() : '';
                if (tagName === 'scenery') return 'scenery';
                if (tagName === 'item' || tagName === 'thing') return 'item';
                return '';
            })();

            const entry = {
                name: nameNode.textContent.trim(),
                description: node.getElementsByTagName('description')[0]?.textContent?.trim() || '',
                itemOrScenery: rawItemOrScenery || fallbackKind,
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

async function generateLocationThingsForLocation({ location } = {}) {
    if (!location || typeof location.id !== 'string') {
        return [];
    }

    if (config.omit_item_generation) {
        return [];
    }

    const locationDescription = typeof location.description === 'string'
        ? location.description
        : (typeof location.getDetails === 'function' ? (location.getDetails().description || '') : '');

    if (!locationDescription || !locationDescription.trim()) {
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

    const hints = location.generationHints || {};
    const normalizeCount = (value, fallback, max = 5) => {
        if (Number.isFinite(value) && value >= 0) {
            return Math.max(0, Math.min(max, Math.round(value)));
        }
        return fallback;
    };

    const DEFAULT_ITEM_COUNT = 3;
    const rawItemCount = hints.numItems;
    const itemCount = normalizeCount(rawItemCount, DEFAULT_ITEM_COUNT);
    const defaultSceneryFallback = Math.max(0, Math.min(5, Math.round(itemCount / 2)));
    const rawSceneryCount = hints.numScenery;
    const sceneryCount = normalizeCount(rawSceneryCount, defaultSceneryFallback);

    const rarityCounters = {
        items: new Map(),
        scenery: new Map()
    };

    const incrementRarity = (category) => {
        const definition = Thing.generateRandomRarityDefinition();
        const fallbackKey = Thing.getDefaultRarityKey ? String(Thing.getDefaultRarityKey()).toLowerCase() : 'common';
        const key = definition?.key ? String(definition.key).toLowerCase() : fallbackKey;
        const counter = rarityCounters[category];
        counter.set(key, (counter.get(key) || 0) + 1);
    };

    for (let index = 0; index < itemCount; index += 1) {
        incrementRarity('items');
    }

    for (let index = 0; index < sceneryCount; index += 1) {
        incrementRarity('scenery');
    }

    const convertCounts = (map) => Object.fromEntries(Array.from(map.entries()));

    const rarityList = {
        items: convertCounts(rarityCounters.items),
        scenery: convertCounts(rarityCounters.scenery)
    };

    const parsedTemplate = renderLocationThingsPrompt({
        settingDescription: describeSettingForPrompt(settingSnapshot),
        region: region ? { name: region.name, description: region.description } : null,
        location: {
            name: location.name || 'Unknown Location',
            description: stripHtml(locationDescription) || locationDescription || 'No description provided.'
        },
        rarityList,
        itemCount,
        sceneryCount
    });

    if (!parsedTemplate || !parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
        return [];
    }

    const messages = [
        { role: 'system', content: parsedTemplate.systemPrompt },
        { role: 'user', content: parsedTemplate.generationPrompt }
    ];

    const requestStart = Date.now();
    const aiResponse = await LLMClient.chatCompletion({
        messages,
        temperature: parsedTemplate.temperature,
        metadataLabel: 'location_things_generation'
    });

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

        const scaledAttributeBonuses = thingType === 'item'
            ? scaleAttributeBonusesForItem(
                Array.isArray(itemData.attributeBonuses) ? itemData.attributeBonuses : [],
                { level: computedLevel, rarity: itemData.rarity }
            )
            : [];
        if (scaledAttributeBonuses.length) {
            metadata.attributeBonuses = scaledAttributeBonuses;
        }

        const cleanedMetadata = sanitizeMetadataObject(metadata);

        const thing = new Thing({
            name: itemData.name,
            description: itemData.description || 'An unspecified object.',
            thingType,
            rarity: itemData.rarity || null,
            itemTypeDetail: itemData.type || null,
            slot: itemData.slot || null,
            attributeBonuses: thingType === 'item' ? scaledAttributeBonuses : [],
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

    if (createdThings.length) {
        try {
            await ensureUniqueThingNames({ things: createdThings, location });
        } catch (error) {
            console.warn('Failed to enforce unique thing names for location generation:', error.message);
        }
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
        const hasNumSkills = Object.prototype.hasOwnProperty.call(context, 'numSkills');
        const requestedNumSkills = hasNumSkills ? context.numSkills : 20;
        return promptEnv.render(templateName, {
            settingDescription: context.settingDescription || 'A fantastical realm of adventure.',
            numSkills: requestedNumSkills,
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
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');

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

function logThingNameRegeneration({ prompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `thing_name_regen_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== THING NAME REGEN PROMPT ===',
            prompt || '(none)',
            '',
            '=== THING NAME REGEN RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log thing name regeneration:', error.message);
    }
}

function logLocationNameRegeneration({ prompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `location_name_regen_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== LOCATION NAME REGEN PROMPT ===',
            prompt || '(none)',
            '',
            '=== LOCATION NAME REGEN RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log location name regeneration:', error.message);
    }
}

function logRegionNameRegeneration({ prompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `region_name_regen_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== REGION NAME REGEN PROMPT ===',
            prompt || '(none)',
            '',
            '=== REGION NAME REGEN RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log region name regeneration:', error.message);
    }
}

function logChooseImportantMemories({ prompt, responseText, durationSeconds }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `choose_important_memories_${timestamp}.log`);
        const parts = [
            formatDurationLine(durationSeconds),
            '=== CHOOSE IMPORTANT MEMORIES PROMPT ===',
            prompt || '(none)',
            '',
            '=== CHOOSE IMPORTANT MEMORIES RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log choose_important_memories:', error.message);
    }
}

function rotateNameCandidates(names, rotationCount = 3) {
    if (!Array.isArray(names) || names.length === 0) {
        return Array.isArray(names) ? names.slice() : [];
    }

    const effectiveRotation = Math.min(Math.max(rotationCount, 0), names.length);
    if (effectiveRotation === 0 || effectiveRotation === names.length) {
        return names.slice();
    }

    return names.slice(effectiveRotation).concat(names.slice(0, effectiveRotation));
}

function parseThingNameRegenResponse(xmlContent) {
    const mapping = new Map();
    if (!xmlContent || typeof xmlContent !== 'string') {
        return mapping;
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent);
        }

        const itemNodes = Array.from(doc.getElementsByTagName('item'));
        for (const node of itemNodes) {
            const id = node.getElementsByTagName('id')[0]?.textContent?.trim() || null;
            const oldName = node.getElementsByTagName('oldName')[0]?.textContent?.trim() || null;
            const newName = node.getElementsByTagName('name')[0]?.textContent?.trim() || null;
            const description = node.getElementsByTagName('description')[0]?.textContent?.trim() || '';
            if (!newName) {
                continue;
            }
            const key = id || oldName;
            if (!key) {
                continue;
            }
            mapping.set(key, { id, oldName, newName, description });
        }
    } catch (error) {
        console.warn('Failed to parse thing name regeneration response:', error.message);
    }

    return mapping;
}

function parseLocationNameRegenResponse(xmlContent) {
    const names = [];
    if (!xmlContent || typeof xmlContent !== 'string') {
        return names;
    }

    try {
        const doc = Utils.parseXmlDocument(xmlContent, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent || 'Unknown XML parsing error');
        }

        const locationNodes = Array.from(doc.getElementsByTagName('locationNames'));
        for (const group of locationNodes) {
            const candidateNodes = Array.from(group.getElementsByTagName('name'));
            for (const node of candidateNodes) {
                const value = node?.textContent?.trim();
                if (value) {
                    names.push(value);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to parse location name regeneration response:', error.message);
    }

    return rotateNameCandidates(names);
}

async function ensureUniqueThingNames({ things: candidateThings = [], location = null, owner = null } = {}) {
    if (!Array.isArray(candidateThings) || !candidateThings.length) {
        return;
    }

    if (config?.deduplicate_item_names === false) {
        return;
    }

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        return;
    }

    const uniqueThings = candidateThings
        .filter(thing => thing && typeof thing === 'object' && typeof thing.id === 'string')
        .reduce((map, thing) => map.set(thing.id, thing), new Map());

    if (!uniqueThings.size) {
        return;
    }

    const nameGroups = new Map();
    for (const entry of Thing.getAll()) {
        if (!entry || typeof entry.name !== 'string') {
            continue;
        }
        const normalized = entry.name.trim().toLowerCase();
        if (!normalized) {
            continue;
        }
        if (!nameGroups.has(normalized)) {
            nameGroups.set(normalized, []);
        }
        nameGroups.get(normalized).push(entry);
    }

    const duplicates = Array.from(uniqueThings.values()).filter(thing => {
        const name = typeof thing.name === 'string' ? thing.name.trim() : '';
        if (!name) {
            return false;
        }
        const group = nameGroups.get(name.toLowerCase()) || [];
        if (group.length <= 1) {
            return false;
        }
        return group.some(entry => entry.id !== thing.id);
    });

    if (!duplicates.length) {
        return;
    }

    let locationOverride = location || null;
    if (!locationOverride && owner && typeof owner.currentLocation === 'string') {
        try {
            locationOverride = Location.get(owner.currentLocation);
        } catch (_) {
            locationOverride = null;
        }
    }

    let baseContext;
    try {
        baseContext = await prepareBasePromptContext({ locationOverride });
    } catch (error) {
        console.warn('Failed to build base context for thing name regeneration:', error.message);
        return;
    }

    const itemsToRegenerateName = duplicates.map(thing => ({
        id: thing.id,
        name: thing.name,
        description: thing.description || ''
    }));

    const allThingNames = Array.from(new Set(
        Thing.getAll()
            .map(entry => (typeof entry.name === 'string' ? entry.name.trim() : ''))
            .filter(Boolean)
    ));

    let renderedTemplate;
    try {
        renderedTemplate = promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'thing-name-regen',
            itemsToRegenerateName,
            allThingNames
        });
    } catch (error) {
        console.warn('Failed to render thing name regeneration prompt:', error.message);
        return;
    }

    let parsedTemplate;
    try {
        parsedTemplate = parseXMLTemplate(renderedTemplate);
    } catch (error) {
        console.warn('Failed to parse thing name regeneration template:', error.message);
        return;
    }

    if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
        return;
    }

    const messages = [
        { role: 'system', content: parsedTemplate.systemPrompt },
        { role: 'user', content: parsedTemplate.generationPrompt }
    ];

    let responseText = '';
    let durationSeconds = null;
    try {
        const requestStart = Date.now();
        responseText = await LLMClient.chatCompletion({
            messages,
            temperature: parsedTemplate.temperature,
            metadataLabel: 'thing_name_regen'
        });
        durationSeconds = (Date.now() - requestStart) / 1000;
    } catch (error) {
        console.warn('Thing name regeneration request failed:', error.message);
        return;
    }

    if (!responseText.trim()) {
        return;
    }

    try {
        logThingNameRegeneration({
            prompt: parsedTemplate.generationPrompt,
            responseText,
            durationSeconds
        });
    } catch (error) {
        console.warn('Failed to log thing name regeneration:', error.message);
    }

    const mapping = parseThingNameRegenResponse(responseText);
    if (!mapping.size) {
        return;
    }

    for (const thing of duplicates) {
        if (!thing) {
            continue;
        }
        const replacement = mapping.get(thing.id)
            || mapping.get(thing.name)
            || mapping.get(thing.name?.trim());
        if (!replacement || !replacement.newName) {
            continue;
        }

        try {
            thing.name = replacement.newName;
            if (replacement.description) {
                thing.description = replacement.description;
            }
        } catch (error) {
            console.warn(`Failed to apply regenerated name to thing ${thing.id}:`, error.message);
        }
    }
}

async function regenerateLocationName(location) {
    if (!location || typeof location !== 'object') {
        throw new Error('regenerateLocationName requires a location object.');
    }

    const aiConfig = config?.ai || {};
    if (!aiConfig.endpoint || !aiConfig.apiKey || !aiConfig.model) {
        throw new Error('AI configuration missing for location name regeneration.');
    }

    const worldOutline = getWorldOutline();
    const regionName = (() => {
        if (location.regionId) {
            try {
                const region = Region.get(location.regionId);
                if (region?.name) {
                    return region.name;
                }
            } catch (_) {
                // ignore resolution errors
            }
        }
        if (location.stubMetadata?.regionName) {
            return location.stubMetadata.regionName;
        }
        return 'Unknown Region';
    })();

    const baseLevel = Number.isFinite(location.baseLevel)
        ? Number(location.baseLevel)
        : (Number.isFinite(location.stubMetadata?.computedBaseLevel)
            ? Number(location.stubMetadata.computedBaseLevel)
            : 1);

    const locationContext = {
        name: location.name || 'Unnamed Location',
        description: location.description
            || location.stubMetadata?.shortDescription
            || location.stubMetadata?.blueprintDescription
            || 'No description provided.',
        region: regionName,
        baseLevel
    };

    let renderedTemplate;
    try {
        renderedTemplate = promptEnv.render('location_name_regen.xml.njk', {
            worldOutline,
            location: locationContext
        });
    } catch (error) {
        throw new Error(`Failed to render location name regeneration template: ${error.message}`);
    }

    let parsedTemplate;
    try {
        parsedTemplate = parseXMLTemplate(renderedTemplate);
    } catch (error) {
        throw new Error(`Failed to parse location name regeneration template: ${error.message}`);
    }

    const systemPrompt = parsedTemplate?.systemPrompt;
    const generationPrompt = parsedTemplate?.generationPrompt;
    if (!systemPrompt || !generationPrompt) {
        throw new Error('Location name regeneration template missing prompts.');
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    let responseText = '';
    let durationSeconds = null;
    try {
        const requestStarted = Date.now();
        responseText = await LLMClient.chatCompletion({
            messages,
            temperature: parsedTemplate.temperature,
            metadataLabel: 'location_name_regen'
        });
        durationSeconds = (Date.now() - requestStarted) / 1000;
    } catch (error) {
        throw new Error(`Location name regeneration request failed: ${error.message}`);
    }

    if (!responseText.trim()) {
        throw new Error('Location name regeneration returned an empty response.');
    }

    try {
        logLocationNameRegeneration({
            prompt: generationPrompt,
            responseText,
            durationSeconds
        });
    } catch (error) {
        console.warn('Failed to log location name regeneration:', error.message);
    }

    const candidateNames = parseLocationNameRegenResponse(responseText);
    if (!candidateNames.length) {
        throw new Error('Location name regeneration did not produce any candidates.');
    }

    const usedNames = new Set();
    for (const locations of Object.values(worldOutline?.regions || {})) {
        if (!Array.isArray(locations)) {
            continue;
        }
        for (const name of locations) {
            if (typeof name !== 'string') {
                continue;
            }
            const normalized = name.trim().toLowerCase();
            if (normalized) {
                usedNames.add(normalized);
            }
        }
    }

    const selectUniqueName = () => {
        for (const candidate of candidateNames) {
            if (!candidate || typeof candidate !== 'string') {
                continue;
            }
            const trimmed = candidate.trim();
            if (!trimmed) {
                continue;
            }
            const normalized = trimmed.toLowerCase();
            if (!usedNames.has(normalized)) {
                return trimmed;
            }
        }
        return null;
    };

    let selectedName = selectUniqueName();

    if (!selectedName) {
        const baseCandidate = candidateNames[0] && typeof candidateNames[0] === 'string'
            ? candidateNames[0].trim()
            : null;
        if (baseCandidate) {
            for (let suffix = 2; suffix <= 100; suffix += 1) {
                const attempt = `${baseCandidate} ${suffix}`;
                if (!usedNames.has(attempt.toLowerCase())) {
                    selectedName = attempt;
                    break;
                }
            }
        }
    }

    if (!selectedName) {
        throw new Error('Unable to determine a unique location name from regeneration results.');
    }

    if (location && typeof location === 'object') {
        try {
            location.name = selectedName;
        } catch (error) {
            console.warn(`Failed to assign regenerated location name "${selectedName}":`, error.message);
        }
    }

    return {
        name: selectedName,
        candidates: candidateNames
    };
}

function parseRegionNameRegenResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return [];
    }

    try {
        const doc = Utils.parseXmlDocument(responseText, 'text/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error(parserError.textContent || 'Parser error');
        }

        const containers = Array.from(doc.getElementsByTagName('regionNames'));
        const results = [];

        for (const container of containers) {
            const nameNodes = Array.from(container.getElementsByTagName('name'));
            const names = nameNodes
                .map(node => (node?.textContent || '').trim())
                .filter(Boolean);

            const regionIdNode = container.getElementsByTagName('regionId')[0] || null;
            const regionIndexNode = container.getElementsByTagName('regionIndex')[0] || null;
            const originalNameNode = container.getElementsByTagName('originalName')[0] || null;

            if (!names.length) {
                continue;
            }

            let regionIndex = null;
            if (regionIndexNode && typeof regionIndexNode.textContent === 'string') {
                const parsedIndex = Number.parseInt(regionIndexNode.textContent.trim(), 10);
                if (Number.isFinite(parsedIndex)) {
                    regionIndex = parsedIndex;
                }
            }

            results.push({
                regionId: regionIdNode && regionIdNode.textContent
                    ? regionIdNode.textContent.trim() || null
                    : null,
                regionIndex,
                originalName: originalNameNode && originalNameNode.textContent
                    ? originalNameNode.textContent.trim() || null
                    : null,
                names: rotateNameCandidates(names)
            });
        }

        if (results.length) {
            return results;
        }

        const fallbackNames = responseText
            .split(/\r?\n|,/)
            .map(entry => entry.trim())
            .filter(Boolean);

        return fallbackNames.length
            ? [{ regionId: null, regionIndex: null, originalName: null, names: rotateNameCandidates(fallbackNames) }]
            : [];
    } catch (error) {
        console.warn('Failed to parse region name regeneration response:', error.message);
        return [];
    }
}

function chooseRegionName({
    region,
    candidateNames,
    bannedSet,
    usedNames,
    regionLabel
}) {
    if (!region || typeof region !== 'object') {
        throw new Error('chooseRegionName requires a region object.');
    }
    if (!Array.isArray(candidateNames) || !candidateNames.length) {
        throw new Error(`No candidate names provided for region "${regionLabel || region.name || region.id || 'unknown'}".`);
    }

    const sharedUsedNames = usedNames instanceof Set ? usedNames : null;
    const tried = new Set();
    const originalLower = typeof region.name === 'string'
        ? region.name.trim().toLowerCase()
        : '';

    if (originalLower) {
        tried.add(originalLower);
    }
    if (sharedUsedNames && originalLower) {
        sharedUsedNames.add(originalLower);
    }

    for (const candidate of candidateNames) {
        if (!candidate || typeof candidate !== 'string') {
            continue;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
            continue;
        }
        const lower = trimmed.toLowerCase();
        if (tried.has(lower) || (sharedUsedNames && sharedUsedNames.has(lower))) {
            continue;
        }
        tried.add(lower);

        if (lower === originalLower) {
            continue;
        }
        if (isLocationNameBanned(trimmed, bannedSet)) {
            continue;
        }
        if (typeof Region.getByName === 'function') {
            const existing = Region.getByName(trimmed);
            if (existing && existing !== region) {
                continue;
            }
        }

        if (sharedUsedNames) {
            sharedUsedNames.add(lower);
        }

        region.name = trimmed;
        return {
            selectedName: trimmed,
            candidates: candidateNames.slice()
        };
    }

    throw new Error(`Region name regeneration did not produce a usable replacement for "${regionLabel || region.name || region.id || 'unknown'}".`);
}

async function regenerateRegionNames(regions) {
    if (!Array.isArray(regions) || !regions.length) {
        throw new Error('regenerateRegionNames requires a non-empty array of region objects.');
    }

    const aiConfig = config?.ai || {};
    if (!aiConfig.endpoint || !aiConfig.apiKey || !aiConfig.model) {
        throw new Error('AI configuration missing for region name regeneration.');
    }

    const worldOutline = getWorldOutline();

    const regionEntries = regions.map((region, index) => {
        if (!region || typeof region !== 'object') {
            throw new Error('regenerateRegionNames received an invalid region entry.');
        }

        const timestamp = Date.now();
        const contextId = typeof region.id === 'string' && region.id.trim()
            ? region.id.trim()
            : `generated-region-${timestamp}-${index}`;
        const contextName = typeof region.name === 'string' && region.name.trim()
            ? region.name.trim()
            : `Unnamed Region ${index + 1}`;
        const description = typeof region.description === 'string' && region.description.trim()
            ? region.description.trim()
            : 'No description provided.';

        return {
            region,
            contextId,
            contextName,
            description,
            index
        };
    });

    let renderedTemplate;
    try {
        renderedTemplate = promptEnv.render('region_name_regen.xml.njk', {
            worldOutline,
            regions: regionEntries.map(entry => ({
                id: entry.contextId,
                name: entry.contextName,
                description: entry.description
            }))
        });
    } catch (error) {
        throw new Error(`Failed to render region name regeneration template: ${error.message}`);
    }

    let parsedTemplate;
    try {
        parsedTemplate = parseXMLTemplate(renderedTemplate);
    } catch (error) {
        throw new Error(`Failed to parse region name regeneration template: ${error.message}`);
    }

    const systemPrompt = parsedTemplate?.systemPrompt;
    const generationPrompt = parsedTemplate?.generationPrompt;
    if (!systemPrompt || !generationPrompt) {
        throw new Error('Region name regeneration template missing prompts.');
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    let responseText = '';
    let durationSeconds = null;
    try {
        const requestStarted = Date.now();
        responseText = await LLMClient.chatCompletion({
            messages,
            temperature: parsedTemplate.temperature,
            metadataLabel: 'region_name_regen'
        });
        durationSeconds = (Date.now() - requestStarted) / 1000;
    } catch (error) {
        throw new Error(`Region name regeneration request failed: ${error.message}`);
    }

    if (!responseText.trim()) {
        throw new Error('Region name regeneration returned an empty response.');
    }

    logRegionNameRegeneration({
        prompt: generationPrompt,
        responseText,
        durationSeconds
    });

    const groups = parseRegionNameRegenResponse(responseText);
    if (!groups.length) {
        throw new Error('Region name regeneration did not produce any candidates.');
    }

    const bannedSet = getBannedLocationNameSet();
    const usedNames = new Set();
    const results = [];

    for (const entry of regionEntries) {
        const contextId = entry.contextId;
        const contextNameLower = entry.contextName.toLowerCase();

        const group = groups.find(candidate => {
            if (candidate.regionId && candidate.regionId.trim() === contextId) {
                return true;
            }
            if (Number.isInteger(candidate.regionIndex) && candidate.regionIndex === entry.index) {
                return true;
            }
            if (candidate.originalName && candidate.originalName.trim().toLowerCase() === contextNameLower) {
                return true;
            }
            return false;
        }) || null;

        if (!group) {
            throw new Error(`Region name regeneration response missing candidates for region "${entry.contextName}".`);
        }

        const selection = chooseRegionName({
            region: entry.region,
            candidateNames: group.names,
            bannedSet,
            usedNames,
            regionLabel: entry.contextName
        });

        results.push({
            region: entry.region,
            selectedName: selection.selectedName,
            candidates: selection.candidates
        });
    }

    return results;
}

async function regenerateRegionName(region) {
    if (!region || typeof region !== 'object') {
        throw new Error('regenerateRegionName requires a region object.');
    }

    const results = await regenerateRegionNames([region]);
    const selection = results[0] || null;
    if (!selection || !selection.selectedName) {
        throw new Error('Region name regeneration did not return a usable result.');
    }
    return selection.selectedName;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports.regenerateLocationName = regenerateLocationName;
    module.exports.regenerateRegionName = regenerateRegionName;
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
    const numericCount = Number(count);
    const safeCount = Number.isFinite(numericCount)
        ? Math.max(0, Math.min(100, numericCount))
        : Math.max(0, Math.min(100, 20));

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

    if (safeCount === 0) {
        return [];
    }

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

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        console.warn('AI configuration missing for skill generation, using fallback skills.');
        return buildFallbackSkills({ count: safeCount, attributes: attributeEntries });
    }

    try {
        const requestStart = Date.now();
        const skillResponse = await LLMClient.chatCompletion({
            messages,
            temperature: parsedTemplate.temperature,
            metadataLabel: 'skill_generation'
        });

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

    if (!config?.ai?.endpoint || !config.ai.apiKey || !config.ai.model) {
        return normalized.map(name => new Skill({ name, description: '', attribute: '' }));
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: generationPrompt }
    ];

    try {
        const requestStart = Date.now();
        const skillResponse = await LLMClient.chatCompletion({
            messages,
            temperature: parsedTemplate.temperature,
            metadataLabel: 'skill_generation_by_name'
        });

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
async function generateLocationNPCs({ location, systemPrompt, generationPrompt, aiResponse, regionTheme, existingLocationsInRegion = [] }) {
    if (config.omit_npc_generation) {
        return [];
    }
    try {
        let region = Region.get(location.regionId);
        const allNpcIds = Utils.difference(new Set(players.keys()), new Set([currentPlayer?.id].filter(Boolean)));
        const regionNpcIdSet = region ? new Set(region.npcIds || []) : new Set();
        const locationNpcIdSet = new Set(location.npcIds || []);
        const otherLocationNpcIds = Utils.difference(regionNpcIdSet, locationNpcIdSet);
        const otherRegionNpcIds = Utils.difference(allNpcIds, regionNpcIdSet);

        const existingNpcIdsArray = Array.from(locationNpcIdSet);
        const existingNpcsInThisLocation = getAllPlayers(existingNpcIdsArray).filter(npc => npc && npc.isNPC);
        const existingNpcsInOtherLocations = getAllPlayers(Array.from(otherLocationNpcIds)).filter(npc => npc && npc.isNPC);
        const existingNpcsInOtherRegions = getAllPlayers(Array.from(otherRegionNpcIds)).filter(npc => npc && npc.isNPC);

        const existingNames = new SanitizedStringSet(Player.getAll().map(npc => npc.name))

        const generationHints = location?.generationHints || {};
        const resolveCount = (value, fallback) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric >= 0) {
                return Math.max(0, Math.round(numeric));
            }
            const fallbackNumeric = Number(fallback);
            if (Number.isFinite(fallbackNumeric) && fallbackNumeric >= 0) {
                return Math.max(0, Math.round(fallbackNumeric));
            }
            return 0;
        };
        const hintedNumNpcs = resolveCount(generationHints.numNpcs, 3);
        const hintedNumHostiles = resolveCount(
            generationHints.numHostiles,
            Math.max(0, Math.round(hintedNumNpcs / 2))
        );
        const npcCountHint = Math.max(1, hintedNumNpcs || 1);

        if (hintedNumNpcs + hintedNumHostiles === 0) {
            return [];
        }

        const npcPrompt = renderLocationNpcPrompt(location, {
            regionTheme,
            attributeDefinitions: attributeDefinitionsForPrompt,
            existingNpcsInThisLocation,
            existingNpcsInOtherLocations,
            existingNpcsInOtherRegions,
            desiredCount: hintedNumNpcs,
            numNpcs: hintedNumNpcs,
            numHostiles: hintedNumHostiles
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

        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.join(logDir, `location_npcs_${location.id}.log`);

        console.log('🧑‍🤝‍🧑 Requesting NPC generation for location', location.id);
        const requestStart = Date.now();
        const npcResponse = await LLMClient.chatCompletion({
            messages,
            timeoutScale: npcCountHint,
            metadataLabel: 'location_npc_generation'
        });

        if (!npcResponse || !npcResponse.trim()) {
            throw new Error('Invalid NPC response from AI API');
        }

        const apiDurationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const parts = [
                formatDurationLine(apiDurationSeconds),
                '=== NPC PROMPT ===',
                [systemPrompt, generationPrompt, aiResponse, npcPromptWithContext].join('\n\n'),
                '\n=== NPC RESPONSE ===',
                npcResponse,
                '\n'
            ];
            fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
        } catch (logErr) {
            console.warn('Failed to write NPC log:', logErr.message);
        }

        const parsedResult = parseLocationNpcs(npcResponse);
        let npcs = Array.isArray(parsedResult?.npcs) ? parsedResult.npcs : [];
        let npcMemoryMap = parsedResult?.memories instanceof Map ? parsedResult.memories : new Map();
        const baseConversation = [...messages, { role: 'assistant', content: npcResponse }];
        const npctimeoutScale = Math.max(1, npcs.length || npcCountHint);

        const originalNpcNames = npcs.map(npc => npc?.name || null);
        let npcRenameMap = new Map();
        if (npcs.length) {
            Globals.updateSpinnerText({ message: `Naming NPCs for location ${location.name || location.id}...` });
            npcs = await enforceBannedNpcNames({
                npcDataList: npcs,
                existingNames,
                conversationMessages: baseConversation
            });

            npcRenameMap = computeNpcRenameMap(originalNpcNames, npcs);
        }

        if (npcMemoryMap instanceof Map && npcRenameMap && npcRenameMap.size) {
            npcMemoryMap = rekeyNpcLookupMap(npcMemoryMap, npcRenameMap) || npcMemoryMap;
        }

        // Fill in description and short description templates
        for (const npcData of npcs) {
            if (npcData && typeof npcData === 'object') {
                npcData.description = applyNpcNameTemplate(npcData.description, npcData.name);
                npcData.shortDescription = applyNpcNameTemplate(npcData.shortDescription, npcData.name);
            }
        }

        let npcSkillAssignments = new Map();
        let skillConversation = [...baseConversation];
        if (npcs.length) {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC skills for location ${location.name || location.id}...` });
                const skillsLogPath = path.join(logDir, `location_${location.id}_npc_skills.log`);
                const skillResult = await requestNpcSkillAssignments({
                    baseMessages: baseConversation,
                    logPath: skillsLogPath,
                    timeoutScale: npctimeoutScale
                });
                const rawAssignments = skillResult.assignments || new Map();
                npcSkillAssignments = rekeyNpcLookupMap(rawAssignments, npcRenameMap) || new Map();
                skillConversation = Array.isArray(skillResult.conversation) ? skillResult.conversation : skillConversation;
            } catch (skillError) {
                console.warn(`Failed to generate skills for location NPCs (${location.id}):`, skillError.message);
                console.debug(skillError);
            }
        }

        let npcAbilityAssignments = new Map();
        if (npcs.length) {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC abilities for location ${location.name || location.id}...` });
                const abilitiesLogPath = path.join(logDir, `location_${location.id}_npc_abilities.log`);
                const abilityResult = await requestNpcAbilityAssignments({
                    baseMessages: skillConversation,
                    logPath: abilitiesLogPath,
                    timeoutScale: npctimeoutScale
                });
                const rawAbilityAssignments = abilityResult.assignments || new Map();
                npcAbilityAssignments = rekeyNpcLookupMap(rawAbilityAssignments, npcRenameMap) || new Map();
            } catch (abilityError) {
                console.warn(`Failed to generate abilities for location NPCs (${location.id}):`, abilityError.message);
            }
        }

        const created = [];
        const npcContexts = [];
        const resolvedRegion = region || findRegionByLocationId(location.id);
        const equipSettingDescription = describeSettingForPrompt(getActiveSettingSnapshot());

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
                shortDescription: npcData.shortDescription || '',
                level: 1,
                location: location.id,
                attributes,
                class: npcData.class || null,
                race: npcData.race,
                isNPC: true,
                isHostile: Boolean(npcData.isHostile),
                healthAttribute: npcData.healthAttribute,
                personalityType: npcData.personalityType || null,
                personalityTraits: npcData.personalityTraits || null,
                personalityNotes: npcData.personalityNotes || null,
                goals: Array.isArray(npcData.goals) ? npcData.goals : null
            });

            if (Number.isFinite(npcData.currency) && npcData.currency >= 0 && typeof npc.setCurrency === 'function') {
                try {
                    npc.setCurrency(npcData.currency);
                } catch (currencyError) {
                    console.warn(`Failed to set currency for generated NPC ${npcData.name || npc.id}:`, currencyError.message);
                }
            }

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

            const descriptor = { role: npcData.role, class: npcData.class, race: npcData.race };
            npcContexts.push({ npc, descriptor, name: npcData.name || npc.id });

            if (npcMemoryMap instanceof Map) {
                const memoryEntry = npcMemoryMap.get((npcData.name || '').trim().toLowerCase());
                if (Array.isArray(memoryEntry) && memoryEntry.length) {
                    try {
                        npc.importantMemories = memoryEntry.slice(0);
                    } catch (memoryError) {
                        console.warn(`Failed to assign memories to location NPC ${npc.name}:`, memoryError.message);
                    }
                }
            }
        }

        const inventoryTasks = npcContexts.map(({ npc, descriptor, name }) => (async () => {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC inventories for location ${location.name || location.id}...` });
                await generateInventoryForCharacter({
                    character: npc,
                    characterDescriptor: descriptor,
                    region: resolvedRegion,
                    location,
                    timeoutScale: npctimeoutScale,
                    autoEquip: false
                });
            } catch (inventoryError) {
                console.warn(`Failed to generate inventory for location NPC ${name}:`, inventoryError.message);
            } finally {
                restoreCharacterHealthToMaximum(npc);
            }
        })());

        await Promise.all(inventoryTasks);

        const equipTasks = npcContexts.map(({ npc, descriptor, name }) => (async () => {
            try {
                Globals.updateSpinnerText({ message: `Equipping NPCs for location ${location.name || location.id}...` });
                await equipBestGearForCharacter({
                    character: npc,
                    characterDescriptor: descriptor,
                    region: resolvedRegion,
                    location,
                    settingDescription: equipSettingDescription,
                    timeoutScale: npctimeoutScale
                });
            } catch (equipError) {
                console.warn(`Failed to run equip-best flow for location NPC ${name}:`, equipError.message);
            }
        })());

        await Promise.all(equipTasks);

        for (const { npc } of npcContexts) {
            restoreCharacterHealthToMaximum(npc);
            if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
                npc.imageId = null;
            }
        }

        return created;
    } catch (error) {
        console.warn(`NPC generation skipped for location ${location.id}:`, error.message);
        console.debug(error);
        return [];
    }
}


async function generateRegionNPCs({ region, systemPrompt, generationPrompt, aiResponse, characterConcepts = [], secrets = [] }) {
    if (!region) {
        throw new Error('Region is required for generating region NPCs');
    }
    if (config.omit_npc_generation) {
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

        const existingNames = new SanitizedStringSet(Player.getAll().map(npc => npc.name))

        console.log(`Character concepts for region ${region.id}:`, Array.isArray(region.characterConcepts) ? region.characterConcepts : []);

        const npcPrompt = renderRegionNpcPrompt(region, {
            allLocationsInRegion: allLocationsForPrompt,
            existingNpcsInOtherRegions,
            attributeDefinitions: attributeDefinitionsForPrompt,
            characterConcepts,
            secrets
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

        Globals.updateSpinnerText({ message: `Generating NPCs for region ${region.name || region.id}...` });
        console.log('🏘️ Requesting important NPC generation for region', region.id);
        const requestStart = Date.now();
        const npcResponse = await LLMClient.chatCompletion({
            messages,
            timeoutScale: regionLocations.length,
            metadataLabel: 'region_npc_generation'
        });

        if (!npcResponse || !npcResponse.trim()) {
            throw new Error('Invalid region NPC response from AI API');
        }

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

        const parsedRegionResult = parseRegionNpcs(npcResponse);
        let parsedNpcs = Array.isArray(parsedRegionResult?.npcs) ? parsedRegionResult.npcs : [];
        let regionNpcMemories = parsedRegionResult?.memories instanceof Map ? parsedRegionResult.memories : new Map();
        const baseConversation = [...messages, { role: 'assistant', content: npcResponse }];
        const npctimeoutScale = Math.max(1, parsedNpcs.length || regionLocations.length || 1);

        const originalRegionNpcNames = parsedNpcs.map(npc => npc?.name || null);
        let regionNpcRenameMap = new Map();
        if (parsedNpcs.length) {
            Globals.updateSpinnerText({ message: `Naming NPCs for region ${region.name || region.id}...` });
            parsedNpcs = await enforceBannedNpcNames({
                npcDataList: parsedNpcs,
                existingNames,
                conversationMessages: baseConversation
            });

            regionNpcRenameMap = computeNpcRenameMap(originalRegionNpcNames, parsedNpcs);
        }

        for (const npcData of parsedNpcs) {
            if (npcData && typeof npcData === 'object') {
                npcData.description = applyNpcNameTemplate(npcData.description, npcData.name);
                npcData.shortDescription = applyNpcNameTemplate(npcData.shortDescription, npcData.name);
            }
        }

        if (regionNpcMemories instanceof Map && regionNpcRenameMap && regionNpcRenameMap.size) {
            regionNpcMemories = rekeyNpcLookupMap(regionNpcMemories, regionNpcRenameMap) || regionNpcMemories;
        }

        let regionNpcSkillAssignments = new Map();
        let regionSkillConversation = [...baseConversation];
        if (parsedNpcs.length) {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC skills for region ${region.name || region.id}...` });
                const skillsLogPath = path.join(__dirname, 'logs', `region_${region.id}_npc_skills.log`);
                const skillResult = await requestNpcSkillAssignments({
                    baseMessages: baseConversation,
                    logPath: skillsLogPath,
                    timeoutScale: npctimeoutScale
                });
                const rawAssignments = skillResult.assignments || new Map();
                regionNpcSkillAssignments = rekeyNpcLookupMap(rawAssignments, regionNpcRenameMap) || new Map();
                regionSkillConversation = Array.isArray(skillResult.conversation) ? skillResult.conversation : regionSkillConversation;
            } catch (skillError) {
                console.warn(`Failed to generate skills for region NPCs (${region.id}):`, skillError.message);
            }
        }

        let regionNpcAbilityAssignments = new Map();
        if (parsedNpcs.length) {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC abilities for region ${region.name || region.id}...` });
                const abilitiesLogPath = path.join(__dirname, 'logs', `region_${region.id}_npc_abilities.log`);
                const abilityResult = await requestNpcAbilityAssignments({
                    baseMessages: regionSkillConversation,
                    logPath: abilitiesLogPath,
                    timeoutScale: npctimeoutScale
                });
                const rawAbilityAssignments = abilityResult.assignments || new Map();
                regionNpcAbilityAssignments = rekeyNpcLookupMap(rawAbilityAssignments, regionNpcRenameMap) || new Map();
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
                Player.unregister(existingNpc);
            }
        }
        region.npcIds = [];

        const created = [];
        const npcContexts = [];
        const equipSettingDescription = describeSettingForPrompt(getActiveSettingSnapshot());

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
                isHostile: Boolean(npcData.isHostile),
                healthAttribute: npcData.healthAttribute,
                personalityType: npcData.personalityType || null,
                personalityTraits: npcData.personalityTraits || null,
                personalityNotes: npcData.personalityNotes || null,
                goals: Array.isArray(npcData.goals) ? npcData.goals : null
            });

            if (Number.isFinite(npcData.currency) && npcData.currency >= 0 && typeof npc.setCurrency === 'function') {
                try {
                    npc.setCurrency(npcData.currency);
                } catch (currencyError) {
                    console.warn(`Failed to set currency for region NPC ${npcData.name || npc.id}:`, currencyError.message);
                }
            }

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

            const descriptor = { role: npcData.role, class: npcData.class, race: npcData.race };
            npcContexts.push({
                npc,
                descriptor,
                targetLocation,
                name: npcData.name || npc.id
            });

            if (regionNpcMemories instanceof Map) {
                const memoryEntry = regionNpcMemories.get((npcData.name || '').trim().toLowerCase());
                if (Array.isArray(memoryEntry) && memoryEntry.length) {
                    try {
                        npc.importantMemories = memoryEntry.slice(0);
                    } catch (memoryError) {
                        console.warn(`Failed to assign memories to region NPC ${npc.name}:`, memoryError.message);
                    }
                }
            }
        }

        const inventoryTasks = npcContexts.map(({ npc, descriptor, targetLocation, name }) => (async () => {
            try {
                Globals.updateSpinnerText({ message: `Generating NPC inventories for region ${region.name || region.id}...` });
                await generateInventoryForCharacter({
                    character: npc,
                    characterDescriptor: descriptor,
                    region,
                    location: targetLocation,
                    timeoutScale: npctimeoutScale,
                    autoEquip: false
                });
            } catch (inventoryError) {
                console.warn(`Failed to generate inventory for region NPC ${name}:`, inventoryError.message);
            } finally {
                restoreCharacterHealthToMaximum(npc);
            }
        })());

        await Promise.all(inventoryTasks);

        const equipTasks = npcContexts.map(({ npc, descriptor, targetLocation, name }) => (async () => {
            try {
                Globals.updateSpinnerText({ message: `Equipping NPCs for region ${region.name || region.id}...` });
                await equipBestGearForCharacter({
                    character: npc,
                    characterDescriptor: descriptor,
                    region,
                    location: targetLocation,
                    settingDescription: equipSettingDescription,
                    timeoutScale: npctimeoutScale
                });
            } catch (equipError) {
                console.warn(`Failed to run equip-best flow for region NPC ${name}:`, equipError.message);
            }
        })());

        await Promise.all(equipTasks);

        for (const { npc, name } of npcContexts) {
            restoreCharacterHealthToMaximum(npc);
            if (shouldGenerateNpcImage(npc) && (!npc.imageId || !hasExistingImage(npc.imageId))) {
                npc.imageId = null;
            } else {
                console.log(`🎭 Skipping region NPC portrait for ${name} (${npc.id}) - outside player context`);
            }
        }

        return created;
    } catch (error) {
        console.warn(`Region NPC generation skipped for region ${region.id}:`, error.message);
        console.debug(error);
        return [];
    }
}



function renderLocationImagePrompt(location) {
    try {
        const templateName = getImagePromptTemplateName('location', 'location-image.xml.njk');

        if (!location) {
            throw new Error('Location object is required');
        }

        const variables = {
            locationId: location.id,
            locationDescription: location.description,
            locationBaseLevel: location.baseLevel,
            locationExits: location.exits ? Object.fromEntries(location.exits) : {},
            additionalInstructions: Globals.config.imagegen?.image_prompt_instructions?.location || ''
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
            generationPrompt: generationPrompt.trim(),
            validateXML: false,
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
        const templateName = getImagePromptTemplateName('location_exit', 'locationexit-image.xml.njk');

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
            ? getImagePromptTemplateName('item', 'item-image.xml.njk')
            : getImagePromptTemplateName('scenery', 'scenery-image.xml.njk');

        // Set up variables for the template
        const settingSnapshot = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(settingSnapshot);
        const metadata = thing.metadata || {};
        const locationId = metadata.locationId || thing.currentLocation || null;
        const location = locationId ? gameLocations.get(locationId) || null : null;
        const region = location ? findRegionByLocationId(location.id) || null : null;

        let additionalInstructions = '';
        if (thing.thingType === 'item') {
            additionalInstructions = Globals.config.imagegen?.image_prompt_instructions?.item || '';
        } else if (thing.thingType === 'scenery') {
            additionalInstructions = Globals.config.imagegen?.image_prompt_instructions?.scenery || '';
        }

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
            thingRarity: metadata.rarity || thing.rarity || getDefaultRarityLabel(),
            additionalInstructions
        };

        console.log(`Rendering ${thing.thingType} image template for ${thing.id}: ${thing.name}`);

        // Log call stack to console
        //console.trace('Thing image prompt render call stack:');

        // Render the template with the variables
        const renderedTemplate = promptEnv.render(templateName, variables);

        const logTimestamp = Date.now();

        // Don't log here.  We log in the caller after image is generated.
        /*
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
        */

        const parsedTemplate = parseXMLTemplate(renderedTemplate);

        /*
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
        */
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
async function renderLocationGeneratorPrompt(options = {}) {
    try {
        const isStubExpansion = Boolean(options.isStubExpansion);
        const baseContext = await prepareBasePromptContext();
        const activeSetting = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(activeSetting);
        const defaultSettingContext = buildSettingPromptContext(activeSetting, { descriptionFallback: settingDescription });
        const overrideSetting = options.setting;

        const settingKeys = [
            'name',
            'description',
            'theme',
            'genre',
            'startingLocationType',
            'magicLevel',
            'techLevel',
            'tone',
            'difficulty',
            'currencyName',
            'currencyNamePlural',
            'currencyValueNotes',
            'writingStyleNotes'
        ];

        let settingContext = defaultSettingContext;
        if (overrideSetting && typeof overrideSetting === 'object' && !Array.isArray(overrideSetting)) {
            settingContext = { ...defaultSettingContext };
            for (const key of settingKeys) {
                if (Object.prototype.hasOwnProperty.call(overrideSetting, key)) {
                    settingContext[key] = normalizeSettingValue(overrideSetting[key], settingContext[key]);
                }
            }
            if (Object.prototype.hasOwnProperty.call(overrideSetting, 'races')) {
                settingContext.races = normalizeSettingList(overrideSetting.races);
            }
            if (!settingContext.description) {
                settingContext.description = defaultSettingContext.description;
            }
        } else if (typeof overrideSetting === 'string') {
            settingContext = {
                ...defaultSettingContext,
                description: overrideSetting
            };
        }

        let entryProse = '';
        if (Array.isArray(chatHistory)) {
            const startIdx = Math.max(0, chatHistory.length - 10);
            for (let i = chatHistory.length - 1; i >= startIdx; i--) {
                const entry = chatHistory[i];
                if (entry && entry.role === 'assistant' && typeof entry.content === 'string' && entry.type === 'player-action' && entry.content.trim()) {
                    entryProse = entry.content.trim();
                    break;
                }
            }
        } else {
            console.warn('No chat history available for location generation prompt');
        }

        const normalizeRegionContext = (region) => {
            const fallback = {
                name: 'Unknown Region',
                description: 'No region description available.',
                locations: []
            };

            if (!region || typeof region !== 'object') {
                return fallback;
            }

            const nameSource = typeof region.name === 'string' && region.name.trim()
                ? region.name.trim()
                : (typeof region.regionName === 'string' && region.regionName.trim() ? region.regionName.trim() : fallback.name);
            const descriptionSource = typeof region.description === 'string' && region.description.trim()
                ? region.description.trim()
                : (typeof region.regionDescription === 'string' && region.regionDescription.trim() ? region.regionDescription.trim() : fallback.description);

            const normalizedLocations = Array.isArray(region.locations)
                ? region.locations
                    .map(entry => {
                        if (!entry) {
                            return null;
                        }
                        if (typeof entry === 'string') {
                            const name = entry.trim();
                            return name ? { name } : null;
                        }
                        if (typeof entry === 'object' && entry.name) {
                            const name = String(entry.name).trim();
                            return name ? { name } : null;
                        }
                        return null;
                    })
                    .filter(Boolean)
                : [];

            return {
                name: nameSource,
                description: descriptionSource,
                locations: normalizedLocations
            };
        };

        const normalizeExistingLocations = (locations) => {
            if (!Array.isArray(locations)) {
                return [];
            }
            return locations
                .map(entry => {
                    if (!entry) {
                        return null;
                    }
                    if (typeof entry === 'string') {
                        const trimmed = entry.trim();
                        return trimmed || null;
                    }
                    if (typeof entry === 'object' && entry.name) {
                        const trimmed = String(entry.name).trim();
                        return trimmed || null;
                    }
                    return null;
                })
                .filter(Boolean);
        };

        const currentRegionContext = options.currentRegion ? normalizeRegionContext(options.currentRegion) : null;
        const existingLocationNames = normalizeExistingLocations(options.existingLocations);

        const previousLocation = currentPlayer?.previousLocation || null;
        const previousLocationPayload = previousLocation ? {
            id: previousLocation.id || null,
            name: previousLocation.name || (typeof previousLocation.getDetails === 'function' ? (previousLocation.getDetails()?.name || null) : null),
            region: previousLocation.region ? {
                id: previousLocation.region.id || null,
                name: previousLocation.region.name || null
            } : null
        } : null;

        const currentPlayerPayload = baseContext.currentPlayer
            ? { ...baseContext.currentPlayer, previousLocation: previousLocationPayload }
            : { previousLocation: previousLocationPayload };

        const payload = {
            ...baseContext,
            setting: settingContext,
            currentPlayer: currentPlayerPayload,
            currentRegion: currentRegionContext || baseContext.currentRegion,
            mode: isStubExpansion ? 'stub' : 'full',
            existingLocations: existingLocationNames,
            promptType: isStubExpansion ? 'location-generator-stub' : 'location-generator-full',
            shortDescription: options.shortDescription || null,
            locationTheme: options.locationTheme || options.theme || null,
            playerLevel: options.playerLevel ?? null,
            locationPurpose: options.locationPurpose ?? null,
            relativeLevel: options.relativeLevel ?? null,
            regionAverageLevel: options.regionAverageLevel ?? null,
            entryProse,
            originLocationName: isStubExpansion ? (options.originLocationName || null) : null,
            originDescription: isStubExpansion ? (options.originDescription || null) : null,
            originDirection: isStubExpansion ? (options.originDirection || null) : null,
            stubName: isStubExpansion ? (options.stubName || null) : null,
            stubId: isStubExpansion ? (options.stubId || null) : null,
            isStubExpansion
        };

        const renderedTemplate = promptEnv.render('base-context.xml.njk', payload);
        const parsedXML = parseXMLTemplate(renderedTemplate);

        if (!parsedXML?.systemPrompt || !parsedXML?.generationPrompt) {
            throw new Error('Location generator template missing systemPrompt or generationPrompt');
        }

        return {
            systemPrompt: parsedXML.systemPrompt.trim(),
            generationPrompt: parsedXML.generationPrompt.trim(),
            maxTokens: parsedXML.maxTokens
        };
    } catch (error) {
        console.error('Error rendering location generator template:', error);
        return null;
    }
}

async function renderRegionGeneratorPrompt(options = {}) {
    try {
        const baseContext = await prepareBasePromptContext();
        const activeSetting = getActiveSettingSnapshot();
        const settingDescription = describeSettingForPrompt(activeSetting);
        const defaultSettingContext = buildSettingPromptContext(activeSetting, { descriptionFallback: settingDescription });
        const overrideSetting = options.setting;

        const settingKeys = [
            'name',
            'description',
            'theme',
            'genre',
            'startingLocationType',
            'magicLevel',
            'techLevel',
            'tone',
            'difficulty',
            'currencyName',
            'currencyNamePlural',
            'currencyValueNotes',
            'writingStyleNotes'
        ];

        let settingContext = defaultSettingContext;
        if (overrideSetting && typeof overrideSetting === 'object' && !Array.isArray(overrideSetting)) {
            settingContext = { ...defaultSettingContext };
            for (const key of settingKeys) {
                if (Object.prototype.hasOwnProperty.call(overrideSetting, key)) {
                    settingContext[key] = normalizeSettingValue(overrideSetting[key], settingContext[key]);
                }
            }
            if (Object.prototype.hasOwnProperty.call(overrideSetting, 'races')) {
                settingContext.races = normalizeSettingList(overrideSetting.races);
            }
            if (!settingContext.description) {
                settingContext.description = defaultSettingContext.description;
            }
        } else if (typeof overrideSetting === 'string') {
            settingContext = {
                ...defaultSettingContext,
                description: overrideSetting
            };
        }

        const normalizeRegionContext = (region) => {
            const fallback = {
                name: null,
                description: null,
                locations: []
            };

            if (!region || typeof region !== 'object') {
                return fallback;
            }

            const nameSource = typeof region.name === 'string' && region.name.trim()
                ? region.name.trim()
                : (typeof region.regionName === 'string' && region.regionName.trim() ? region.regionName.trim() : fallback.name);
            const descriptionSource = typeof region.description === 'string' && region.description.trim()
                ? region.description.trim()
                : (typeof region.regionDescription === 'string' && region.regionDescription.trim() ? region.regionDescription.trim() : fallback.description);

            const normalizedLocations = Array.isArray(region.locations)
                ? region.locations
                    .map(entry => {
                        if (!entry) {
                            return null;
                        }
                        if (typeof entry === 'string') {
                            const name = entry.trim();
                            return name ? { name } : null;
                        }
                        if (typeof entry === 'object' && entry.name) {
                            const name = String(entry.name).trim();
                            return name ? { name } : null;
                        }
                        return null;
                    })
                    .filter(Boolean)
                : [];

            return {
                name: nameSource,
                description: descriptionSource,
                locations: normalizedLocations,
                relativeLevel: Number.isFinite(region.relativeLevel) ? region.relativeLevel : null
            };
        };

        const normalizeExistingLocations = (locations) => {
            if (!Array.isArray(locations)) {
                return [];
            }
            return locations
                .map(entry => {
                    if (!entry) {
                        return null;
                    }
                    if (typeof entry === 'string') {
                        const trimmed = entry.trim();
                        return trimmed || null;
                    }
                    if (typeof entry === 'object' && entry.name) {
                        const trimmed = String(entry.name).trim();
                        return trimmed || null;
                    }
                    return null;
                })
                .filter(Boolean);
        };

        const mode = options.mode || 'full';
        const normalizedCurrentRegion = options.currentRegion ? normalizeRegionContext(options.currentRegion) : null;

        const previousLocation = currentPlayer?.previousLocation || null;
        const previousLocationPayload = previousLocation ? {
            id: previousLocation.id || null,
            name: previousLocation.name || (typeof previousLocation.getDetails === 'function' ? (previousLocation.getDetails()?.name || null) : null),
            region: previousLocation.region ? {
                id: previousLocation.region.id || null,
                name: previousLocation.region.name || null
            } : null
        } : null;

        const currentPlayerPayload = baseContext.currentPlayer
            ? { ...baseContext.currentPlayer, previousLocation: previousLocationPayload }
            : { previousLocation: previousLocationPayload };

        const minLocations = Number.isInteger(config.regions.minLocations) ? config.regions.minLocations : 2;
        const maxLocations = Number.isInteger(config.regions.maxLocations) ? config.regions.maxLocations : 10;
        const minRegionExitsOverride = Number.isInteger(options.minRegionExits) ? options.minRegionExits : null;
        const minNewRegionExitsOverride = Number.isInteger(options.minNewRegionExits) ? options.minNewRegionExits : null;
        const minRegionExits = minRegionExitsOverride !== null ? minRegionExitsOverride : 4;
        const minNewRegionExits = minNewRegionExitsOverride !== null ? minNewRegionExitsOverride : 3;

        const shouldIncludeCurrentRegion = mode === 'stub' || mode === 'exits' || mode === 'locations';
        const currentRegionForPrompt = shouldIncludeCurrentRegion
            ? (normalizedCurrentRegion || baseContext.currentRegion || {})
            : {};

        const existingLocationNames = normalizeExistingLocations(options.existingLocations);

        const payload = {
            ...baseContext,
            contextRegion: baseContext.currentRegion,
            currentRegion: currentRegionForPrompt,
            setting: settingContext,
            currentPlayer: currentPlayerPayload,
            promptType: 'region-generator',
            mode,
            regionName: options.regionName || null,
            regionDescription: options.regionDescription || null,
            regionNotes: options.regionNotes || null,
            minLocations,
            maxLocations,
            minRegionExits,
            minNewRegionExits,
            entryProse: options.entryProse || null,
            existingLocations: existingLocationNames
        };

        const renderedTemplate = promptEnv.render('base-context.xml.njk', payload);
        const parsedXML = parseXMLTemplate(renderedTemplate);

        if (!parsedXML?.systemPrompt || !parsedXML?.generationPrompt) {
            throw new Error('Region generator template missing systemPrompt or generationPrompt');
        }

        return {
            systemPrompt: parsedXML.systemPrompt.trim(),
            generationPrompt: parsedXML.generationPrompt.trim(),
            maxTokens: parsedXML.maxTokens
        };
    } catch (error) {
        console.error('Error rendering region generator template:', error);
        return null;
    }
}

// Function to generate player portrait image
async function generatePlayerImage(player, options = {}) {
    if (!currentSetting) {
        console.log('No active setting, skipping player portrait generation');
        return { success: false, skipped: true, reason: 'no-setting' };
    }
    try {
        const { force = false, clientId = null } = options || {};

        if (!player) {
            throw new Error('Player object is required');
        }

        if (player.isNPC && !force && !shouldGenerateNpcImage(player)) {
            //console.log(`🎭 Skipping NPC portrait for ${player.name} (${player.id}) - outside player context`);
            return {
                success: false,
                skipped: true,
                reason: 'not-in-context'
            };
        }

        const activeJobId = getEntityJob('player', player.id);
        if (activeJobId) {
            addJobSubscriber(activeJobId, clientId, { emitSnapshot: true });
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
            //console.log('Image generation is not enabled, skipping player portrait generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('Image generation client not initialized, skipping player portrait generation');
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
        const { prompt: finalImagePrompt, durationSeconds: promptDurationSeconds } = await generateImagePromptFromTemplate(portraitPrompt, { prefixType: 'character' });

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
        const portraitNegative = buildNegativePrompt('blurry, low quality, distorted, multiple faces, deformed, ugly, bad anatomy, bad proportions');
        const payload = {
            prompt: finalImagePrompt,
            width: config.imagegen.character_settings?.image?.width,
            height: config.imagegen.character_settings?.image?.height,
            steps: config.imagegen.character_settings?.sampling?.steps,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: portraitNegative,
            megapixels: getDefaultMegapixels(),
            // Track which player this image is for
            playerId: player.id,
            isPlayerPortrait: true,
            force,
            entityType: player.isNPC ? 'npc' : 'player',
            entityId: player.id,
            clientId
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
function applyImagePromptPrefix(promptText, prefixType = null) {
    if (!promptText || typeof promptText !== 'string' || !prefixType) {
        return typeof promptText === 'string' ? promptText : '';
    }

    const settingSnapshot = getActiveSettingSnapshot();
    if (!settingSnapshot) {
        return promptText.trim();
    }

    const resolvedType = String(prefixType).toLowerCase();
    let prefix = '';

    switch (resolvedType) {
        case 'character':
            prefix = settingSnapshot.imagePromptPrefixCharacter || '';
            break;
        case 'location':
            prefix = settingSnapshot.imagePromptPrefixLocation || '';
            break;
        case 'item':
            prefix = settingSnapshot.imagePromptPrefixItem || '';
            break;
        case 'scenery':
            prefix = settingSnapshot.imagePromptPrefixScenery || '';
            break;
        default:
            prefix = '';
            break;
    }

    const trimmedPrefix = typeof prefix === 'string' ? prefix.trim() : '';
    const trimmedPrompt = promptText.trim();

    if (!trimmedPrefix) {
        return trimmedPrompt;
    }

    return `${trimmedPrefix}\n\n${trimmedPrompt}`;
}

async function generateImagePromptFromTemplate(prompts, options = {}) {
    const { prefixType = null } = options || {};
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

        console.log('🤖 Requesting image prompt generation from LLM...');

        const requestStart = Date.now();
        const responseText = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'image_prompt_generation',
            validateXML: false,
            waitAfterError: 20,
        });

        if (!responseText || !responseText.trim()) {
            throw new Error('Invalid response from AI API');
        }

        let generatedImagePrompt = responseText;
        //console.log('📥 LLM Generated Image Prompt:', generatedImagePrompt);

        // Clean the prompt to remove potential problematic characters
        generatedImagePrompt = generatedImagePrompt
            .replace(/[""]/g, '"')     // Normalize quotes
            .replace(/['']/g, "'")     // Normalize apostrophes
            .replace(/[—–]/g, '-')     // Normalize dashes
            .trim();

        generatedImagePrompt = applyImagePromptPrefix(generatedImagePrompt, prefixType);

        return {
            prompt: generatedImagePrompt,
            durationSeconds: (Date.now() - requestStart) / 1000
        };

    } catch (error) {
        const bodyError = error?.response?.data?.error;
        const message = bodyError?.message || bodyError || error.message || String(error);
        console.error('Error generating image prompt with LLM:', message);
        console.error(error)
        // Fallback to the user prompt if LLM fails
        const fallbackPrompt = typeof prompts?.generationPrompt === 'string'
            ? prompts.generationPrompt
            : 'high quality fantasy illustration of subject';

        return {
            prompt: applyImagePromptPrefix(fallbackPrompt, prefixType),
            durationSeconds: null
        };
    }
}

// Function to generate location scene image
async function generateLocationImage(location, options = {}) {
    try {
        const { force = false, clientId = null } = options || {};
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            //console.log('Image generation is not enabled, skipping location scene generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('Image generation client not initialized, skipping location scene generation');
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
                addJobSubscriber(pendingJob, clientId, { emitSnapshot: true });
                return {
                    success: true,
                    existingJob: true,
                    jobId: pendingJobId,
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
        const { prompt: finalImagePrompt } = await generateImagePromptFromTemplate(promptTemplate, { prefixType: 'location' });

        const locationLogTimestamp = Date.now();
        try {
            const logsDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const safeLocationId = String(location.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
            const safeLocationName = typeof location.name === 'string'
                ? location.name.replace(/[^a-zA-Z0-9_-]/g, '_')
                : '';
            const locationFilename = safeLocationName
                ? `location_image_${locationLogTimestamp}_${safeLocationId}_${safeLocationName}.log`
                : `location_image_${locationLogTimestamp}_${safeLocationId}.log`;
            const locationLogPath = path.join(logsDir, locationFilename);
            const locationLogStack = new Error('Location image log trace').stack || 'No stack trace available';
            const logSections = [
                '=== STACK TRACE ===',
                locationLogStack,
                '',
                `Timestamp: ${new Date(locationLogTimestamp).toISOString()}`,
                `Location ID: ${location.id}`,
                `Location Name: ${location.name || ''}`,
                '=== SYSTEM PROMPT ===',
                promptTemplate.systemPrompt || '(none)',
                '',
                '=== GENERATION PROMPT ===',
                promptTemplate.generationPrompt || '(none)',
                '',
                '=== RENDERED TEMPLATE ===',
                promptTemplate.renderedTemplate || '(none)',
                '',
                '=== FINAL IMAGE PROMPT ===',
                finalImagePrompt,
                ''
            ];
            fs.writeFileSync(locationLogPath, logSections.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log location image prompt:', logError.message);
        }

        // Create image generation job with location-specific settings
        const jobId = generateImageId();
        const locationImageSettings = config.imagegen.location_settings?.image || {};
        const defaultImageSettings = config.imagegen.default_settings?.image || {};
        const locationNegative = buildNegativePrompt('blurry, low quality, modern elements, cars, technology, people, characters, portraits, indoor scenes only');
        const payload = {
            prompt: finalImagePrompt,
            width: locationImageSettings.width || defaultImageSettings.width || 1024,
            height: locationImageSettings.height || defaultImageSettings.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            steps: config.imagegen.location_settings?.sampling?.steps,
            negative_prompt: locationNegative,
            megapixels: resolveMegapixels(locationImageSettings.megapixels),
            // Track which location this image is for
            locationId: location.id,
            renderedTemplate: promptTemplate.renderedTemplate,
            isLocationScene: true,
            force,
            entityType: 'location',
            entityId: location.id,
            clientId
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
        const { force = false, clientId = null } = options || {};
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            //console.log('Image generation is not enabled, skipping location exit passage generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('Image generation client not initialized, skipping location exit passage generation');
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
            addJobSubscriber(activeJobId, clientId, { emitSnapshot: true });
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
        const prefixedPassagePrompt = applyImagePromptPrefix(passagePrompt, 'scenery');

        // Create image generation job with location exit-specific settings
        const jobId = generateImageId();
        const exitNegative = buildNegativePrompt('blurry, low quality, modern elements, cars, technology, people, characters, blocked passages');
        const payload = {
            prompt: prefixedPassagePrompt,
            width: config.imagegen.default_settings.image.width || 1024,
            height: config.imagegen.default_settings.image.height || 1024,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: exitNegative,
            megapixels: getDefaultMegapixels(),
            // Track which location exit this image is for
            locationExitId: locationExit.id,
            isLocationExitImage: true,
            force,
            entityType: 'location-exit',
            entityId: locationExit.id,
            clientId
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
        const { force = false, clientId = null } = options || {};
        //console.log(`Starting image generation process for thing ${thing.id}: ${thing.name}`);
        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            //console.log('Image generation is not enabled, skipping thing image generation');
            return {
                success: false,
                skipped: true,
                reason: 'disabled'
            };
        }

        if (!comfyUIClient) {
            console.log('Image generation client not initialized, skipping thing image generation');
            return {
                success: false,
                skipped: true,
                reason: 'no-client'
            };
        }

        if (!thing) {
            throw new Error('Thing object is required');
        }

        //console.log(`Checking existing image for thing ${thing.name}: ${thing.imageId || 'none'}`);

        const activeJobId = getEntityJob('thing', thing.id);
        if (activeJobId) {
            console.log(`🎒 Image job ${activeJobId} already running for ${thing.name}, returning existing job`);
            addJobSubscriber(activeJobId, clientId, { emitSnapshot: true });
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
        const thingPrefixType = thing.thingType === 'item' ? 'item' : 'scenery';
        const { prompt: finalImagePrompt } = await generateImagePromptFromTemplate(promptTemplate, { prefixType: thingPrefixType });

        const thingLogTimestamp = Date.now();
        try {
            const logsDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const safeThingId = String(thing.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
            const logCategory = thing.thingType === 'item' ? 'item' : (thing.thingType === 'scenery' ? 'scenery' : 'thing');
            const safeThingName = typeof thing.name === 'string'
                ? thing.name.replace(/[^a-zA-Z0-9_-]/g, '_')
                : '';
            const filename = safeThingName
                ? `${logCategory}_image_${thingLogTimestamp}_${safeThingId}_${safeThingName}.log`
                : `${logCategory}_image_${thingLogTimestamp}_${safeThingId}.log`;
            const thingLogPath = path.join(logsDir, filename);

            // no need for this at the moment.
            //const logStack = new Error('Thing image log trace').stack || 'No stack trace available';

            const logSections = [
                '=== STACK TRACE ===',
                //logStack,
                '',
                `Timestamp: ${new Date(thingLogTimestamp).toISOString()}`,
                `Thing ID: ${thing.id}`,
                `Thing Name: ${thing.name || ''}`,
                `Thing Type: ${thing.thingType || thing.type || 'unknown'}`,
                '=== SYSTEM PROMPT ===',
                promptTemplate.systemPrompt || '(none)',
                '',
                '=== GENERATION PROMPT ===',
                promptTemplate.generationPrompt || '(none)',
                '',
                '=== RENDERED TEMPLATE ===',
                promptTemplate.renderedTemplate || '(none)',
                '',
                '=== FINAL IMAGE PROMPT ===',
                finalImagePrompt,
                ''
            ];
            fs.writeFileSync(thingLogPath, logSections.join('\n'), 'utf8');
        } catch (logError) {
            console.warn('Failed to log thing image prompt:', logError.message);
        }

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

        const thingNegative = thing.thingType === 'item'
            ? buildNegativePrompt('blurry, low quality, people, characters, hands, multiple objects, cluttered background, modern elements')
            : buildNegativePrompt('blurry, low quality, people, characters, modern elements, cars, technology, indoor scenes, portraits');
        const payload = {
            prompt: finalImagePrompt,
            width: width,
            height: height,
            seed: Math.floor(Math.random() * 1000000),
            negative_prompt: thingNegative,
            megapixels: getDefaultMegapixels(),
            // Track which thing this image is for
            thingId: thing.id,
            renderedTemplate: promptTemplate.renderedTemplate,
            isThingImage: true,
            force,
            entityType: thing.thingType || thing.type || 'thing',
            entityId: thing.id,
            clientId
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

        const resolveRegionForPrompt = () => {
            if (templateOverrides.currentRegion && typeof templateOverrides.currentRegion === 'object') {
                return templateOverrides.currentRegion;
            }
            if (templateOverrides.region && typeof templateOverrides.region === 'object') {
                return templateOverrides.region;
            }
            if (templateOverrides.regionId && regions.has(templateOverrides.regionId)) {
                return regions.get(templateOverrides.regionId);
            }
            if (stubMetadata.regionId && regions.has(stubMetadata.regionId)) {
                return regions.get(stubMetadata.regionId);
            }
            if (stubMetadata.targetRegionId && regions.has(stubMetadata.targetRegionId)) {
                return regions.get(stubMetadata.targetRegionId);
            }
            if (stubLocation) {
                const region = findRegionByLocationId(stubLocation.id);
                if (region) {
                    return region;
                }
            }
            if (resolvedOriginLocation) {
                const region = findRegionByLocationId(resolvedOriginLocation.id);
                if (region) {
                    return region;
                }
            }
            if (currentPlayer?.currentLocation) {
                const region = findRegionByLocationId(currentPlayer.currentLocation);
                if (region) {
                    return region;
                }
            }
            return null;
        };

        const buildRegionPromptContext = (region) => {
            if (!region) {
                return null;
            }

            const regionData = typeof region.toJSON === 'function' ? region.toJSON() : region;
            const nameSource = regionData.name || regionData.regionName;
            const descriptionSource = regionData.description || regionData.regionDescription;

            const normalizedName = typeof nameSource === 'string' && nameSource.trim()
                ? nameSource.trim()
                : 'Unknown Region';
            const normalizedDescription = typeof descriptionSource === 'string' && descriptionSource.trim()
                ? descriptionSource.trim()
                : 'No region description available.';

            const locationNames = new Set();

            const collectLocationName = (value) => {
                if (!value) {
                    return;
                }
                const name = typeof value === 'string' ? value.trim() : (typeof value.name === 'string' ? value.name.trim() : '');
                if (name) {
                    locationNames.add(name);
                }
            };

            if (Array.isArray(regionData.locationIds)) {
                for (const id of regionData.locationIds) {
                    if (!id) continue;
                    const existingLocation = gameLocations.get(id);
                    if (existingLocation && typeof existingLocation.name === 'string') {
                        collectLocationName(existingLocation.name);
                    } else {
                        collectLocationName(id);
                    }
                }
            }

            if (Array.isArray(regionData.locations)) {
                for (const entry of regionData.locations) {
                    collectLocationName(entry);
                }
            }

            if (Array.isArray(regionData.locationBlueprints)) {
                for (const blueprint of regionData.locationBlueprints) {
                    collectLocationName(blueprint);
                }
            }

            const locations = Array.from(locationNames).map(name => ({ name }));

            return {
                name: normalizedName,
                description: normalizedDescription,
                locations
            };
        };

        const regionForPrompt = resolveRegionForPrompt();

        if (regionForPrompt && templateOverrides.regionAverageLevel === undefined) {
            const averageLevel = typeof regionForPrompt.averageLevel === 'number'
                ? regionForPrompt.averageLevel
                : (typeof regionForPrompt?.toJSON === 'function' && typeof regionForPrompt.toJSON().averageLevel === 'number'
                    ? regionForPrompt.toJSON().averageLevel
                    : null);
            if (Number.isFinite(averageLevel)) {
                templateOverrides.regionAverageLevel = averageLevel;
            }
        }

        let currentRegionContext = buildRegionPromptContext(regionForPrompt);

        if (!currentRegionContext) {
            const fallbackName = typeof templateOverrides.regionName === 'string' ? templateOverrides.regionName : stubMetadata.targetRegionName;
            const fallbackDescription = typeof templateOverrides.regionDescription === 'string'
                ? templateOverrides.regionDescription
                : (stubMetadata.targetRegionDescription || null);
            if (fallbackName || fallbackDescription) {
                currentRegionContext = {
                    name: (fallbackName && fallbackName.trim()) || 'Unknown Region',
                    description: (fallbackDescription && fallbackDescription.trim()) || 'No region description available.',
                    locations: []
                };
            }
        }

        if (currentRegionContext && (!Array.isArray(templateOverrides.existingLocations) || !templateOverrides.existingLocations.length)) {
            templateOverrides.existingLocations = currentRegionContext.locations.map(loc => loc.name).filter(Boolean);
        }

        if (currentRegionContext && !templateOverrides.currentRegion) {
            templateOverrides.currentRegion = currentRegionContext;
        }

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
        const promptConfig = await renderLocationGeneratorPrompt(templateOptions);
        if (!promptConfig?.systemPrompt || !promptConfig?.generationPrompt) {
            throw new Error('Failed to render location generation prompt.');
        }

        const { systemPrompt, generationPrompt } = promptConfig;

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

        console.log('🤖 Requesting location generation from AI...');
        //console.log('📝 System Prompt:', systemPrompt);
        //console.log('📤 Full Request Payload:', JSON.stringify({ messages }, null, 2));

        const requestStart = Date.now();
        const aiResponse = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'location_generation'
        });

        if (!aiResponse || !aiResponse.trim()) {
            throw new Error('Invalid response from AI API');
        }

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
                relativeLevelBase,
                regionId: currentRegionContext?.id
            })
            : Location.fromXMLSnippet(aiResponse, {
                baseLevelFallback,
                relativeLevelBase,
                regionId: currentRegionContext?.id
            });

        if (!location) {
            throw new Error('Failed to parse location from AI response');
        }

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

        try {
            await ensureLocationNameAllowed(location);
        } catch (error) {
            console.warn(`Failed to ensure location name for generated location ${location.id}:`, error.message);
        }

        console.log(`🏗️  Successfully generated location: ${location.name || location.id}`);

        console.log(`💾 Added location ${location.id} to game world (total: ${gameLocations.size})`);

        try {
            Globals.updateSpinnerText({ message: `Generating items and scenery for location ${location.name || location.id}...` });
            await generateLocationThingsForLocation({
                location
            });
        } catch (thingError) {
            console.warn('Failed to generate location things:', thingError.message);
        }

        const newlyCreatedStubs = [];

        if (isStubExpansion && resolvedOriginLocation) {
            const travelDirection = stubMetadata.originDirection || 'forward';
            const cleanedDescription = `${location.name || 'an adjacent area'}`;
            const stubVehicleType = typeof stubMetadata?.vehicleType === 'string' ? stubMetadata.vehicleType : null;
            const stubIsVehicle = Boolean(stubMetadata?.isVehicleExit || stubVehicleType);
            ensureExitConnection(resolvedOriginLocation, location, {
                description: cleanedDescription,
                bidirectional: false
            });

            const reverseDirection = getOppositeDirection(travelDirection) || 'back';
            const returnDescription = `${resolvedOriginLocation.name || 'the previous area'}`;
            ensureExitConnection(location, resolvedOriginLocation, {
                description: returnDescription,
                bidirectional: false
            });
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

            newlyCreatedStubs.push(...await createStubNeighbors(location, {
                excludeDirections,
                ...stubCreationContext
            }));

            if (newlyCreatedStubs.length > 0) {
                console.log(`🧭 ${location.name || location.id} now has ${newlyCreatedStubs.length} unexplored stub location(s) awaiting discovery.`);
            }
        }

        Globals.updateSpinnerText({ message: `Generating NPCs for location ${location.name || location.id}...` });
        await generateLocationNPCs({
            location,
            systemPrompt,
            generationPrompt,
            aiResponse,
            regionTheme: templateOverrides.locationTheme || templateOverrides.theme || (stubMetadata ? stubMetadata.themeHint : null)
        });

        return {
            location: location,
            aiResponse: aiResponse,
            generationPrompt: generationPrompt,
            generationOptions: templateOptions,
            newStubs: newlyCreatedStubs,
            isStubExpansion,
            generationHints: location.generationHints
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

function renderExistingRegionExitPrompt({ sourceRegion, sourceLocation, targetRegion }) {
    try {
        const templateName = 'region-existing-exit.xml.njk';
        const variables = {
            sourceRegion: {
                name: sourceRegion?.name || 'Unknown Region',
                description: sourceRegion?.description || 'No description provided.'
            },
            sourceLocation: {
                name: sourceLocation?.name || sourceLocation?.id || 'Unknown Location',
                summary: sourceLocation?.description
                    || sourceLocation?.stubMetadata?.shortDescription
                    || sourceLocation?.stubMetadata?.blueprintDescription
                    || 'No summary provided.'
            },
            targetRegion: {
                name: targetRegion?.name || 'Unknown Region',
                description: targetRegion?.description || 'No description provided.',
                locations: Array.isArray(targetRegion?.locationIds)
                    ? targetRegion.locationIds
                        .map(id => gameLocations.get(id))
                        .filter(Boolean)
                        .map(loc => ({
                            name: loc.name || loc.id,
                            description: loc.description
                                || loc.stubMetadata?.blueprintDescription
                                || loc.stubMetadata?.shortDescription
                                || 'No description provided.'
                        }))
                    : []
            }
        };

        const renderedTemplate = promptEnv.render(templateName, variables);
        const parsed = parseXMLTemplate(renderedTemplate);
        const systemPrompt = parsed.systemPrompt ? parsed.systemPrompt.trim() : null;
        const generationPrompt = parsed.generationPrompt ? parsed.generationPrompt.trim() : null;

        if (!generationPrompt) {
            throw new Error('Existing region exit template missing generationPrompt');
        }

        return { systemPrompt, generationPrompt };
    } catch (error) {
        console.error('Error rendering existing region exit template:', error);
        return null;
    }
}

function parseExistingRegionExitResponse(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return null;
    }

    try {
        const sanitize = (input) => `<root>${input}</root>`
            .replace(/&(?![#a-zA-Z0-9]+;)/g, '&amp;')
            .replace(/<\s*br\s*>/gi, '<br/>')
            .replace(/<\s*hr\s*>/gi, '<hr/>');

        const sanitized = sanitize(xmlSnippet.trim());
        const doc = Utils.parseXmlDocument(sanitized, 'text/xml');

        if (!doc || doc.getElementsByTagName('parsererror')?.length) {
            throw new Error('Parser error');
        }

        const exitNode = doc.getElementsByTagName('remoteExit')[0] || doc.documentElement;
        if (!exitNode) {
            return null;
        }

        const nameNode = exitNode.getElementsByTagName('name')[0] || doc.getElementsByTagName('name')[0];
        const reasonNode = exitNode.getElementsByTagName('reason')[0] || doc.getElementsByTagName('reason')[0];
        const name = nameNode ? nameNode.textContent.trim() : null;
        const reason = reasonNode ? reasonNode.textContent.trim() : null;

        if (!name) {
            return null;
        }

        return { name, reason };
    } catch (error) {
        console.warn('Failed to parse existing region exit response:', error.message);
        return null;
    }
}

async function chooseExistingRegionExit({
    sourceRegion,
    sourceLocation,
    targetRegion
}) {
    const prompt = renderExistingRegionExitPrompt({ sourceRegion, sourceLocation, targetRegion });
    if (!prompt) {
        return null;
    }

    const messages = [];
    if (prompt.systemPrompt) {
        messages.push({ role: 'system', content: prompt.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt.generationPrompt });

    try {
        const requestStart = Date.now();
        console.log(`🚪 Requesting existing region exit from ${sourceRegion?.name || sourceRegion?.id || 'unknown region'}`
            + ` via ${sourceLocation?.name || sourceLocation?.id || 'unknown location'} to ${targetRegion?.name || targetRegion?.id || 'target region'}.`);

        const aiResponse = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'existing_region_exit'
        });

        const durationSeconds = (Date.now() - requestStart) / 1000;

        try {
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
            const sourceRegionLabel = (sourceRegion?.id || sourceRegion?.name || 'unknown').toString().replace(/[^a-z0-9_-]+/gi, '_');
            const targetRegionLabel = (targetRegion?.id || targetRegion?.name || 'unknown').toString().replace(/[^a-z0-9_-]+/gi, '_');
            const logPath = path.join(logDir, `region_existing_exit_${sourceRegionLabel}_${targetRegionLabel}_${timestamp}.log`);

            const logParts = [
                formatDurationLine(durationSeconds),
                '=== EXISTING REGION EXIT CONTEXT ===',
                JSON.stringify({
                    sourceRegion: {
                        id: sourceRegion?.id || null,
                        name: sourceRegion?.name || null
                    },
                    sourceLocation: {
                        id: sourceLocation?.id || null,
                        name: sourceLocation?.name || null
                    },
                    targetRegion: {
                        id: targetRegion?.id || null,
                        name: targetRegion?.name || null
                    }
                }, null, 2),
                '\n=== EXISTING REGION EXIT SYSTEM PROMPT ===',
                prompt.systemPrompt || '(none)',
                '\n=== EXISTING REGION EXIT PROMPT ===',
                prompt.generationPrompt || '(none)',
                '\n=== EXISTING REGION EXIT RESPONSE ===',
                normalizedResponse || '(empty)',
                '\n'
            ];

            fs.writeFileSync(logPath, logParts.join('\n'), 'utf8');
            console.log(`📝 Existing region exit request logged to ${logPath}`);
        } catch (logError) {
            console.warn('Failed to log existing region exit prompt:', logError?.message || logError);
        }

        const parsed = parseExistingRegionExitResponse(normalizedResponse);
        if (parsed?.name) {
            console.log(`🚪 Existing region exit selected: ${parsed.name}`);
        } else {
            console.log('🚪 Existing region exit selection returned no result.');
        }
        return parsed;
    } catch (error) {
        console.warn('Failed to choose existing region exit location:', error.message);
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
        doc = Utils.parseXmlDocument(sanitize(xmlSnippet.trim()), 'text/xml');
    } catch (error) {
        console.warn('Failed to parse region exits XML:', error.message);
        return [];
    }

    if (!doc || doc.getElementsByTagName('parsererror')?.length) {
        console.warn('Region exits XML contained parser errors.');
        return [];
    }

    const getFirstChildByTag = (node, tag) => {
        if (!node) {
            return null;
        }
        const tagLower = tag.toLowerCase();
        const candidates = Array.from(node.childNodes || []);
        return candidates.find(child => child.nodeType === 1 && child.tagName && child.tagName.toLowerCase() === tagLower) || null;
    };

    const getChildValue = (node, tag) => {
        const child = getFirstChildByTag(node, tag);
        if (!child || typeof child.textContent !== 'string') {
            return null;
        }
        const trimmed = child.textContent.trim();
        return trimmed || null;
    };

    const stubRegions = Array.from(doc.getElementsByTagName('stubRegion'));
    const results = [];

    const tryAppend = ({ name, description, relativeLevel, relationship, exitLocation, exitVehicle }) => {
        if (!name) {
            return;
        }
        const parsedLevel = Number.parseInt(relativeLevel, 10);
        results.push({
            name,
            description: description || '',
            relativeLevel: Number.isFinite(parsedLevel) ? parsedLevel : 0,
            relationship: relationship || 'Adjacent',
            exitLocation,
            exitVehicle: exitVehicle || null
        });
    };

    if (stubRegions.length) {
        for (const stubNode of stubRegions) {
            const locationNode = (() => {
                let current = stubNode.parentNode;
                while (current) {
                    if (current.tagName && current.tagName.toLowerCase() === 'location') {
                        return current;
                    }
                    current = current.parentNode;
                }
                return null;
            })();

            const locationName = locationNode ? getChildValue(locationNode, 'name') : null;

            const name = getChildValue(stubNode, 'regionName');
            const description = getChildValue(stubNode, 'regionDescription');
            const relativeLevel = getChildValue(stubNode, 'relativeLevel');
            const relationship = getChildValue(stubNode, 'relationshipToCurrentRegion');
            const exitLocation = locationName || getChildValue(stubNode, 'exitLocation') || null;
            const exitVehicle = getChildValue(stubNode, 'exitVehicle');

            tryAppend({ name, description, relativeLevel, relationship, exitLocation, exitVehicle });
        }
    }

    if (!results.length) {
        const legacyRegions = Array.from(doc.getElementsByTagName('connectedRegions'))
            .concat(Array.from(doc.getElementsByTagName('regions')))
            .flatMap(parent => Array.from(parent.getElementsByTagName('region')));

        for (const node of legacyRegions) {
            const name = getChildValue(node, 'regionName');
            const description = getChildValue(node, 'regionDescription');
            const relativeLevel = getChildValue(node, 'relativeLevel');
            const relationship = getChildValue(node, 'relationshipToCurrentRegion');
            const exitLocation = getChildValue(node, 'exitLocation');
            const exitVehicle = getChildValue(node, 'exitVehicle');

            tryAppend({ name, description, relativeLevel, relationship, exitLocation, exitVehicle });
        }
    }

    return results;
}

async function renderRegionStubPrompt({ settingDescription, region, previousRegion, regionNotes }) {
    try {
        const minRegionExitOverride = Region.stubRegionCount <= 2 ? 1 : null;
        const promptConfig = await renderRegionGeneratorPrompt({
            mode: 'stub',
            currentRegion: region,
            regionName: region?.name || null,
            regionDescription: region?.description || null,
            regionNotes: regionNotes || region?.regionNotes || null,
            setting: settingDescription || null,
            minRegionExits: minRegionExitOverride
        });

        if (!promptConfig) {
            throw new Error('Region stub prompt renderer returned no data');
        }

        console.log(`🧩 Rendering region stub prompt for region "${region?.name || region?.id || 'unknown'}"`);
        return promptConfig;
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
        doc = Utils.parseXmlDocument(sanitize(xmlSnippet.trim()), 'text/xml');
    } catch (error) {
        console.warn('Failed to parse region stub XML:', error.message);
        return [];
    }

    if (!doc || doc.getElementsByTagName('parsererror')?.length) {
        console.warn('Region stub XML contained parser errors.');
        return [];
    }

    const resolveLocationNodes = () => {
        const regionNode = doc.getElementsByTagName('region')[0];
        if (regionNode) {
            const locationsParent = regionNode.getElementsByTagName('locations')?.[0];
            if (locationsParent) {
                const nodes = Array.from(locationsParent.getElementsByTagName('location'));
                if (nodes.length) {
                    return nodes;
                }
            }
        }

        const directLocationsParent = doc.getElementsByTagName('locations')?.[0];
        if (directLocationsParent) {
            const nodes = Array.from(directLocationsParent.getElementsByTagName('location'));
            if (nodes.length) {
                return nodes;
            }
        }

        return Array.from(doc.getElementsByTagName('location'));
    };

    const locationNodes = resolveLocationNodes();
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
    predefinedDefinitions = null
}) {
    if (!region) {
        return;
    }

    const definitions = Array.isArray(predefinedDefinitions)
        ? predefinedDefinitions.filter(Boolean)
        : [];

    if (!definitions.length) {
        console.warn(`No connected region definitions supplied for region "${region?.name || region?.id || 'unknown'}"; skipping exit stub generation.`);
        return;
    }

    const bannedSet = getBannedLocationNameSet();
    const renameTargets = definitions.filter(definition => {
        if (!definition || typeof definition.name !== 'string' || !definition.name.trim()) {
            return false;
        }
        if (!isLocationNameBanned(definition.name, bannedSet)) {
            return false;
        }
        if (typeof Region.getByName === 'function') {
            const existingRegion = Region.getByName(definition.name);
            if (existingRegion) {
                return false;
            }
        }
        return true;
    });

    if (renameTargets.length) {
        try {
            await regenerateRegionNames(renameTargets);
        } catch (error) {
            throw new Error(`Failed to regenerate banned region stub names: ${error.message}`);
        }
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
            const fallbackLocation = (region.entranceLocationId && gameLocations.get(region.entranceLocationId))
                || (region.locationIds || [])
                    .map(id => gameLocations.get(id))
                    .find(Boolean)
                || null;

            if (!fallbackLocation) {
                console.warn(`No fallback location available in region ${region.name}; skipping exit stub for "${definition.name}".`);
                continue;
            }

            console.warn(`Falling back to use ${fallbackLocation.name || fallbackLocation.id} for exit location "${definition.exitLocation}".`);
            sourceLocation = fallbackLocation;
        }

        const existingRegion = Region.getByName(definition.name);
        if (existingRegion) {
            await connectExistingRegion({
                region,
                sourceLocation,
                existingRegion,
                definition
            });
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
                    if (pending && normalizeRegionLocationName(pending.originalName || pending.name) === normalizedTargetName) {
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
        const vehicleLabel = definition.exitVehicle || null;
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
            relativeLevel: Number.isFinite(definition.relativeLevel) ? definition.relativeLevel : 0,
            settingDescription
        };

        if (newRegionParentId) {
            stubMetadata.targetRegionParentId = newRegionParentId;
        }
        if (baseLevel !== null) {
            stubMetadata.regionAverageLevel = baseLevel;
        }
        if (vehicleLabel) {
            stubMetadata.vehicleType = vehicleLabel;
            stubMetadata.isVehicleExit = true;
        }

        const regionEntryStub = new Location({
            name: stubName,
            description: null,
            regionId: newRegionId,
            checkRegionId: false,
            baseLevel: computedBaseLevel,
            isStub: true,
            stubMetadata
        });

        gameLocations.set(regionEntryStub.id, regionEntryStub);
        try {
            await ensureLocationNameAllowed(regionEntryStub);
        } catch (error) {
            console.warn(`Failed to ensure location name for region entry stub ${regionEntryStub.id}:`, error.message);
        }

        const stubAliases = new Set([
            normalizeRegionLocationName(regionEntryStub.name),
            normalizeRegionLocationName(stubName)
        ]);
        stubAliases.forEach(alias => {
            if (alias) {
                stubMap.set(alias, regionEntryStub);
            }
        });

        const exitDescription = `${definition.name}`;
        ensureExitConnection(sourceLocation, regionEntryStub, {
            description: exitDescription,
            bidirectional: false,
            destinationRegion: newRegionId,
            isVehicle: Boolean(vehicleLabel),
            vehicleType: vehicleLabel
        });

        pendingRegionStubs.set(newRegionId, {
            id: newRegionId,
            name: regionEntryStub.name || definition.name,
            originalName: definition.name,
            description: definition.description,
            relationship: definition.relationship,
            relativeLevel: Number.isFinite(definition.relativeLevel) ? definition.relativeLevel : 0,
            parentRegionId: newRegionParentId,
            sourceRegionId: region.id,
            exitLocationId: sourceLocation.id,
            entranceStubId: regionEntryStub.id,
            createdAt: new Date().toISOString()
        });

        console.log(`🌐 Created pending region stub for "${regionEntryStub.name || definition.name}" linked to ${region.name}.`);
    }
}


async function connectExistingRegion({
    region,
    sourceLocation,
    existingRegion,
    definition
}) {
    if (!region || !sourceLocation || !existingRegion) {
        return;
    }

    const exitChoice = await chooseExistingRegionExit({
        sourceRegion: region,
        sourceLocation,
        targetRegion: existingRegion
    });

    const candidateLocations = Array.isArray(existingRegion.locationIds)
        ? existingRegion.locationIds
            .map(id => gameLocations.get(id))
            .filter(Boolean)
        : [];

    const targetNameNormalized = exitChoice?.name
        ? normalizeRegionLocationName(exitChoice.name)
        : null;

    let remoteLocation = targetNameNormalized
        ? candidateLocations.find(loc => normalizeRegionLocationName(loc.name) === targetNameNormalized)
        : null;

    if (!remoteLocation && candidateLocations.length) {
        remoteLocation = candidateLocations[0];
    }

    if (!remoteLocation) {
        console.warn(`Could not determine remote location for existing region connection to "${existingRegion.name}".`);
        return;
    }

    const vehicleLabel = definition.exitVehicle || null;

    const relativeLevelOffset = Number.isFinite(definition.relativeLevel)
        ? Math.max(-10, Math.min(10, Math.round(definition.relativeLevel)))
        : null;

    const resolveSourceLevelReference = () => {
        if (Number.isFinite(sourceLocation?.baseLevel)) {
            return sourceLocation.baseLevel;
        }
        if (Number.isFinite(existingRegion?.averageLevel)) {
            return existingRegion.averageLevel;
        }
        if (Number.isFinite(region?.averageLevel)) {
            return region.averageLevel;
        }
        return currentPlayer?.level || 1;
    };

    ensureExitConnection(sourceLocation, remoteLocation, {
        description: existingRegion.name,
        destinationRegion: existingRegion.id,
        isVehicle: Boolean(vehicleLabel),
        vehicleType: vehicleLabel || null
    });

    ensureExitConnection(remoteLocation, sourceLocation, {
        description: region.name,
        destinationRegion: region.id,
        isVehicle: Boolean(vehicleLabel),
        vehicleType: vehicleLabel || null
    });

    if (relativeLevelOffset !== null) {
        const sourceLevel = resolveSourceLevelReference();
        const adjustedAverage = clampLevel(sourceLevel + relativeLevelOffset, sourceLevel);

        try {
            existingRegion.setAverageLevel(adjustedAverage);
        } catch (error) {
            console.warn(`Failed to adjust average level for existing region ${existingRegion.name || existingRegion.id}:`, error.message);
        }

        if (remoteLocation && (remoteLocation.isStub || !Number.isFinite(remoteLocation.baseLevel))) {
            try {
                remoteLocation.baseLevel = adjustedAverage;
            } catch (error) {
                console.warn(`Failed to adjust base level for location ${remoteLocation.name || remoteLocation.id}:`, error.message);
            }
        }
    }

    console.log(`🔗 Linked existing region "${region.name}" ↔ "${existingRegion.name}" via ${sourceLocation.name || sourceLocation.id} and ${remoteLocation.name || remoteLocation.id}.`);
}


function parseRegionEntranceResponse(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
        return null;
    }

    try {
        const match = xmlSnippet.match(/<entrance>[\s\S]*?<\/entrance>/i);
        const entranceXml = match ? match[0] : xmlSnippet;
        const xmlDoc = Utils.parseXmlDocument(entranceXml, 'text/xml');

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
    predefinedExitDefinitions = null
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
            regionId: region.id,
            checkRegionId: false,
            stubMetadata: {
                regionId: region.id,
                regionName: region.name,
                blueprintDescription: blueprint.description,
                suggestedRegionExits: (blueprint.exits || []).map(exit => {
                    if (!exit) {
                        return null;
                    }
                    if (typeof exit === 'string') {
                        return exit;
                    }
                    if (typeof exit === 'object' && typeof exit.target === 'string') {
                        return exit.target;
                    }
                    return null;
                }).filter(Boolean),
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

        await ensureLocationNameAllowed(stub);

        const aliases = new Set();
        aliases.add(normalizeRegionLocationName(stub.name));
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
                    existingExit.description = `${toStub.name}`;
                } catch (_) {
                    existingExit.update({ description: `${toStub.name}` });
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
            description: `${toStub.name}`,
            destination: toStub.id,
            bidirectional: true
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
        const exits = Array.isArray(blueprint.exits) ? blueprint.exits : [];

        exits.forEach(exitInfo => {
            const targetLabel = typeof exitInfo === 'string'
                ? exitInfo
                : (exitInfo && typeof exitInfo.target === 'string' ? exitInfo.target : null);
            if (!targetLabel) return;

            const candidateAliases = [normalizeRegionLocationName(targetLabel)];
            const directStub = candidateAliases
                .map(alias => stubMap.get(alias))
                .find(Boolean);
            const targetStub = directStub;
            if (!targetStub) {
                return;
            }

            const forwardDirection = targetLabel;
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
        predefinedDefinitions: predefinedExitDefinitions
    });

    return stubMap;
}

async function chooseRegionEntrance({
    region,
    stubMap,
    systemPrompt,
    generationPrompt,
    aiResponse
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

        console.log('🚪 Requesting region entrance selection...');
        const entranceResponse = await LLMClient.chatCompletion({
            messages: entranceMessages,
            metadataLabel: 'region_entrance_selection'
        });

        const entranceMessage = typeof entranceResponse === 'string' ? entranceResponse.trim() : '';
        if (!entranceMessage) {
            console.warn('Entrance selection response was empty.');
            return;
        }
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
        const { report: progressReporter, ...rawOptions } = options || {};
        const report = typeof progressReporter === 'function'
            ? (stage, payload = {}) => {
                try {
                    progressReporter(stage, payload);
                } catch (_) {
                    // Ignore reporter errors
                }
            }
            : () => { };

        report('region:prepare', { message: 'Preparing region prompt...' });

        const settingDescription = rawOptions.setting || describeSettingForPrompt(getActiveSettingSnapshot());
        const generationOptions = { ...rawOptions, setting: settingDescription };
        const promptConfig = await renderRegionGeneratorPrompt(generationOptions);
        if (!promptConfig?.systemPrompt || !promptConfig?.generationPrompt) {
            throw new Error('Failed to render region generation prompt.');
        }

        const { systemPrompt, generationPrompt } = promptConfig;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: generationPrompt }
        ];

        report('region:request', { message: 'Requesting region layout from AI...' });

        console.log('🗺️ Requesting region generation from AI...');
        const requestStart = Date.now();
        const aiResponse = await LLMClient.chatCompletion({
            messages,
            //temperature: parsedTemplate.temperature,
            metadataLabel: 'region_generation'
        });

        if (!aiResponse || !aiResponse.trim()) {
            throw new Error('Invalid response from AI API for region generation');
        }

        console.log('📥 Region AI Response received.');
        report('region:response', { message: 'Region response received.' });

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
        await ensureRegionNameAllowed(region);
        const connectedRegionDefinitions = parseRegionExitsResponse(aiResponse);
        regions.set(region.id, region);
        report('region:parse', { message: 'Interpreting region blueprint...' });

        const themeHint = generationOptions.regionNotes || null;

        const baseAverageLevel = Number.isFinite(region.averageLevel)
            ? region.averageLevel
            : (Number.isFinite(generationOptions.averageLevel) ? generationOptions.averageLevel : 1);
        const regionAverageLevel = baseAverageLevel;

        let stubMap = new Map();
        try {
            report('region:instantiate', { message: 'Placing region locations...' });
            stubMap = await instantiateRegionLocations({
                region,
                themeHint,
                regionAverageLevel,
                settingDescription,
                predefinedExitDefinitions: connectedRegionDefinitions
            });
        } catch (instantiationError) {
            console.warn('Failed to instantiate region structure:', instantiationError.message);
        }

        const entranceInfo = await chooseRegionEntrance({
            region,
            stubMap,
            systemPrompt,
            generationPrompt,
            aiResponse
        });
        report('region:entrance', { message: 'Selecting region entrance...' });
        const entranceLocationId = entranceInfo.locationId || null;
        if (!region.entranceLocationId && entranceLocationId) {
            region.entranceLocationId = entranceLocationId;
        }

        console.log(`* Region character concepts:`, region.characterConcepts);

        report('region:npcs', { message: 'Populating region with NPCs...' });
        await generateRegionNPCs({
            region,
            systemPrompt,
            generationPrompt,
            aiResponse
        });

        report('region:complete', { message: 'Region generation complete.' });

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
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));

// Route for AI RPG Chat Interface
app.get('/', (req, res) => {
    //const systemPrompt = renderSystemPrompt(currentSetting);
    const activeSetting = getActiveSettingSnapshot();

    res.render('index.njk', {
        title: 'AI RPG Chat Interface',
        //systemPrompt: systemPrompt,
        chatHistory: chatHistory,
        currentPage: 'chat',
        player: currentPlayer ? currentPlayer.getStatus() : null,
        availableSkills: Array.from(skills.values()).map(skill => skill.toJSON()),
        currentSetting: activeSetting,
        rarityDefinitions,
        checkMovePlausibility: config.check_move_plausibility || 'never'
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
    const savedMessage = req.query.saved === '1'
        ? 'Configuration saved successfully! Restart the server for all changes to take effect.'
        : null;
    const errorMessage = typeof req.query.error === 'string' && req.query.error.trim()
        ? req.query.error.trim()
        : null;

    res.render('config.njk', {
        title: 'AI RPG Configuration',
        config: config,
        currentPage: 'config',
        savedMessage,
        errorMessage
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

        if (typeof updatedConfig.model_swap_options === 'string') {
            try {
                const parsedOptions = JSON.parse(updatedConfig.model_swap_options);
                updatedConfig.model_swap_options = Array.isArray(parsedOptions)
                    ? parsedOptions.filter(option => typeof option === 'string' && option.trim()).map(option => option.trim())
                    : [];
            } catch (_) {
                if (updatedConfig.model_swap_options) {
                    updatedConfig.model_swap_options = String(updatedConfig.model_swap_options)
                        .split(/[\n,]+/)
                        .map(entry => entry.trim())
                        .filter(Boolean);
                } else {
                    updatedConfig.model_swap_options = [];
                }
            }
        }
        if (!Array.isArray(updatedConfig.model_swap_options)) {
            updatedConfig.model_swap_options = [];
        }
        updatedConfig.model_swap_options = Array.from(new Set(
            updatedConfig.model_swap_options.map(option => option.trim()).filter(Boolean)
        ));

        // Save to config.yaml file
        const yamlString = yaml.dump(updatedConfig, {
            defaultFlowStyle: false,
            quotingType: '"',
            forceQuotes: false
        });

        fs.writeFileSync(path.join(__dirname, 'config.yaml'), yamlString, 'utf8');

        // Update in-memory config
        config = updatedConfig;

        const wantsJson = req.xhr
            || (typeof req.headers.accept === 'string' && req.headers.accept.includes('application/json'))
            || req.headers['x-requested-with'] === 'fetch';

        if (wantsJson) {
            return res.json({
                success: true,
                message: 'Configuration saved successfully! Restart the server for all changes to take effect.'
            });
        }

        return res.redirect('/config?saved=1');

    } catch (error) {
        console.error('Error saving configuration:', error);
        const wantsJson = req.xhr
            || (typeof req.headers.accept === 'string' && req.headers.accept.includes('application/json'))
            || req.headers['x-requested-with'] === 'fetch';

        if (wantsJson) {
            return res.status(500).json({
                success: false,
                message: `Error saving configuration: ${error.message}`
            });
        }

        const encodedError = encodeURIComponent(error.message || 'Unknown error');
        return res.redirect(`/config?error=${encodedError}`);
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
    prepareBasePromptContext,
    promptEnv,
    parseXMLTemplate,
    findActorByName,
    findActorById,
    findThingByName,
    findLocationByNameLoose,
    findRegionByNameLoose,
    findRegionByLocationId,
    generateItemsByNames,
    createLocationFromEvent,
    scheduleStubExpansion,
    ensureUniqueThingNames,
    expandRegionEntryStub,
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
    createRegionStubFromEvent,
    getCurrencyLabel,
    pushChatEntry,
    generatedImages,
    pendingRegionStubs,
    alterThingByPrompt,
    regenerateLocationName,
    confirmQuestWithPlayer: ({ clientId, quest, requestId }) => questConfirmationManager.requestConfirmation({ clientId, quest, requestId }),
    defaultStatusDuration: Events.DEFAULT_STATUS_DURATION,
    majorStatusDuration: Events.MAJOR_STATUS_DURATION,
    baseTimeoutMilliseconds,
    baseDir: __dirname
});

// API routes are registered via api.js
const apiScope = {
    app,
    server,
    axios,
    yaml,
    fs,
    path,
    Utils,
    nunjucks,
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
    restoreCharacterHealthToMaximum,
    generateLocationFromPrompt,
    generateLocationImage,
    generatePlayerImage,
    generateRegionFromPrompt,
    createLocationFromEvent,
    createRegionStubFromEvent,
    generateSkillsList,
    generateSkillsByNames,
    generateThingImage,
    generateItemsByNames,
    expandRegionEntryStub,
    queueLocationThingImages,
    requestNpcAbilityAssignments,
    applyNpcAbilities,
    generateLevelUpAbilitiesForCharacter,
    getActiveSettingSnapshot,
    buildNewGameDefaults,
    getSuggestedPlayerLevel,
    parseXMLTemplate,
    queueNpcAssetsForLocation,
    resolveActionOutcome,
    resolveLocationStyle,
    scheduleStubExpansion,
    ensureExitConnection,
    shouldGenerateNpcImage,
    shouldGenerateThingImage,
    questConfirmationManager,
    getJobSnapshot,
    tickStatusEffectsForAction,
    buildLocationShortDescription,
    buildLocationPurpose,
    buildNpcProfiles,
    serializeNpcForClient,
    buildThingProfiles,
    describeSettingForPrompt,
    findActorByName,
    findThingByName,
    findRegionByLocationId,
    generateNpcFromEvent,
    generateImageId,
    processJobQueue,
    runPlausibilityCheck,
    prepareBasePromptContext,
    normalizeChatEntry,
    pushChatEntry,
    players,
    skills,
    things,
    regions,
    gameLocations,
    gameLocationExits,
    pendingRegionStubs,
    regionEntryExpansionPromises,
    pendingLocationImages,
    npcGenerationPromises,
    levelUpAbilityPromises,
    stubExpansionPromises,
    imageJobs,
    jobQueue,
    generatedImages,
    baseTimeoutMilliseconds,
    imageFileExists,
    realtimeHub,
    addJobSubscriber
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
defineApiStateProperty('currentTurnToken', () => currentTurnToken, value => { currentTurnToken = value; });

const registerApiRoutes = require('./api');
registerApiRoutes(apiScope);

if (typeof module !== 'undefined' && module.exports) {
    module.exports.performGameSave = (...args) => apiScope.performGameSave(...args);
    module.exports.performGameLoad = (...args) => apiScope.performGameLoad(...args);
}

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
            health: -1,
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
        })
            .catch(error => {
                console.warn('Failed to generate default player inventory:', error.message);
            })
            .finally(() => {
                restoreCharacterHealthToMaximum(defaultPlayer);
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
    try {
        await initializeImageEngine();
    } catch (error) {
        console.error('❌ Failed to initialize image engine:', error.message);
        throw error;
    }

    // Step 3: Prepare realtime hub and start the server
    try {
        realtimeHub.attach(server, { path: '/ws' });
    } catch (error) {
        console.error('⚠️  Failed to initialize realtime hub:', error.message);
    }

    server.listen(PORT, HOST, () => {
        console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
        console.log(`📡 API endpoint available at http://${HOST}:${PORT}/api/hello`);
        console.log(`🎮 Using AI model: ${config.ai.model}`);
        console.log(`🤖 AI endpoint: ${config.ai.endpoint}`);

        if (config.imagegen && config.imagegen.enabled) {
            if (comfyUIClient) {
                if ((config.imagegen.engine || 'comfyui') === 'nanogpt') {
                    console.log('🎨 Image generation ready (NanoGPT)');
                } else {
                    console.log(`🎨 Image generation ready (ComfyUI: ${config.imagegen.server.host}:${config.imagegen.server.port})`);
                }
            } else {
                console.log('🎨 Image generation disabled (engine unavailable)');
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
function getExperiencePointValues() {
    if (cachedExperiencePointValues) {
        return cachedExperiencePointValues;
    }

    const xpPath = path.join(__dirname, 'defs', 'experience_point_values.yaml');
    try {
        if (!fs.existsSync(xpPath)) {
            cachedExperiencePointValues = [];
            return cachedExperiencePointValues;
        }
        const raw = fs.readFileSync(xpPath, 'utf8');
        const parsed = yaml.load(raw);
        const results = [];

        const addEntry = (action, value) => {
            const trimmedAction = typeof action === 'string' ? action.trim() : '';
            const stringValue = value === null || value === undefined ? '' : String(value).trim();
            if (!trimmedAction) {
                return;
            }
            results.push({
                action: trimmedAction,
                value: stringValue
            });
        };

        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (entry === null || entry === undefined) {
                    continue;
                }
                if (typeof entry === 'object' && !Array.isArray(entry)) {
                    for (const [key, value] of Object.entries(entry)) {
                        addEntry(key, value);
                    }
                    continue;
                }
                const text = String(entry).trim();
                if (!text) {
                    continue;
                }
                const separatorIndex = text.indexOf(':');
                if (separatorIndex >= 0) {
                    const action = text.slice(0, separatorIndex);
                    const value = text.slice(separatorIndex + 1);
                    addEntry(action, value);
                } else {
                    addEntry(text, '');
                }
            }
        } else if (parsed && typeof parsed === 'object') {
            for (const [key, value] of Object.entries(parsed)) {
                addEntry(key, value);
            }
        }

        cachedExperiencePointValues = results;
        return cachedExperiencePointValues;
    } catch (error) {
        console.warn('Failed to load experience point values:', error.message);
        cachedExperiencePointValues = [];
        return cachedExperiencePointValues;
    }
}
