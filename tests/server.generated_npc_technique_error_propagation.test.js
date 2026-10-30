'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function assertTechniqueErrorsPropagate(catchSnippet, description) {
    const escaped = catchSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`catch\\s*\\(npcError\\)\\s*\\{\\s*if\\s*\\(isGeneratedNpcTechniqueError\\(npcError\\)\\)\\s*throw\\s+npcError;[\\s\\S]*?${escaped}`);
    assert.match(serverSource, pattern, `${description} must rethrow technique-initialization failures before ordinary NPC fallback handling`);
}

test('location NPC Promise catch propagates technique initialization errors instead of swallowing them', () => {
    assertTechniqueErrorsPropagate("console.warn('Failed to generate NPCs for location:'", 'location NPC Promise catch');
});

test('region stub NPC catch propagates technique initialization errors instead of treating them as optional', () => {
    assertTechniqueErrorsPropagate("console.warn('Failed to generate important NPCs for region stub:'", 'region stub NPC catch');
});
