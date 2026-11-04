// Preserve the real context and tool policy helpers while tests mock completions.
const LLMClient = require('../../LLMClient.js');
module.exports = Object.fromEntries([
    'getBaseContextEndMarker', 'applyBaseContextToolPolicy', 'getTinyBrainToolChoice',
    'getTinyBrainToolExecutionState', 'assertTinyBrainAllowedToolNames'
].map(name => [name, LLMClient[name].bind(LLMClient)]));
