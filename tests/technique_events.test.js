'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../Utils.js');
const Events = require('../Events.js');
const TechniqueEvents = require('../TechniqueEvents.js');
const TechniqueService = require('../TechniqueService.js');
const { writeTechniqueXmlValue, techniqueChangeSchema } = require('../TechniqueXml.js');
const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
const { withTechniqueWorld, mechanics, definition, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');

async function applyChangeThroughEventXml(command, context) {
    const value = { ...command };
    if (value.evidence) { delete value.evidence.id; delete value.evidence.worldMinute; }
    if (value.candidate) {
        const candidate = { ...value.candidate };
        delete candidate.id; delete candidate.provenance; delete candidate.disciplineId;
        const discipline = value.candidateDiscipline ? { ...value.candidateDiscipline } : { disciplineId: value.candidate.disciplineId };
        delete discipline.id; delete discipline.provenance;
        value.discipline = { ...discipline, techniques: [{ candidate }] };
        delete value.candidate; delete value.candidateDiscipline; delete value.techniqueId;
    }
    const outputDocument = new DOMImplementation().createDocument(null, 'techniqueChange', null);
    writeTechniqueXmlValue(outputDocument.documentElement, value, techniqueChangeSchema);
    const xml = `<events>${new XMLSerializer().serializeToString(outputDocument.documentElement)}</events>`;
    const parsed = Events.parseTinyBrainEventXmlChunk(xml);
    const document = Utils.parseXmlDocumentStrict(`<events>${parsed.value.xml}</events>`, 'text/xml');
    const raw = Events._mapXmlEventNodeToLegacyRaw(document.documentElement.firstChild);
    const entries = Events._buildParsers()[raw.key](raw.raw);
    await Events._buildHandlers()[raw.key](entries, context);
}

test('TinyBrain event parsing suppresses only the exact committed healing mutation and rejects forged links', async () => {
    await withTechniqueWorld(async ({ player }) => {
        addDefinition('technique-event-mend', mechanics({ effects: [{ id: 'mend', kind: 'healing', amount: 2 }] }));
        learn(player, 'technique-event-mend');
        player.setHealth(player.health - 8);
        const beforeTechnique = player.health;
        const receipt = await TechniqueService.execute({
            operationId: 'event-technique-receipt', turnId: 'event-turn', actor: player,
            techniqueId: 'technique-event-mend'
        });
        assert.equal(player.health, beforeTechnique + 2);
        const exact = receipt.effects[0].mutationId;
        const xml = `<events>
            <healRecover><characterName>${player.name}</characterName><magnitude>2</magnitude><reason>Technique mend</reason><techniqueReceipt><operationId>${receipt.operationId}</operationId><mutationId>${exact}</mutationId></techniqueReceipt></healRecover>
            <healRecover><characterName>${player.name}</characterName><magnitude>1</magnitude><reason>Independent potion</reason></healRecover>
        </events>`;
        const parsed = Events.parseTinyBrainEventXmlChunk(xml);
        assert.equal((parsed.value.xml.match(/<healRecover>/g) || []).length, 1);
        assert.match(parsed.value.xml, /Independent potion/);
        assert.doesNotMatch(parsed.value.xml, /Technique mend/);

        const forged = xml.replace(exact, `${receipt.operationId}:effect:${player.id}:forged`);
        assert.throws(() => Events.parseTinyBrainEventXmlChunk(forged), /does not belong to receipt/);
        const wrongTarget = xml.replace(`<characterName>${player.name}</characterName><magnitude>2</magnitude><reason>Technique mend</reason>`, `<characterName>Someone Else</characterName><magnitude>2</magnitude><reason>Technique mend</reason>`);
        assert.throws(() => Events.parseTinyBrainEventXmlChunk(wrongTarget), /target differs/);
        assert.equal(TechniqueEvents.suppressReferencedMutation(
            Utils.parseXmlDocumentStrict(`<healRecover><characterName>${player.name}</characterName><magnitude>2</magnitude><reason>Removal</reason><techniqueReceipt><operationId>${receipt.operationId}</operationId><mutationId>${exact}</mutationId></techniqueReceipt></healRecover>`, 'text/xml').documentElement,
            'healRecover'
        ), true);
    });
});

test('event XML applies candidate learning, a real trainer grant, evidence, and an evidence-backed personal revision idempotently', async () => {
    await withTechniqueWorld(async ({ player, npc, target }) => {
        const context = {};
        const unmanagedHeal = definition('technique-event-unmanaged-heal', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        const rejectedCommand = { kind: 'learn', actorId: player.id, techniqueId: unmanagedHeal.id, candidate: unmanagedHeal, provenance: { kind: 'discovery', reason: 'Unmanaged healing must not bypass the policy.' } };
        await assert.rejects(applyChangeThroughEventXml(rejectedCommand, context), /requires recipe/);
        assert.equal(TechniqueService.getDefinition(unmanagedHeal.id), null);
        assert.equal(player.techniques.length, 0);
        assert.equal(TechniqueService.toJSON().receipts.length, 0);

        const guardMechanics = mechanics({ effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'A defensive stance.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 1 }], skills: [], needBars: [] } }] });
        const candidate = definition('technique-event-candidate', guardMechanics);
        const candidateCommand = {
            kind: 'learn', actorId: player.id, techniqueId: candidate.id, candidate,
            provenance: { kind: 'discovery', reason: 'Qualified event discovery.' }
        };
        await applyChangeThroughEventXml(candidateCommand, context);
        const learnedCandidateId = player.techniques.find(entry => TechniqueService.getDefinition(entry.techniqueId)?.name === candidate.name)?.techniqueId;
        assert.ok(learnedCandidateId, 'the authored group receives an engine-assigned catalogue ID');
        assert.equal(TechniqueService.getDefinition(learnedCandidateId).id, learnedCandidateId);
        const candidateReceiptCount = TechniqueService.toJSON().receipts.length;
        await applyChangeThroughEventXml(candidateCommand, context);
        assert.equal(TechniqueService.toJSON().receipts.length, candidateReceiptCount, 'replayed event retains the existing acquisition receipt');

        const authored = guardMechanics;
        addDefinition('technique-event-taught', authored);
        learn(npc, 'technique-event-taught');
        const trainerCommand = {
            kind: 'learn', actorId: target.id, techniqueId: 'technique-event-taught', definitionRevision: 1,
            provenance: { kind: 'trainer', sourceId: npc.id, reason: 'Trainer taught the technique.' }
        };
        await applyChangeThroughEventXml(trainerCommand, context);
        assert.equal(target.techniques[0].techniqueId, 'technique-event-taught');
        await assert.rejects(applyChangeThroughEventXml({
            ...trainerCommand, actorId: player.id,
            provenance: { ...trainerCommand.provenance, sourceId: 'missing-trainer' }
        }, context), /Trainer must be a living available character/);

        const evidenceCommand = {
            kind: 'evidence', actorId: target.id, techniqueId: 'technique-event-taught',
            evidence: { id: 'event-training-evidence', kind: 'training', description: 'Completed a focused lesson.' }
        };
        await applyChangeThroughEventXml(evidenceCommand, context);
        const evidenceId = target.techniques[0].evidence[0].id;
        await applyChangeThroughEventXml(evidenceCommand, context);
        assert.equal(target.techniques[0].evidence.length, 1);
        assert.ok(evidenceId);
        assert.equal(target.techniques[0].evidence[0].id, evidenceId);

        const improvedMechanics = { ...authored, revision: 2, effects: [{ ...authored.effects[0], status: { ...authored.effects[0].status, attributes: [{ attribute: 'Strength', modifier: 5 }] } }] };
        const improveCommand = {
            kind: 'improve', actorId: target.id, techniqueId: 'technique-event-taught',
            mechanics: improvedMechanics, evidenceIds: [evidenceId],
            provenance: { kind: 'training', reason: 'The instructor reviewed a successful lesson.' }
        };
        await applyChangeThroughEventXml(improveCommand, context);
        assert.equal(target.techniques[0].personalRevision, 2);
        assert.equal(target.techniques[0].mechanics.effects[0].status.attributes[0].modifier, 5);
        assert.equal(target.techniques[0].evidence[0].usedBy, TechniqueService.toJSON().receipts.find(receipt => receipt.kind === 'improve').operationId);
        const afterImproveCount = TechniqueService.toJSON().receipts.length;
        await applyChangeThroughEventXml(improveCommand, context);
        assert.equal(TechniqueService.toJSON().receipts.length, afterImproveCount);
        assert.equal(target.techniques[0].personalRevision, 2, 'replay does not append a second personal revision');
        assert.ok(context.techniqueChanges.length >= 4);
    });
});
