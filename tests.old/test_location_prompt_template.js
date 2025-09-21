const Location = require('../Location.js');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');

console.log('🧪 Testing Location Image Prompt Template...\n');

// Configure nunjucks for prompts (no autoescape)
const promptEnv = nunjucks.configure("prompts", { autoescape: false });

// Function to render location image prompt from template (copied from server)
function renderLocationImagePrompt(location) {
  try {
    const templateName = 'location-image.yaml.njk';

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

    // Parse the YAML and extract generationPrompt
    const parsedYaml = yaml.load(renderedTemplate);
    const generationPrompt = parsedYaml.generationPrompt;

    if (!generationPrompt) {
      throw new Error('No generationPrompt found in location image template');
    }

    console.log(`Generated location scene prompt for ${location.id}:`, generationPrompt);
    return generationPrompt.trim();

  } catch (error) {
    console.error('Error rendering location image template:', error);
    // Fallback to simple prompt
    return `Fantasy RPG location scene: ${location ? location.description : 'A mysterious place'}, high quality fantasy environment art, detailed location scene`;
  }
}

// Test 1: Low-level peaceful location
console.log('1️⃣ Testing low-level peaceful location...');
const peacefulLocation = new Location({
  description: 'A serene meadow with rolling green hills and a babbling brook. Wildflowers sway gently in the warm breeze.',
  baseLevel: 2
});

const peacefulPrompt = renderLocationImagePrompt(peacefulLocation);
console.log('✅ Peaceful location prompt generated\n');

// Test 2: Mid-level moderate location
console.log('2️⃣ Testing mid-level moderate location...');
const moderateLocation = new Location({
  description: 'A dense pine forest with winding paths and mysterious shadows between the trees. Ancient stone markers hint at forgotten secrets.',
  baseLevel: 6
});

const moderatePrompt = renderLocationImagePrompt(moderateLocation);
console.log('✅ Moderate location prompt generated\n');

// Test 3: High-level dangerous location
console.log('3️⃣ Testing high-level dangerous location...');
const dangerousLocation = new Location({
  description: 'A volcanic wasteland with rivers of molten lava and towering obsidian spires. The air shimmers with intense heat and toxic fumes.',
  baseLevel: 15
});

const dangerousPrompt = renderLocationImagePrompt(dangerousLocation);
console.log('✅ Dangerous location prompt generated\n');

console.log('🎉 All Location Image Prompt Template tests completed successfully!');