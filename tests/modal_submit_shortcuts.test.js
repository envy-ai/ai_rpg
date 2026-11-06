const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('shared shortcut is loaded on every common page and maps non-form modal inputs', () => {
    const head = read('views/_includes/head-common.njk');
    const index = read('views/index.njk');
    const config = read('views/config.njk');
    const settings = read('views/settings.njk');
    const lorebooks = read('views/lorebooks.njk');
    const chat = read('public/js/chat.js');

    assert.match(head, /\/js\/modal-submit-shortcuts\.js/);
    [
        ['mapFastTravelActionText', 'mapFastTravelConfirmBtn'],
        ['locationRegionFixerModal', 'locationRegionFixerConfirmBtn'],
        ['slashUploadModal', 'slashUploadSubmitBtn'],
        ['barterHaggleInput', 'barterHaggleBtn'],
        ['craftingNotesInput', 'craftingActionButton'],
        ['salvageIntentInput', 'salvageIntentSubmitBtn'],
        ['npcMemoriesModal', 'npcMemoriesSaveBtn'],
        ['npcGoalsModal', 'npcGoalsSaveBtn'],
        ['loadGameModal', 'loadGameConfirmBtn']
    ].forEach(([ownerId, actionId]) => {
        assert.match(
            index,
            new RegExp(`id="${ownerId}"[^>]*data-ctrl-enter-submit="#${actionId}"`),
            `${ownerId} should map Ctrl/Cmd+Enter to ${actionId}`
        );
    });
    assert.match(config, /id="addModelModal"[^>]*data-ctrl-enter-submit="#addModelConfirm"/);
    assert.match(settings, /id="autofillInstructionsModal"[^>]*data-ctrl-enter-submit="#autofillInstructionsConfirmBtn"/);
    assert.match(lorebooks, /id="uploadModal"[^>]*data-ctrl-enter-submit="#confirmUpload"/);
    assert.match(chat, /setAttribute\('data-ctrl-enter-submit', '\.chat-edit-modal__save'\)/);
    assert.doesNotMatch(index, /setupCtrlEnterSubmission|handleCraftingNotesCtrlEnter|handleSalvageIntentCtrlEnter/);
});

test('every static modal data-entry control has a form or explicit shortcut action', () => {
    const templatePaths = [
        'views/index.njk',
        'views/config.njk',
        'views/settings.njk',
        'views/lorebooks.njk'
    ];
    const uncovered = [];

    templatePaths.forEach((templatePath) => {
        const $ = cheerio.load(read(templatePath));
        $('.modal, .player-input-request-panel').each((_, modal) => {
            const modalId = $(modal).attr('id') || '(anonymous modal)';
            $(modal).find('input, textarea, select, [contenteditable="true"]').each((__, control) => {
                const element = $(control);
                const type = String(element.attr('type') || control.tagName || '').toLowerCase();
                const controlId = element.attr('id') || element.attr('name') || '(anonymous control)';
                const filterMarker = [
                    controlId,
                    element.attr('class'),
                    element.attr('aria-label'),
                    element.parent().attr('class')
                ].filter(Boolean).join(' ').toLowerCase();
                const intentionallyNonSubmitting = element.is('[readonly], [disabled], [hidden]')
                    || type === 'hidden'
                    || type === 'search'
                    || filterMarker.includes('filter')
                    || filterMarker.includes('showunavailable');
                const hasSubmissionPath = element.closest('form').length > 0
                    || element.closest('[data-ctrl-enter-submit]').length > 0;
                if (!intentionallyNonSubmitting && !hasSubmissionPath) {
                    uncovered.push(`${templatePath}: #${modalId} -> #${controlId}`);
                }
            });
        });
    });

    assert.deepEqual(uncovered, []);
});
