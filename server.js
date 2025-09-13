const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Import Player class
const Player = require('./Player.js');

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

// In-memory chat history storage
let chatHistory = [];

// In-memory player storage (temporary - will be replaced with persistent storage later)
let currentPlayer = null;
const players = new Map(); // Store multiple players by ID
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
        chatHistory: chatHistory
    });
});

// Configuration page routes
app.get('/config', (req, res) => {
    res.render('config.njk', {
        title: 'AI RPG Configuration',
        config: config
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
app.post('/api/player', (req, res) => {
    try {
        const { name, attributes, level } = req.body;

        const player = new Player({
            name: name || 'New Player',
            attributes: attributes || {},
            level: level || 1
        });

        players.set(player.id, player);
        currentPlayer = player;

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
        player: currentPlayer ? currentPlayer.getStatus() : null
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

    const debugData = {
        title: 'Debug: Player Information',
        player: currentPlayer ? currentPlayer.getStatus() : null,
        playerStatus: currentPlayer ? currentPlayer.getStatus() : null,
        playerJson: currentPlayer ? currentPlayer.toJSON() : null,
        totalPlayers: players.size,
        currentPlayerId: currentPlayer ? currentPlayer.toJSON().id : null,
        allPlayers: allPlayersData,
        allLocations: locationsData
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

        // Update basic information
        if (name && name.trim()) {
            currentPlayer.setName(name.trim());
        }

        if (description !== undefined) {
            currentPlayer.setDescription(description.trim());
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
app.post('/api/player/create-from-stats', (req, res) => {
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

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
    console.log(`📡 API endpoint available at http://${HOST}:${PORT}/api/hello`);
    console.log(`🎮 Using AI model: ${config.ai.model}`);
    console.log(`🤖 AI endpoint: ${config.ai.endpoint}`);
});
