import { ModalStack } from '../../packages/ui-widgets/src/index.js';

const mediaRoot = document.getElementById('imageLightbox');
const stack = new ModalStack({ document, canHandleKeys: root => !mediaRoot || mediaRoot.hidden || stack.resolveTop([root, mediaRoot]) === root, resolveTop: roots => roots.reduce((top, root) => {
    if (!top) return root;
    const zIndex = element => {
        const value = getComputedStyle(element).zIndex;
        if (value === 'auto') return 0;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`Invalid modal z-index for ${element.id || element.className}: ${value}`);
        return parsed;
    };
    const difference = zIndex(root) - zIndex(top);
    return difference > 0 || (difference === 0 && (top.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING)) ? root : top;
}, null) });
const sharedBackdrop = document.getElementById('npcModalBackdrop');
const shared = [
    'trackerEditModal', 'npcInventoryModal', 'thingStackCombinerModal', 'thingContainerModal',
    'containerOpenCheckModal', 'barterModal', 'barterStartConfirmModal', 'barterQuantityModal',
    'barterCurrencyConfirmModal', 'npcViewModal', 'npcDispositionModal', 'npcNeedsModal',
    'npcMemoriesModal', 'npcGoalsModal', 'addNpcModal', 'loadGameModal', 'loadModMismatchModal',
    'newExitModal', 'npcEditModal', 'thingEditModal', 'locationEditModal', 'regionEditModal',
    'regionWeatherEditModal', 'calendarEditModal'
];
for (const id of shared) {
    const root = document.getElementById(id);
    if (root) stack.register(root, { backdrop: sharedBackdrop, lockScroll: id !== 'trackerEditModal' });
}
for (const [id, backdropId] of [
    ['actionSuggestionsModal', 'actionSuggestionsBackdrop'], ['questEditModal', 'questEditBackdrop'],
    ['craftingModal', 'craftingModalBackdrop'], ['moduleWorkbenchModal', 'moduleWorkbenchModalBackdrop'],
    ['salvageIntentModal', 'salvageIntentBackdrop']
]) {
    const root = document.getElementById(id);
    if (root) stack.register(root, { backdrop: document.getElementById(backdropId) });
}
for (const id of [
    'playerPromptGuidanceModal', 'prefixHelpModal', 'emptyActionConfirmModal',
    'questDecisionReminderModal', 'mapFastTravelConfirmModal', 'locationRegionFixerModal',
    'slashUploadModal', 'entityImageUploadModal', 'entityImagePromptModal', 'factionCreateModal',
    'playerAbilitySelectionModal', 'imageWorkflowPresetModal', 'addModelModal'
]) {
    const root = document.getElementById(id);
    if (root) stack.register(root);
}
const lastSeen = document.getElementById('setLastSeenModal');
if (lastSeen) stack.register(lastSeen, { lockScroll: false });
for (const id of ['autofillInstructionsModal', 'uploadModal', 'deleteModal']) {
    const root = document.getElementById(id);
    if (root) stack.register(root, { lockScroll: false });
}
window.AIRPG_MODAL_STACK = stack;
