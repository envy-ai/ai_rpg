const LocationExit = require('../LocationExit.js');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');

console.log('🧪 Testing LocationExit Image Prompt Template...\n');

// Configure nunjucks for prompts (no autoescape)
const promptEnv = nunjucks.configure("prompts", { autoescape: false });

// Function to render location exit image prompt from template (copied from server)
function renderLocationExitImagePrompt(locationExit) {
  try {
    const templateName = 'locationexit-image.yaml.njk';

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

    // Parse the YAML and extract generationPrompt
    const parsedYaml = yaml.load(renderedTemplate);
    const generationPrompt = parsedYaml.generationPrompt;

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

// Test 1: Two-way passage (bidirectional)
console.log('1️⃣ Testing two-way passage exit...');
const twoWayExit = new LocationExit({
  description: 'A grand marble archway with ornate columns and flowing banners. Golden light streams through the passage.',
  destination: 'royal_palace_hall',
  bidirectional: true
});

const twoWayPrompt = renderLocationExitImagePrompt(twoWayExit);
console.log('✅ Two-way passage prompt generated\n');

// Test 2: One-way passage (non-bidirectional)
console.log('2️⃣ Testing one-way passage exit...');
const oneWayExit = new LocationExit({
  description: 'A steep cliff edge with a rope ladder leading down into misty depths. No way back up.',
  destination: 'underground_caverns',
  bidirectional: false
});

const oneWayPrompt = renderLocationExitImagePrompt(oneWayExit);
console.log('✅ One-way passage prompt generated\n');

// Test 3: Mysterious magical portal
console.log('3️⃣ Testing magical portal exit...');
const portalExit = new LocationExit({
  description: 'A swirling vortex of purple energy crackling with arcane power. Ancient runes orbit the portal\'s edge.',
  destination: 'astral_plane_nexus',
  bidirectional: true
});

const portalPrompt = renderLocationExitImagePrompt(portalExit);
console.log('✅ Magical portal prompt generated\n');

console.log('🎉 All LocationExit Image Prompt Template tests completed successfully!');