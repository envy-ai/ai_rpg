// Example integration functions for location-generator.yaml.njk template
// These functions would be added to server.js to support AI-driven location creation

const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const Location = require('./Location.js');

// Configure nunjucks for prompts (assuming this exists in server.js)
// const promptEnv = nunjucks.configure("prompts", { autoescape: false });

/**
 * Render the location generation prompt from template
 * @param {Object} options - Generation options
 * @param {string} [options.theme] - Theme/setting for the location
 * @param {number} [options.playerLevel] - Target player level
 * @param {string} [options.purpose] - Purpose/role in story
 * @param {string[]} [options.nearbyLocations] - Array of nearby location IDs
 * @returns {Object} - Rendered prompt data
 */
function renderLocationGenerationPrompt(options = {}) {
  try {
    const templateName = 'location-generator.yaml.njk';

    const variables = {
      locationTheme: options.theme || null,
      playerLevel: options.playerLevel || null,
      locationPurpose: options.purpose || null,
      nearbyLocations: options.nearbyLocations || null
    };

    // Render the template
    const renderedTemplate = promptEnv.render(templateName, variables);

    // Parse the YAML and extract prompts
    const parsedYaml = yaml.load(renderedTemplate);

    return {
      systemPrompt: parsedYaml.systemPrompt,
      generationPrompt: parsedYaml.generationPrompt,
      examples: parsedYaml.examples,
      fullTemplate: parsedYaml
    };

  } catch (error) {
    console.error('Error rendering location generation template:', error);
    throw new Error(`Location generation template error: ${error.message}`);
  }
}

/**
 * Generate a new location using AI
 * @param {Object} options - Generation options
 * @param {string} [options.theme] - Theme/setting for the location
 * @param {number} [options.playerLevel] - Target player level
 * @param {string} [options.purpose] - Purpose/role in story
 * @param {string[]} [options.nearbyLocations] - Array of nearby location IDs
 * @returns {Promise<Location>} - Generated Location object
 */
async function generateLocationWithAI(options = {}) {
  try {
    // Render the prompt template
    const promptData = renderLocationGenerationPrompt(options);

    // Prepare messages for AI API
    const messages = [
      {
        role: 'system',
        content: promptData.systemPrompt
      },
      {
        role: 'user',
        content: promptData.generationPrompt
      }
    ];

    console.log('🎲 Generating new location with AI...');
    console.log('Options:', JSON.stringify(options, null, 2));

    // Use configuration from config.yaml (assuming this exists in server.js)
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
      max_tokens: 500, // Shorter response needed for JSON
      temperature: 0.8 // Some creativity for variety
    };

    const response = await axios.post(chatEndpoint, requestData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (!response.data || !response.data.choices || !response.data.choices[0]) {
      throw new Error('Invalid response from AI API');
    }

    const aiResponse = response.data.choices[0].message.content.trim();
    console.log('🤖 AI Response:', aiResponse);

    // Parse the JSON response
    let locationData;
    try {
      // Try to extract JSON if it's wrapped in other text
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : aiResponse;
      locationData = JSON.parse(jsonText);
    } catch (parseError) {
      throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
    }

    // Validate required fields
    if (!locationData.description || !locationData.baseLevel || !locationData.id) {
      throw new Error('AI response missing required fields (description, baseLevel, id)');
    }

    // Create the Location object
    const newLocation = new Location(locationData);

    console.log('🏰 Generated location:', newLocation.toString());

    // Automatically generate location scene image if image generation is enabled
    try {
      if (config.imagegen && config.imagegen.enabled && comfyUIClient) {
        const imageResult = await generateLocationImage(newLocation);
        console.log(`🎨 Location scene generation initiated:`, imageResult);
      }
    } catch (imageError) {
      console.warn('Failed to generate location scene:', imageError.message);
      // Don't fail location creation if image generation fails
    }

    // Store in game world
    gameLocations.set(newLocation.id, newLocation);

    return newLocation;

  } catch (error) {
    console.error('Error generating location with AI:', error);
    throw error;
  }
}

/**
 * API endpoint for generating locations (would be added to server.js)
 */
app.post('/api/locations/generate', async (req, res) => {
  try {
    const { theme, playerLevel, purpose, nearbyLocations } = req.body;

    const options = {};
    if (theme) options.theme = theme;
    if (playerLevel) options.playerLevel = parseInt(playerLevel);
    if (purpose) options.purpose = purpose;
    if (nearbyLocations && Array.isArray(nearbyLocations)) {
      options.nearbyLocations = nearbyLocations;
    }

    const newLocation = await generateLocationWithAI(options);

    res.json({
      success: true,
      location: newLocation.getSummary(),
      message: 'Location generated successfully'
    });

  } catch (error) {
    console.error('Location generation API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API endpoint for getting all locations
 */
app.get('/api/locations', (req, res) => {
  const locationList = Array.from(gameLocations.values()).map(location => location.getSummary());

  res.json({
    success: true,
    locations: locationList,
    count: locationList.length
  });
});

/**
 * API endpoint for getting a specific location
 */
app.get('/api/locations/:id', (req, res) => {
  const location = gameLocations.get(req.params.id);

  if (!location) {
    return res.status(404).json({
      success: false,
      error: `Location '${req.params.id}' not found`
    });
  }

  res.json({
    success: true,
    location: location.getDetails()
  });
});

// Export functions for use in other modules if needed
module.exports = {
  renderLocationGenerationPrompt,
  generateLocationWithAI
};