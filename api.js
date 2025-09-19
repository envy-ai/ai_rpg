module.exports = function registerApiRoutes(scope) {
    if (!scope || typeof scope !== 'object' || !scope.app || typeof scope.app.use !== 'function') {
        throw new Error('registerApiRoutes requires a scope object containing an Express app');
    }

    if (!scope[Symbol.unscopables]) {
        Object.defineProperty(scope, Symbol.unscopables, {
            value: {},
            configurable: true
        });
    }

    with (scope) {
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
            let actionResolution = null;

            // Add the location with the id of currentPlayer.curentLocation to the player context if available
            if (currentPlayer && currentPlayer.currentLocation) {
                location = Location.get(currentPlayer.currentLocation);
            }

            if (currentPlayer && userMessage && userMessage.role === 'user') {
                try {
                    const tickResult = tickStatusEffectsForAction({ player: currentPlayer, location });
                    if (tickResult) {
                        location = tickResult.location || location;
                    }
                } catch (tickError) {
                    console.warn('Failed to update status effects before action:', tickError.message);
                }

                try {
                    plausibilityInfo = await runPlausibilityCheck({
                        actionText: userMessage.content,
                        locationId: currentPlayer.currentLocation || null
                    });
                    if (plausibilityInfo?.structured) {
                        actionResolution = resolveActionOutcome({
                            plausibility: plausibilityInfo.structured,
                            player: currentPlayer
                        });
                    }
                } catch (plausibilityError) {
                    console.warn('Failed to execute plausibility check:', plausibilityError.message);
                }
            }

            // If we have a current player, use the player action template for the system message
            if (currentPlayer && userMessage && userMessage.role === 'user') {
                try {
                    const baseContext = buildBasePromptContext({ locationOverride: location });
                    const templateName = 'base-context.xml.njk';

                    const playerActionPrompt = promptEnv.render(templateName, {
                        ...baseContext,
                        promptType: 'player-action',
                        actionText: userMessage.content,
                        success_or_failure: actionResolution?.label || 'success'
                    });

                    const promptData = parseXMLTemplate(playerActionPrompt);

                    if (!promptData.systemPrompt) {
                        throw new Error('Player action template missing system prompt.');
                    }

                    const systemMessage = {
                        role: 'system',
                        content: String(promptData.systemPrompt).trim()
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
                    debugInfo.actionResolution = actionResolution;
                    debugInfo.plausibilityStructured = plausibilityInfo?.structured || null;
                    responseData.debug = debugInfo;
                }

                if (actionResolution) {
                    responseData.actionResolution = actionResolution;
                }

                try {
                    const eventResult = await runEventChecks({ textToCheck: aiResponse });
                    if (eventResult) {
                        if (eventResult.html) {
                            responseData.eventChecks = eventResult.html;
                        }
                        if (eventResult.structured) {
                            responseData.events = eventResult.structured;
                            if (debugInfo) {
                                debugInfo.eventStructured = eventResult.structured;
                            }
                            if (currentPlayer && currentPlayer.currentLocation) {
                                try {
                                    location = Location.get(currentPlayer.currentLocation) || location;
                                } catch (_) {
                                    // ignore lookup failures here
                                }
                            }
                        }
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
            currentPage: 'player-stats',
            availableSkills: Array.from(skills.values()).map(skill => skill.toJSON())
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
            const { name, description, level, health, maxHealth, attributes, skills: skillValues, unspentSkillPoints } = req.body;

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

            if (skillValues && typeof skillValues === 'object') {
                for (const [skillName, value] of Object.entries(skillValues)) {
                    if (!isNaN(value)) {
                        currentPlayer.setSkillValue(skillName, parseInt(value));
                    }
                }
            }

            if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                currentPlayer.setUnspentSkillPoints(parseInt(unspentSkillPoints));
            }

            if (typeof currentPlayer.syncSkillsWithAvailable === 'function') {
                currentPlayer.syncSkillsWithAvailable();
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
            const { name, description, level, health, maxHealth, attributes, skills: skillValues, unspentSkillPoints } = req.body;

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

            if (skillValues && typeof skillValues === 'object') {
                playerData.skills = {};
                for (const [skillName, value] of Object.entries(skillValues)) {
                    if (!isNaN(value)) {
                        playerData.skills[skillName] = Math.max(0, parseInt(value));
                    }
                }
            }

            if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                playerData.unspentSkillPoints = Math.max(0, parseInt(unspentSkillPoints));
            }

            // Create the player
            const player = new Player(playerData);
            players.set(player.id, player);
            currentPlayer = player;

            if (typeof player.syncSkillsWithAvailable === 'function') {
                player.syncSkillsWithAvailable();
            }

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

    app.post('/api/player/skills/:skillName/increase', (req, res) => {
        try {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            const { skillName } = req.params;
            const amountRaw = req.body?.amount;
            const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : 1;

            const newRank = currentPlayer.increaseSkill(skillName, amount);

            res.json({
                success: true,
                player: currentPlayer.getStatus(),
                skill: {
                    name: skillName,
                    rank: newRank
                },
                amount
            });
        } catch (error) {
            console.error('Error increasing skill:', error);
            res.status(400).json({
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
            if (typeof newPlayer.syncSkillsWithAvailable === 'function') {
                newPlayer.syncSkillsWithAvailable();
            }

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

    }
};
