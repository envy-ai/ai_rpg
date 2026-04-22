const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('alter_location handler uses context.location for tool-driven location alterations', async () => {
    const originalChatCompletion = LLMClient.chatCompletion;
    const originalConfig = Globals.config;
    const targetLocation = {
        id: 'loc-target',
        name: 'Remote Study',
        description: 'A smoke-stained room.',
        shortDescription: 'smoke-stained room',
        baseLevel: 2,
        getDetails() {
            return {
                name: this.name,
                description: this.description,
                shortDescription: this.shortDescription,
                baseLevel: this.baseLevel,
                generationHints: {}
            };
        },
        getStatusEffects() {
            return [];
        },
        addStatusEffect() {}
    };

    try {
        Globals.config = { strictXMLParsing: false };
        LLMClient.chatCompletion = async () => [
            '<location>',
            '<name>Restored Remote Study</name>',
            '<description>A clean study with repaired windows and polished worktables.</description>',
            '<baseLevel>2</baseLevel>',
            '<shortDescription>clean repaired study</shortDescription>',
            '</location>'
        ].join('');

        Events.initialize({
            getConfig: () => ({ ai: { temperature: 0 } }),
            promptEnv: {
                render() {
                    return '<template/>';
                }
            },
            parseXMLTemplate() {
                return {
                    systemPrompt: 'system',
                    generationPrompt: 'generation'
                };
            },
            prepareBasePromptContext: async () => ({}),
            Location: {
                get: () => targetLocation
            },
            generatedImages: new Map()
        });

        await Events._handlers.alter_location.call(Events, [
            {
                currentName: 'Remote Study',
                newName: 'Remote Study',
                description: 'Repair the windows and convert it into a clean workshop.'
            }
        ], {
            location: targetLocation
        });

        assert.equal(targetLocation.name, 'Restored Remote Study');
        assert.equal(targetLocation.description, 'A clean study with repaired windows and polished worktables.');
        assert.equal(targetLocation.shortDescription, 'clean repaired study');
    } finally {
        LLMClient.chatCompletion = originalChatCompletion;
        Globals.config = originalConfig;
    }
});

test('location alteration can preserve base level while applying text updates', () => {
    const generatedImages = new Map([
        ['old-image', { id: 'old-image' }],
        ['variant-image', { id: 'variant-image' }]
    ]);
    const location = {
        id: 'loc-preserve-level',
        name: 'Quiet Study',
        description: 'A dusty study.',
        shortDescription: 'dusty study',
        baseLevel: 4,
        imageId: 'old-image',
        clearImageVariants() {
            return [{ imageId: 'variant-image' }];
        },
        addStatusEffect() {}
    };

    const summary = Events._applyLocationAlteration({
        location,
        parsedLocation: {
            name: 'Restored Quiet Study',
            description: 'A clean study with repaired windows.',
            shortDescription: 'clean repaired study',
            baseLevel: 12
        },
        changeDescription: 'Repair the study without changing its danger level.',
        generatedImages,
        preserveBaseLevel: true
    });

    assert.equal(location.name, 'Restored Quiet Study');
    assert.equal(location.description, 'A clean study with repaired windows.');
    assert.equal(location.shortDescription, 'clean repaired study');
    assert.equal(location.baseLevel, 4);
    assert.equal(location.imageId, null);
    assert.equal(summary.baseLevelBefore, 4);
    assert.equal(summary.baseLevelAfter, 4);
    assert.equal(generatedImages.has('old-image'), false);
    assert.equal(generatedImages.has('variant-image'), false);
});
