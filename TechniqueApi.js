'use strict';
const { randomUUID } = require('crypto');
const Player = require('./Player.js');
const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const TechniqueFormulaVariables = require('./public/js/technique-formula-variables.js');
const TechniqueBalancePolicy = require('./TechniqueBalancePolicy.js');
const Globals = require('./Globals.js');
const IdGenerator = require('./IdGenerator.js');

/** Register the existing authoring surface and advisory views; use stays in /api/chat. */
function registerTechniqueApiRoutes(app, { getCurrentPlayer, getActors, effectiveTechniqueLocation }) {
    if (!app || typeof getCurrentPlayer !== 'function' || typeof getActors !== 'function' || typeof effectiveTechniqueLocation !== 'function') throw new Error('Technique API registration requires actor and location providers.');
    function techniqueApiActor(identity = null) {
        const actor = identity ? (getActors().get(identity) || Player.getById(identity)) : getCurrentPlayer();
        if (!actor) throw new Error(`Technique actor "${identity || 'current player'}" does not exist.`);
        return actor;
    }

    function techniqueApiPayload(actor, { catalog = false } = {}) {
        const currentPlayer = getCurrentPlayer();
        const all = Array.from(getActors().values());
        const targets = all.filter(target => effectiveTechniqueLocation(target) === effectiveTechniqueLocation(actor) && !target.isDead && (target.hiddenFromPlayer !== true || target.isInPlayerParty || target.id === currentPlayer?.id)).map(target => ({ id: target.id, name: target.name }));
        return {
            actorId: actor.id, actorName: actor.name, isPlayer: actor.id === currentPlayer?.id, canUse: actor.id === currentPlayer?.id,
            disciplineAccess: actor.disciplineAccess, disciplines: TechniqueService.getDisciplines(),
            disciplineEditContext: TechniqueService.getDisciplineEditContext(actor),
            disciplineIcons: Object.fromEntries(TechniqueService.getDisciplines().map(discipline => [discipline.id, TechniqueService.getDisciplineIcon(discipline.id)])),
            techniques: TechniqueService.getAvailable(actor, { includeBlocked: true }), targets,
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
            for (const entry of access) if (!known.has(entry.disciplineId)) throw new Error(`Unknown discipline ${entry.disciplineId}.`);
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
                const status = effect.status;
                for (const [field, amount] of [['attributes', 'modifier'], ['skills', 'modifier'], ['needBars', 'delta']]) status[field] = status[field].map(entry => ({ ...entry, [amount]: Technique.evaluateAmount(entry[amount], actor, 'status preview', { signed: true }).amount }));
                return { ...effect, status };
            });
            res.json({ authoredMechanics, mechanics, costs: mechanics.costs, ...(mechanics.failureCosts ? { failureCosts: mechanics.failureCosts } : {}) });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/disciplines', (req, res) => {
        try {
            const discipline = TechniqueService.addDiscipline({ ...req.body, id: req.body?.id || IdGenerator.next('discipline') });
            res.json({ discipline });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/catalog', (req, res) => {
        try {
            const { actorId, ...value } = req.body || {};
            const actor = techniqueApiActor(actorId);
            const candidate = new Technique(TechniqueBalancePolicy.materializeDefinition({ ...value, id: value.id || IdGenerator.next('technique') }, { actor, origin: 'editor', config: Globals.config }));
            candidate.revisions.forEach((revision, index) => Technique.validateRevisionAmounts(revision, actor, `technique.revisions[${index}]`));
            const definition = TechniqueService.addDefinition(candidate.toJSON(), { actor, origin: 'editor' });
            res.json({ definition });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.put('/api/techniques/:id/personal', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const receipt = TechniqueService.improve({ operationId: req.body?.operationId || `editor:${randomUUID()}`, actor, techniqueId: req.params.id, mechanics: req.body?.mechanics, improvement: req.body?.improvement, origin: 'editor', convertToCustom: req.body?.convertToCustom === true, evidenceIds: req.body?.evidenceIds || [], provenance: req.body?.provenance || { kind: 'editor', reason: 'Personal technique mechanics edited in the character editor.' } });
            res.json({ ...techniqueApiPayload(actor), receipt });
        } catch (error) { techniqueApiError(res, error); }
    });
    app.post('/api/techniques/:id/learn', (req, res) => {
        try {
            const actor = techniqueApiActor(req.body?.actorId);
            const receipt = TechniqueService.learn({ operationId: req.body?.operationId || `learn:${randomUUID()}`, actor, techniqueId: req.params.id, definitionRevision: req.body?.definitionRevision, provenance: req.body?.provenance || { kind: 'editor', reason: 'Learned through the character editor.' } });
            res.json({ ...techniqueApiPayload(actor), receipt });
        } catch (error) { techniqueApiError(res, error); }
    });
}

module.exports = { registerTechniqueApiRoutes };
