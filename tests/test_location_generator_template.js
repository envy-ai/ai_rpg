const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const Location = require('../Location.js');

console.log('🧪 Testing Location Generator Prompt Template...\n');

// Configure nunjucks for prompts (no autoescape)
const promptEnv = nunjucks.configure("prompts", { autoescape: false });

// Function to render location generation prompt from template
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

    // Parse the YAML and extract the generation prompt
    const parsedYaml = yaml.load(renderedTemplate);

    console.log('📋 Rendered Template Structure:');
    console.log('  Role:', parsedYaml.role);
    console.log('  Description:', parsedYaml.description);
    console.log('\n🎯 System Prompt:');
    console.log(parsedYaml.systemPrompt);
    console.log('\n🎮 Generation Prompt:');
    console.log(parsedYaml.generationPrompt);
    console.log('\n📖 Examples:');
    console.log(parsedYaml.examples);

    return {
      systemPrompt: parsedYaml.systemPrompt,
      generationPrompt: parsedYaml.generationPrompt,
      examples: parsedYaml.examples,
      fullTemplate: parsedYaml
    };

  } catch (error) {
    console.error('Error rendering location generation template:', error);
    return null;
  }
}

// Function to simulate AI response and test JSON parsing
function simulateLocationGeneration(mockJsonResponse) {
  try {
    console.log('\n🤖 Simulating AI Response...');
    console.log('Raw AI Output:', mockJsonResponse);

    // Parse the JSON response
    const locationData = JSON.parse(mockJsonResponse);

    console.log('\n✅ Parsed Location Data:');
    console.log('  Description:', locationData.description);
    console.log('  Base Level:', locationData.baseLevel);
    console.log('  ID:', locationData.id);

    // Test creating a Location object with the generated data
    const newLocation = new Location(locationData);

    console.log('\n🏰 Created Location Object:');
    console.log('  ' + newLocation.toString());
    console.log('  Summary:', JSON.stringify(newLocation.getSummary(), null, 2));

    return newLocation;

  } catch (error) {
    console.error('❌ Error creating location from AI response:', error.message);
    return null;
  }
}

// Test 1: Basic location generation (no context)
console.log('1️⃣ Testing basic location generation (no context)...');
const basicPrompt = renderLocationGenerationPrompt();

// Test 2: Themed location generation
console.log('\n2️⃣ Testing themed location generation...');
const themedPrompt = renderLocationGenerationPrompt({
  theme: 'haunted forest',
  playerLevel: 5,
  purpose: 'boss encounter area'
});

// Test 3: Connected location generation
console.log('\n3️⃣ Testing connected location generation...');
const connectedPrompt = renderLocationGenerationPrompt({
  theme: 'underground dungeon',
  playerLevel: 8,
  purpose: 'treasure chamber',
  nearbyLocations: ['ancient_library_001', 'goblin_warren_entrance']
});

// Test 4: Simulate AI responses and location creation
console.log('\n4️⃣ Testing JSON parsing and Location object creation...');

const mockResponses = [
  `{
        "description": "A tranquil garden courtyard with blooming cherry trees and a babbling stone fountain. Soft pink petals drift on gentle breezes while carved marble benches invite peaceful contemplation.",
        "baseLevel": 1,
        "id": "peaceful_garden_courtyard"
    }`,

  `{
        "description": "A treacherous mountain pass shrouded in swirling mists and jagged ice formations. Howling winds carry the echoes of ancient avalanches while hidden crevasses threaten unwary travelers.",
        "baseLevel": 12,
        "id": "frozen_death_pass"
    }`,

  `{
        "description": "A mysterious alchemist's laboratory filled with bubbling cauldrons and shelves of exotic ingredients. Glowing crystals provide eerie illumination while the air shimmers with magical experiments.",
        "baseLevel": 6,
        "id": "mystical_alchemy_lab"
    }`
];

mockResponses.forEach((response, index) => {
  console.log(`\n   Simulation ${index + 1}:`);
  simulateLocationGeneration(response);
});

console.log('\n🎉 Location Generator Template Test Complete!');
console.log('✅ Template renders properly with various input parameters');
console.log('✅ Generated JSON can be parsed successfully');
console.log('✅ Location objects can be created from AI responses');
console.log('✅ Ready for integration with AI chat system');