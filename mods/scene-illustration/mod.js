/**
 * Scene Illustration Mod
 * 
 * Adds a "Generate Illustration" button to chat messages that creates
 * AI-generated scene illustrations based on the current game context.
 */

const fs = require('fs');
const path = require('path');

// Mod metadata
module.exports.meta = {
    name: 'Scene Illustration',
    version: '1.0.0',
    description: 'Generate AI illustrations of the current scene based on chat context'
};

// Configuration schema
module.exports.configSchema = {
    aiModel: {
        type: 'modelSelect',
        label: 'Text AI Model (Prompt Gen)',
        description: 'Model to use for generating image prompts. Leave empty to use default.',
        default: ''
    }
};

/**
 * Register the mod with the game scope
 * @param {Object} scope - The mod scope from ModLoader
 */
module.exports.register = function(scope) {
    const {
        app,
        modName,
        modDir,
        registerModRoute,
        renderModPrompt,
        config,
        chatHistory,
        currentPlayer,
        gameLocations,
        regions,
        players,
        Location,
        prepareBasePromptContext,
        parseXMLTemplate,
        promptEnv,
        generateImageId,
        createImageJob,
        processJobQueue,
        jobQueue,
        imageJobs,
        comfyUIClient,
        addJobSubscriber,
        getJobSnapshot,
        findRegionByLocationId,
        nunjucks,
        modConfig // Injected by ModLoader
    } = scope;

    // Set up Nunjucks environment for mod prompts
    const modPromptsDir = path.join(modDir, 'prompts');
    const modPromptEnv = nunjucks.configure(modPromptsDir, {
        autoescape: false
    });

    console.log(`      🎨 Initializing Scene Illustration mod...`);

    // Persistence for scene illustration jobs
    const dataDir = path.join(modDir, 'data');
    const sceneIllustrationsFile = path.join(dataDir, 'sceneIllustrations.json');
    
    // In-memory store for persisted scene illustrations
    let persistedIllustrations = [];

    /**
     * Load persisted scene illustrations from disk
     */
    function loadPersistedIllustrations() {
        try {
            if (fs.existsSync(sceneIllustrationsFile)) {
                const data = fs.readFileSync(sceneIllustrationsFile, 'utf8');
                persistedIllustrations = JSON.parse(data);
                console.log(`      🎨 Loaded ${persistedIllustrations.length} persisted scene illustrations`);
            }
        } catch (error) {
            console.warn('      ⚠️ Failed to load persisted scene illustrations:', error.message);
            persistedIllustrations = [];
        }
    }

    /**
     * Save persisted scene illustrations to disk
     */
    function savePersistedIllustrations() {
        try {
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(sceneIllustrationsFile, JSON.stringify(persistedIllustrations, null, 2));
        } catch (error) {
            console.warn('      ⚠️ Failed to save persisted scene illustrations:', error.message);
        }
    }

    /**
     * Add a completed illustration to the persisted store
     */
    function persistIllustration(jobData) {
        // Prevent duplicates
        const existing = persistedIllustrations.find(ill => ill.id === jobData.id);
        if (!existing) {
            persistedIllustrations.push(jobData);
            savePersistedIllustrations();
        }
    }

    // Load persisted illustrations on mod init
    loadPersistedIllustrations();

    /**
     * Get current location object
     */
    function getCurrentLocation() {
        const player = scope.currentPlayer;
        if (!player || !player.currentLocation) {
            return null;
        }
        try {
            return Location.get(player.currentLocation);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get NPCs at current location
     */
    function getNpcsAtLocation(locationId) {
        const npcs = [];
        if (!locationId) return npcs;

        for (const [id, player] of players) {
            if (player.isNPC && player.currentLocation === locationId) {
                npcs.push({
                    id: player.id,
                    name: player.name,
                    description: player.description,
                    class: player.class,
                    race: player.race
                });
            }
        }
        return npcs;
    }

    /**
     * Get party members
     */
    function getPartyMembers() {
        const party = [];
        const player = scope.currentPlayer;
        if (!player) {
            return party;
        }

        const memberIds = (() => {
            // Player exposes partyMembers as a Set; fall back to any legacy array
            if (player.partyMembers && typeof player.partyMembers[Symbol.iterator] === 'function') {
                return Array.from(player.partyMembers);
            }
            if (Array.isArray(player.party)) {
                return player.party;
            }
            return [];
        })();

        for (const memberId of memberIds) {
            const member = players.get(memberId);
            if (member && member.id !== player.id) {
                party.push({
                    id: member.id,
                    name: member.name,
                    description: member.description,
                    class: member.class,
                    race: member.race
                });
            }
        }
        return party;
    }

    /**
     * Get recent chat messages for context
     * @param {number} count - Number of messages to retrieve
     * @param {string} upToTimestamp - Optional timestamp to get messages up to
     */
    function getRecentMessages(count = 5, upToTimestamp = null) {
        const history = scope.chatHistory || [];
        // Filter and sort by timestamp to ensure chronological order
        // Helper to safely get timestamp
        const getTs = (t) => {
            if (typeof t === 'number') return t;
            if (!isNaN(t)) return Number(t);
            return new Date(t).getTime();
        };

        let messages = history
            .filter(m => m.role !== 'system')
            .sort((a, b) => {
                return getTs(a.timestamp) - getTs(b.timestamp);
            });

        if (upToTimestamp !== null && upToTimestamp !== undefined) {
            // Find the message with a matching timestamp
            // Use getTs for robust comparison (handles strings vs Date objects)
            const targetTs = getTs(upToTimestamp);
            const idx = messages.findIndex(m => getTs(m.timestamp) === targetTs);
            
            if (idx >= 0) {
                // Include the target message and everything before it
                messages = messages.slice(0, idx + 1);
            } else {
                console.warn(`Scene Illustration: Could not find message with timestamp ${upToTimestamp} (TS: ${targetTs}) in history.`);
                // Fail secure: If we can't find the message, do NOT use latest context.
                // Either return empty or throw. Returning empty context is safer than leaking future.
                // But better to let the user know.
                throw new Error('Could not verify message context in history. Please try a newer message.');
            }
        }

        return messages.slice(-count).map(m => ({
            role: m.role,
            content: m.content
        }));
    }

    /**
     * Build the scene illustration prompt context
     */
    async function buildSceneContext(messageTimestamp = null) {
        const location = getCurrentLocation();
        const locationDetails = location ? location.getDetails() : null;
        const region = location ? findRegionByLocationId(location.id) : null;
        const player = scope.currentPlayer;

        // Get setting info  
        let setting = {
            name: 'Fantasy World',
            description: 'A magical fantasy world',
            genre: 'Fantasy',
            theme: 'Adventure',
            magicLevel: 'High',
            techLevel: 'Medieval',
            tone: 'Heroic'
        };

        try {
            const activeSettingSnapshot = scope.getActiveSettingSnapshot?.();
            if (activeSettingSnapshot) {
                setting = {
                    name: activeSettingSnapshot.name || setting.name,
                    description: activeSettingSnapshot.description || setting.description,
                    genre: activeSettingSnapshot.genre || setting.genre,
                    theme: activeSettingSnapshot.theme || setting.theme,
                    magicLevel: activeSettingSnapshot.magicLevel || setting.magicLevel,
                    techLevel: activeSettingSnapshot.techLevel || setting.techLevel,
                    tone: activeSettingSnapshot.tone || setting.tone
                };
            }
        } catch (e) {
            console.warn('Could not get active setting:', e.message);
        }

        return {
            setting,
            location: {
                name: locationDetails?.name || location?.name || 'Unknown Location',
                description: locationDetails?.description || location?.description || 'No description available'
            },
            region: region ? {
                name: region.name,
                description: region.description
            } : null,
            player: player ? {
                name: player.name,
                description: player.description,
                class: player.class,
                race: player.race
            } : null,
            npcs: getNpcsAtLocation(location?.id),
            party: getPartyMembers(),
            recentMessages: getRecentMessages(5, messageTimestamp),
            scenery: location?.scenery || []
        };
    }

    /**
     * Render the scene illustration prompt
     */
    function renderSceneIllustrationPrompt(context) {
        try {
            const rendered = modPromptEnv.render('scene-illustration.xml.njk', context);
            return parseXMLTemplate(rendered);
        } catch (error) {
            console.error('Failed to render scene illustration prompt:', error);
            throw error;
        }
    }

    /**
     * Generate scene illustration image
     */
    async function generateSceneIllustration(options = {}) {
        const { messageTimestamp = null, clientId = null } = options;

        // Check if image generation is enabled
        if (!config.imagegen || !config.imagegen.enabled) {
            return {
                success: false,
                error: 'Image generation is not enabled'
            };
        }

        if (!scope.comfyUIClient) {
            return {
                success: false,
                error: 'Image generation client not initialized'
            };
        }

        try {
            // Build context for prompt
            const sceneContext = await buildSceneContext(messageTimestamp);

            // Render the prompt template
            const prompts = renderSceneIllustrationPrompt(sceneContext);

            if (!prompts.systemPrompt || !prompts.generationPrompt) {
                throw new Error('Failed to generate prompts from template');
            }

            // Use LLM to generate the final image prompt
            const LLMClient = require(require('path').join(scope.modLoader.baseDir, 'LLMClient.js'));
            const messages = [
                { role: 'system', content: prompts.systemPrompt },
                { role: 'user', content: prompts.generationPrompt }
            ];

            // Fetch current mod config dynamically (not the snapshot from initialization)
            const currentModConfig = scope.modLoader.getModConfig(modName);
            const useCustomModel = currentModConfig && currentModConfig.aiModel && currentModConfig.aiModel.trim() !== '';
            
            console.log(`🎨 Generating scene illustration prompt via LLM... ${useCustomModel ? `(Model: ${currentModConfig.aiModel})` : '(Default Model)'}`);
            const requestStart = Date.now();
            
            const llmOptions = {
                messages,
                metadataLabel: 'scene_illustration_prompt',
                validateXML: false
            };

            // Use custom model if configured
            if (useCustomModel) {
                llmOptions.model = currentModConfig.aiModel.trim();
            }

            const responseText = await LLMClient.chatCompletion(llmOptions);

            if (!responseText || !responseText.trim()) {
                throw new Error('LLM returned empty response');
            }

            const durationSeconds = (Date.now() - requestStart) / 1000;
            console.log(`🎨 LLM prompt generated in ${durationSeconds.toFixed(1)}s`);

            // Clean up the prompt
            let finalPrompt = responseText
                .replace(/[""]/g, '"')
                .replace(/['']/g, "'")
                .replace(/[—–]/g, '-')
                .trim();

            // Apply scenery prefix if available
            try {
                const activeSettingSnapshot = scope.getActiveSettingSnapshot?.();
                const prefix = activeSettingSnapshot?.imagePromptPrefixScenery || '';
                if (prefix.trim()) {
                    finalPrompt = `${prefix.trim()}\n\n${finalPrompt}`;
                }
            } catch (e) {
                // Ignore prefix errors
            }

            // Log the prompt
            try {
                const logsDir = require('path').join(scope.modLoader.baseDir, 'logs');
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }
                const timestamp = Date.now();
                const logPath = require('path').join(logsDir, `scene_illustration_${timestamp}.log`);
                const logContent = [
                    `Duration: ${durationSeconds.toFixed(2)}s`,
                    '=== SYSTEM PROMPT ===',
                    prompts.systemPrompt,
                    '',
                    '=== GENERATION PROMPT ===',
                    prompts.generationPrompt,
                    '',
                    '=== FINAL IMAGE PROMPT ===',
                    finalPrompt
                ].join('\n');
                fs.writeFileSync(logPath, logContent, 'utf8');
            } catch (logError) {
                console.warn('Failed to log scene illustration prompt:', logError.message);
            }

            // Create the image job
            const jobId = generateImageId();
            const sceneSettings = config.imagegen.scene_settings || config.imagegen.location_settings || {};
            
            const payload = {
                prompt: finalPrompt,
                width: sceneSettings.image?.width || 1024,
                height: sceneSettings.image?.height || 768,
                steps: sceneSettings.sampling?.steps || 30,
                seed: Math.floor(Math.random() * 1000000),
                negative_prompt: 'blurry, low quality, distorted, deformed, ugly, bad anatomy, text, watermark, signature, ui elements',
                megapixels: config.imagegen.megapixels || 1.0,
                entityType: 'scene',
                entityId: `scene_${Date.now()}`,
                clientId
            };

            console.log(`🎨 Creating scene illustration job: ${jobId}`);

            const job = createImageJob(jobId, payload);
            jobQueue.push(jobId);

            // Start processing if not already running
            setTimeout(() => processJobQueue(), 0);

            // Handle completion to update chat message
            if (messageTimestamp) {
                const checkJob = setInterval(() => {
                    // Access job directly from scope to get full result object
                    const job = scope.imageJobs ? scope.imageJobs.get(jobId) : null;
                    
                    if (job && job.status === 'completed' && job.result) {
                        clearInterval(checkJob);
                        
                        // Get image URL from result
                        const result = job.result;
                        const imageUrl = result.images && result.images.length > 0 ? result.images[0].url : null;
                        
                        if (imageUrl) {
                            // Persist the illustration for gallery
                            persistIllustration({
                                id: jobId,
                                status: 'completed',
                                timestamp: job.createdAt || new Date().toISOString(),
                                prompt: job.payload?.prompt || '',
                                imageUrl: imageUrl
                            });

                            // Update chat message
                            const history = scope.chatHistory;
                            const msg = history.find(m => m.timestamp === messageTimestamp);
                            if (msg) {
                                const imageMarkdown = `\n\n![Scene Illustration](${imageUrl})`;
                                
                                // Only append if not already there
                                if (!msg.content.includes(imageUrl)) {
                                    msg.content += imageMarkdown;
                                    console.log(`🎨 Attached illustration ${jobId} to message ${messageTimestamp}`);
                                }
                                
                                // Notify clients
                                const hub = scope.realtimeHub;
                                if (hub) {
                                    hub.emit(clientId || null, 'scene_illustration_complete', {
                                        jobId,
                                        messageTimestamp,
                                        imageUrl
                                    });
                                }
                            }
                        }
                    } else if (job && job.status === 'failed') {
                        clearInterval(checkJob);
                        // Notify failure
                        const hub = scope.realtimeHub;
                        if (hub) {
                            hub.emit(clientId || null, 'scene_illustration_failed', {
                                jobId,
                                messageTimestamp,
                                error: job.error || 'Generation failed'
                            });
                        }
                    } else if (!job) {
                        // Job lost?
                        clearInterval(checkJob);
                    }
                }, 1000);
            } else {
                // Even without messageTimestamp, monitor for completion to persist
                const checkJobForPersist = setInterval(() => {
                    const job = scope.imageJobs ? scope.imageJobs.get(jobId) : null;
                    
                    if (job && job.status === 'completed' && job.result) {
                        clearInterval(checkJobForPersist);
                        
                        const result = job.result;
                        const imageUrl = result.images && result.images.length > 0 ? result.images[0].url : null;
                        
                        if (imageUrl) {
                            persistIllustration({
                                id: jobId,
                                status: 'completed',
                                timestamp: job.createdAt || new Date().toISOString(),
                                prompt: job.payload?.prompt || '',
                                imageUrl: imageUrl
                            });
                        }
                    } else if (job && job.status === 'failed') {
                        clearInterval(checkJobForPersist);
                    } else if (!job) {
                        clearInterval(checkJobForPersist);
                    }
                }, 1000);
            }

            // Subscribe client to job updates
            if (clientId) {
                addJobSubscriber(jobId, clientId, { emitSnapshot: true });
            }

            return {
                success: true,
                jobId: jobId,
                status: job.status,
                message: 'Scene illustration generation started',
                estimatedTime: '30-90 seconds'
            };

        } catch (error) {
            console.error('Error generating scene illustration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Register API endpoint
    scope.registerModRoute('post', '/generate', async (req, res) => {
        try {
            const { messageTimestamp, clientId } = req.body || {};

            // Use provided clientId or extract from headers
            const resolvedClientId = clientId || req.headers['x-client-id'] || null;

            const result = await generateSceneIllustration({
                messageTimestamp,
                clientId: resolvedClientId
            });

            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            console.error('Scene illustration API error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Also expose functions for potential use by other mods
    scope.sceneIllustration = {
        generateSceneIllustration,
        buildSceneContext,
        renderSceneIllustrationPrompt
    };

    console.log(`      🎨 Scene Illustration mod loaded`);

    // Register API endpoint to get jobs history
    scope.registerModRoute('get', '/jobs', (req, res) => {
        try {
            const jobsMap = new Map(); // Use map to deduplicate by ID
            
            // First, add all persisted illustrations
            for (const ill of persistedIllustrations) {
                jobsMap.set(ill.id, {
                    id: ill.id,
                    status: ill.status,
                    timestamp: ill.timestamp,
                    prompt: ill.prompt,
                    imageUrl: ill.imageUrl,
                    error: null
                });
            }
            
            // Then, add/update with in-memory jobs (these are more current)
            const imageJobs = scope.imageJobs;
            if (imageJobs) {
                for (const job of imageJobs.values()) {
                    // Filter for scene illustration jobs
                    if (job.payload && job.payload.entityType === 'scene') {
                        let imageUrl = null;
                        
                        // Extract image URL from result if available
                        if (job.status === 'completed' && job.result && job.result.images && job.result.images.length > 0) {
                            imageUrl = job.result.images[0].url;
                        }
                        
                        jobsMap.set(job.id, {
                            id: job.id,
                            status: job.status,
                            timestamp: job.timestamp || job.createdAt,
                            prompt: job.payload.prompt,
                            imageUrl: imageUrl,
                            error: job.error
                        });
                    }
                }
            }
            
            // Convert map to array and sort by timestamp descending
            const jobs = Array.from(jobsMap.values());
            jobs.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                return timeB - timeA;
            });
            
            res.json({ success: true, jobs });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete a scene illustration job
    scope.registerModRoute('delete', '/jobs/:jobId', (req, res) => {
        try {
            const { jobId } = req.params;
            if (!jobId) {
                return res.status(400).json({ success: false, error: 'Job ID is required' });
            }

            let found = false;
            let imageUrl = null;

            // Find the image URL before deleting (needed to remove from chat)
            const persistedIll = persistedIllustrations.find(ill => ill.id === jobId);
            if (persistedIll && persistedIll.imageUrl) {
                imageUrl = persistedIll.imageUrl;
            }

            // Check in-memory jobs if not found in persisted
            if (!imageUrl) {
                const imageJobs = scope.imageJobs;
                if (imageJobs && imageJobs.has(jobId)) {
                    const job = imageJobs.get(jobId);
                    if (job.result && job.result.images && job.result.images.length > 0) {
                        imageUrl = job.result.images[0].url;
                    }
                }
            }

            // Remove from persisted illustrations
            const initialLength = persistedIllustrations.length;
            persistedIllustrations = persistedIllustrations.filter(ill => ill.id !== jobId);
            if (persistedIllustrations.length < initialLength) {
                found = true;
                savePersistedIllustrations();
            }

            // Remove from in-memory imageJobs if present
            const imageJobs = scope.imageJobs;
            if (imageJobs && imageJobs.has(jobId)) {
                imageJobs.delete(jobId);
                found = true;
            }

            // Remove the image from chat history if we found the URL
            if (imageUrl) {
                const chatHistory = scope.chatHistory;
                if (Array.isArray(chatHistory)) {
                    chatHistory.forEach(message => {
                        if (message && typeof message.content === 'string' && message.content.includes(imageUrl)) {
                            // Remove markdown image syntax containing this URL
                            // Matches ![any alt text](imageUrl) or just the URL
                            const imageMarkdownRegex = new RegExp(`\\n*!\\[[^\\]]*\\]\\(${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n*`, 'g');
                            message.content = message.content.replace(imageMarkdownRegex, '').trim();
                            console.log(`🎨 Removed image from chat message`);
                        }
                    });
                }
            }

            if (found) {
                console.log(`🎨 Deleted scene illustration: ${jobId}`);
                res.json({ success: true, message: 'Scene illustration deleted' });
            } else {
                res.status(404).json({ success: false, error: 'Scene illustration not found' });
            }
        } catch (error) {
            console.error('Failed to delete scene illustration:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
};
