import { ModalStack } from '../../packages/ui-widgets/src/index.js';

const stack = new ModalStack({ document });
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
    'playerAbilitySelectionModal', 'autofillInstructionsModal', 'imageWorkflowPresetModal',
    'addModelModal', 'uploadModal', 'deleteModal'
]) {
    const root = document.getElementById(id);
    if (root) stack.register(root);
}
const lastSeen = document.getElementById('setLastSeenModal');
if (lastSeen) stack.register(lastSeen, { lockScroll: false });
window.AIRPG_MODAL_STACK = stack;
