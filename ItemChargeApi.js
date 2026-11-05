'use strict';
const ItemChargeService = require('./ItemChargeService.js');

function registerItemChargeApiRoutes(app, { getCurrentPlayer, assertCanMutate = null } = {}) {
    if (!app || typeof getCurrentPlayer !== 'function') throw new Error('ItemChargeApi requires an app and current player provider.');
    const actor = () => { const value = getCurrentPlayer(); if (!value) throw new Error('A current player is required to reload an item.'); return value; };
    const errorResponse = (res, error) => res.status(error.statusCode || 400).json({ success: false, error: error.message, stack: error.stack });
    app.get('/api/things/:id/reload-options', (req, res) => {
        try { res.json({ success: true, ...ItemChargeService.getReloadOptions({ actor: actor(), itemId: req.params.id }) }); }
        catch (error) { errorResponse(res, error); }
    });
    app.post('/api/things/:id/reload', (req, res) => {
        try {
            if (assertCanMutate) assertCanMutate(req);
            const body = req.body || {};
            for (const key of Object.keys(body)) if (!['ammoItemId', 'amount', 'operationId'].includes(key)) throw new Error(`reload.${key} is unknown; use ammoItemId, optional amount and operationId.`);
            if (typeof body.operationId !== 'string' || !body.operationId.trim()) throw new Error('reload.operationId is required; retain one operation ID while retrying the same reload.');
            const current = actor();
            const receipt = ItemChargeService.reload({ actor: current, itemId: req.params.id, ...body });
            const item = ItemChargeService.assertOwned(current, req.params.id);
            res.json({ success: true, receipt, item: item.toJSON(), inventory: current.getInventoryItems().map(value => value.toJSON()) });
        } catch (error) { errorResponse(res, error); }
    });
}
module.exports = registerItemChargeApiRoutes;
module.exports.registerItemChargeApiRoutes = registerItemChargeApiRoutes;
