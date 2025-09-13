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
            
            res.json({ response: aiResponse });
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

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
    console.log(`📡 API endpoint available at http://${HOST}:${PORT}/api/hello`);
    console.log(`🎮 Using AI model: ${config.ai.model}`);
    console.log(`🤖 AI endpoint: ${config.ai.endpoint}`);
});
