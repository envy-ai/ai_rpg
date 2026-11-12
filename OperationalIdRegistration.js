'use strict';

const IdGenerator = require('./IdGenerator.js');
// Explicit operational namespaces only: name-derived domain IDs must never be
// interpreted as a new category merely because their names end in a number.
const categories = [
    'chat', 'image', 'image_job', 'image_request', 'comfy_prompt', 'comfy_client',
    'client', 'request', 'operation', 'turn', 'input_request', 'plot_analysis', 'container_check',
    'migration_backup', 'config_backup', 'prompt_file', 'cassette_tmp',
    'technique_world', 'editor_operation', 'learn_operation', 'quest_offer',
    'tinybrain_run', 'cachebuster', 'prompt_failure', 'completion', 'audit',
    'prompt', 'section', 'audit_event', 'arrival', 'housekeeping_request',
    'story', 'story_node', 'story_job', 'story_proposal', 'story_outline_run',
    'story_request', 'story_step', 'story_preview', 'world_lineage', 'story_binding',
    'story_materialization', 'story_packet', 'story_receipt', 'story_scene',
    'story_run', 'story_decision', 'story_bible', 'story_generation', 'story_dialog',
    'faction_seed', 'codex_call', 'kimi_call', 'cline_call', 'followup_request'
];
const sequential = new RegExp(`^(?:${categories.join('|')})_[1-9]\\d*$`);
const fields = new Set(['id', 'imageId', 'sourceImageId', 'operationId', 'turnId', 'requestId', 'parentId',
    'confirmationId', 'chatEntryId', 'sourceEntryId', 'arrivalId', 'worldLineageId', 'bindingId',
    'runId', 'jobId', 'promptId', 'completionId', 'auditId', 'sectionId', 'decisionId', 'packetId',
    'entryId', 'startEntryId', 'endEntryId', 'lastHousekeepingTurnId', 'lastReviewedTurnId']);

function registerOperationalIds(snapshot) {
    const visit = (value, field = '') => {
        if (typeof value === 'string') {
            if (fields.has(field) && sequential.test(value)) IdGenerator.registerSequential(value);
            return;
        }
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const entry of value) visit(entry, field); return; }
        for (const [key, entry] of Object.entries(value)) {
            if (sequential.test(key)) IdGenerator.registerSequential(key);
            visit(entry, key);
        }
    };
    visit(snapshot);
}

module.exports = { registerOperationalIds };
