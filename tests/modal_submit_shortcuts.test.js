const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const rootDir = path.join(__dirname, '..');
const shortcuts = require('../public/js/modal-submit-shortcuts.js');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function createKeyboardEvent(target, overrides = {}) {
    return {
        target,
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
        isComposing: false,
        propagationStopped: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
            this.propagationStopped = true;
        },
        ...overrides
    };
}

function createControl({ dialog, form = null, explicitOwner = null } = {}) {
    const control = {
        disabled: false,
        readOnly: false,
        form,
        closest(selector) {
            if (selector === 'input, textarea, select, [contenteditable="true"]') {
                return control;
            }
            if (selector === '.modal, .chat-edit-modal, .quest-confirmation, .npc-selection-modal, .player-input-request-panel') {
                return dialog || null;
            }
            if (selector === '[role="dialog"]') {
                return dialog || null;
            }
            if (selector === '[data-ctrl-enter-submit]') {
                return explicitOwner || null;
            }
            if (selector === 'form') {
                return form || null;
            }
            return null;
        }
    };
    return control;
}

test('shared shortcut submits the focused modal form with its enabled submitter', () => {
    let submittedWith = null;
    const submitter = {
        tagName: 'BUTTON',
        type: 'submit',
        disabled: false,
        getAttribute: () => null
    };
    const form = {
        elements: [submitter],
        requestSubmit(button) {
            submittedWith = button;
        }
    };
    const dialog = { querySelector: () => null };
    const control = createControl({ dialog, form });
    const event = createKeyboardEvent(control);

    assert.equal(shortcuts.handleModalCtrlEnter(event), true);
    assert.equal(submittedWith, submitter);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
});

test('shared shortcut activates an explicitly mapped non-form modal action', () => {
    let clickCount = 0;
    const action = {
        disabled: false,
        getAttribute: () => null,
        click() {
            clickCount += 1;
        }
    };
    const dialog = {
        querySelector(selector) {
            assert.equal(selector, '#saveAction');
            return action;
        }
    };
    const explicitOwner = {
        getAttribute(name) {
            assert.equal(name, 'data-ctrl-enter-submit');
            return '#saveAction';
        }
    };
    const control = createControl({ dialog, explicitOwner });
    const event = createKeyboardEvent(control);

    assert.equal(shortcuts.handleModalCtrlEnter(event), true);
    assert.equal(clickCount, 1);
    assert.equal(event.defaultPrevented, true);
});

test('shared shortcut leaves modal filters without a form or explicit action alone', () => {
    const dialog = { querySelector: () => null };
    const control = createControl({ dialog });
    const event = createKeyboardEvent(control);

    assert.equal(shortcuts.handleModalCtrlEnter(event), false);
    assert.equal(event.defaultPrevented, false);
});

test('shared shortcut ignores disabled actions and non-modal controls', () => {
    let clickCount = 0;
    const action = {
        disabled: true,
        getAttribute: () => null,
        click() {
            clickCount += 1;
        }
    };
    const dialog = { querySelector: () => action };
    const explicitOwner = { getAttribute: () => '#disabledAction' };
    const modalControl = createControl({ dialog, explicitOwner });
    const modalEvent = createKeyboardEvent(modalControl);

    assert.equal(shortcuts.handleModalCtrlEnter(modalEvent), false);
    assert.equal(clickCount, 0);
    assert.equal(modalEvent.defaultPrevented, false);

    const outsideControl = createControl({ dialog: null });
    const outsideEvent = createKeyboardEvent(outsideControl);
    assert.equal(shortcuts.handleModalCtrlEnter(outsideEvent), false);
    assert.equal(outsideEvent.defaultPrevented, false);
});

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
