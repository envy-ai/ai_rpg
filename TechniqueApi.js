'use strict';
const Player = require('./Player.js');
const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const TechniqueFormulaVariables = require('./public/js/technique-formula-variables.js');
const TechniqueBalancePolicy = require('./TechniqueBalancePolicy.js');
const Globals = require('./Globals.js');
const IdGenerator = require('./IdGenerator.js');
const TechniqueUtilityEffects = require('./TechniqueUtilityEffects.js');

/** Register the existing authoring surface and advisory views; use stays in /api/chat. */
function registerTechniqueApiRoutes(app, { getCurrentPlayer, getActors, effectiveTechniqueLocation }) {
    if (!app || typeof getCurrentPlayer !== 'function' || typeof getActors !== 'function' || typeof effectiveTechniqueLocation !== 'function') throw new Error('Technique API registration requires actor and location providers.');
    TechniqueUtilityEffects.setActorRegistry(getActors());
    function techniqueApiActor(identity = null) {
        const actor = identity ? (getActors().get(identity) || Player.getById(identity)) : getCurrentPlayer();
        if (!actor) throw new Error(`Technique actor "${identity || 'current player'}" does not exist.`);
        return actor;
    }

    function techniqueApiPayload(actor, { catalog = false } = {}) {
        const currentPlayer = getCurrentPlayer();
        const all = Array.from(getActors().values());
        const targets = all.filter(target => effectiveTechniqueLocation(target) === effectiveTechniqueLocation(actor) && (target.hiddenFromPlayer !== true || target.isInPlayerParty || target.id === currentPlayer?.id)).map(target => ({ id: target.id, name: target.name, isDead: target.isDead }));
        const context = TechniqueService.getPromptContext([actor])[0];
        return {
            actorId: actor.id, actorName: actor.name, isPlayer: actor.id === currentPlayer?.id, canUse: actor.id === currentPlayer?.id,
            disciplineAccess: actor.disciplineAccess, disciplines: TechniqueService.getDisciplines(),
            disciplineEditContext: TechniqueService.getDisciplineEditContext(actor),
            disciplineIcons: Object.fromEntries(TechniqueService.getDisciplines().map(discipline => [discipline.id, TechniqueService.getDisciplineIcon(discipline.id)])),
            techniques: context.techniques, targets, weaponItems: context.weaponItems, utilityContext: context.utilityContext,
            formulaVariables: TechniqueFormulaVariables.catalog(actor),
            balanceAuthoring: TechniqueBalancePolicy.getAuthoringContext({ actor, policy: TechniqueBalancePolicy.resolvePolicy(Globals.config) }),
            formulaFacts: { level: actor.level, skills: Object.fromEntries(actor.getSkills()), attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])) },
            ...(catalog ? { catalog: TechniqueService.toJSON().definitions } : {})
        };
    }

    function techniqueApiError(res, error) {
        return res.status(400).json({ error: error.message, stack: error.stack });
    }

    app.get('/api/techniques', (req, res) => {
        try { res.json(techniqueApiPayload(techniqueApiActor(req.query.actor), { catalog: req.query.catalog === 'true' })); }
        catch (error) { techniqueApiError(res, error); }
    });
    app.put('/api/techniques/access', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const access = Technique.normalizeDisciplineAccess(req.body?.disciplineAccess);
            const known = new Set(TechniqueService.getDisciplines().map(discipline => discipline.id));
            for (const entry of access) if (!known.has(entry.disciplineId)) throw new Error(`Unknown discipline ${entry.disciplineId}. ${TechniqueService.availableDisciplineIds()}`);
            actor.disciplineAccess = access;
            res.json(techniqueApiPayload(actor));
        } catch (error) { techniqueApiError(res, error); }
    });
    app.put('/api/techniques/disciplines', (req, res) => {
        try {
            Technique.assertKeys(req.body, ['actorId', 'edits', 'accessIds', 'accessReason', 'expected'], 'discipline editor request');
            Technique.text(req.body.actorId, 'discipline editor actorId');
            const actor = techniqueApiActor(req.body.actorId);
            const result = TechniqueService.editDisciplines({ ...req.body, actor });
            res.json({ ...techniqueApiPayload(actor), ...result });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/preview', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const mechanics = Technique.normalizeRevision(TechniqueBalancePolicy.materializeRevision(req.body?.mechanics, { actor, origin: 'editor', config: Globals.config }));
            Technique.validateRevisionAmounts(mechanics, actor);
            const authoredMechanics = Technique.clone(mechanics);
            const evaluate = value => Technique.evaluateAmount(value, actor).amount;
            mechanics.costs = mechanics.costs.map(cost => ({ ...cost, amount: evaluate(cost.amount) }));
            if (mechanics.failureCosts) mechanics.failureCosts = mechanics.failureCosts.map(cost => ({ ...cost, amount: evaluate(cost.amount) }));
            mechanics.effects = mechanics.effects.map(effect => {
                if (effect.amount !== undefined) return { ...effect, amount: evaluate(effect.amount) };
                if (effect.kind === 'damage' && effect.damageMode === 'weapon') return { ...effect, bonus: evaluate(effect.bonus), multiplier: evaluate(effect.multiplier) };
                if (effect.kind === 'resurrection') return { ...effect, health: evaluate(effect.health) };
                if (['teleport', 'summon'].includes(effect.kind)) return effect;
                const status = effect.status;
                for (const field of ['attributes', 'skills', 'needBars']) status[field] = status[field].map(entry => {
                    const resolved = { ...entry };
                    for (const magnitude of field === 'needBars' ? ['delta'] : ['modifier', 'percentModifier']) if (entry[magnitude] !== undefined) resolved[magnitude] = Technique.evaluateAmount(entry[magnitude], actor, `status preview.${field}.${magnitude}`, { signed: true }).amount;
                    return resolved;
                });
                if (status.maxHealthPercent !== undefined) status.maxHealthPercent = Technique.evaluateAmount(status.maxHealthPercent, actor, 'status preview.maxHealthPercent', { signed: true }).amount;
                return { ...effect, status };
            });
            res.json({ authoredMechanics, mechanics, costs: mechanics.costs, ...(mechanics.failureCosts ? { failureCosts: mechanics.failureCosts } : {}) });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/:id/use-preview', (req, res) => {
        try {
            Technique.assertKeys(req.body, ['actorId', 'sourceId', 'targetIds', 'weaponItemId', 'utilitySelections'], 'technique use preview request');
            const actor = techniqueApiActor(req.body.actorId);
            res.json(TechniqueService.preview({ actor, techniqueId: req.params.id, sourceId: req.body.sourceId, targetIds: req.body.targetIds, weaponItemId: req.body.weaponItemId, utilitySelections: req.body.utilitySelections }));
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/disciplines', (req, res) => {
        try {
            const discipline = TechniqueService.addDiscipline(req.body);
            res.json({ discipline });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/catalog', (req, res) => {
        try {
            const { actorId, ...value } = req.body || {};
            const actor = techniqueApiActor(actorId);
            if (Object.hasOwn(value, 'unique')) throw new Error('candidate.unique is no longer an authoring field. Remove unique; any actor may learn the same catalogue technique ID.');
            const candidate = new Technique(TechniqueBalancePolicy.materializeDefinition({ ...value, id: value.id || IdGenerator.next('technique', value.name) }, { actor, origin: 'editor', config: Globals.config }));
            candidate.revisions.forEach((revision, index) => Technique.validateRevisionAmounts(revision, actor, `technique.revisions[${index}]`));
            const definitionInput = candidate.toJSON();
            delete definitionInput.unique;
            const definition = TechniqueService.addDefinition(definitionInput, { actor, origin: 'editor' });
            res.json({ definition });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.get('/api/techniques/summon-templates', (req, res) => {
        try { techniqueApiActor(req.query.actorId); res.json({ templates: TechniqueUtilityEffects.toJSON().templates }); }
        catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/summon-templates', (req, res) => {
        try {
            techniqueApiActor(req.body?.actorId);
            const { actorId, ...raw } = req.body ?? {};
            const template = TechniqueUtilityEffects.addTemplate(raw);
            res.json({ template });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.put('/api/techniques/:id/catalog', (req, res) => {
        try {
            Technique.assertKeys(req.body, ['actorId', 'mechanics', 'expectedCatalogRevision', 'convertToCustom'], 'catalogue revision request');
            const actor = techniqueApiActor(req.body.actorId);
            const definition = TechniqueService.getDefinition(req.params.id);
            if (!definition) throw new Error(`Unknown technique ${req.params.id}.`);
            if (definition.revisions.length !== req.body.expectedCatalogRevision) throw new Error('Reviewed catalogue revision is stale. Refresh the catalogue before editing.');
            const mechanics = Technique.normalizeRevision(TechniqueBalancePolicy.materializeRevision(req.body.mechanics, { actor, origin: 'editor', config: Globals.config }));
            Technique.validateRevisionAmounts(mechanics, actor);
            const revised = TechniqueService.reviseDefinition(req.params.id, mechanics, { actor, origin: 'editor', convertToCustom: req.body.convertToCustom === true });
            res.json({ ...techniqueApiPayload(actor, { catalog: true }), definition: revised });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/:id/personal-reset/preview', (req, res) => {
        try {
            Technique.assertKeys(req.body, ['actorId', 'expectedDefinitionRevision', 'expectedPersonalRevision', 'expectedCatalogRevision', 'targetDefinitionRevision'], 'personal reset preview request');
            const actor = techniqueApiActor(req.body.actorId);
            res.json(TechniqueService.previewPersonalReset({ ...req.body, actor, techniqueId: req.params.id }));
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/:id/personal-reset', (req, res) => {
        try {
            Technique.assertKeys(req.body, ['actorId', 'operationId', 'expectedDefinitionRevision', 'expectedPersonalRevision', 'expectedCatalogRevision', 'targetDefinitionRevision', 'provenance'], 'personal reset request');
            const actor = techniqueApiActor(req.body.actorId);
            const receipt = TechniqueService.resetPersonal({ ...req.body, actor, techniqueId: req.params.id, operationId: req.body.operationId || IdGenerator.nextSequential('editor_operation') });
            res.json({ ...techniqueApiPayload(actor, { catalog: true }), receipt });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.put('/api/techniques/:id/personal', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const receipt = TechniqueService.improve({ operationId: req.body?.operationId || IdGenerator.nextSequential('editor_operation'), actor, techniqueId: req.params.id, mechanics: req.body?.mechanics, improvement: req.body?.improvement, origin: 'editor', convertToCustom: req.body?.convertToCustom === true, evidenceIds: req.body?.evidenceIds || [], provenance: req.body?.provenance || { kind: 'editor', reason: 'Personal technique mechanics edited in the character editor.' } });
            res.json({ ...techniqueApiPayload(actor), receipt });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/:id/learn', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const receipt = TechniqueService.learn({ operationId: req.body?.operationId || IdGenerator.nextSequential('learn_operation'), actor, techniqueId: req.params.id, definitionRevision: req.body?.definitionRevision, provenance: req.body?.provenance || { kind: 'editor', reason: 'Learned through the character editor.' } });
            res.json({ ...techniqueApiPayload(actor), receipt });
        } catch (error) { techniqueApiError(res, error); }
    });
}

module.exports = { registerTechniqueApiRoutes };
