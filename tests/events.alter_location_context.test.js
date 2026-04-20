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
