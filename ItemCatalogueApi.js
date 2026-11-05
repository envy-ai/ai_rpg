'use strict';

const Globals = require('./Globals.js');
const ItemCatalogue = require('./ItemCatalogue.js');
const Thing = require('./Thing.js');

/** Read the saved world catalogue without discovering or materializing any items. */
function registerItemCatalogueApiRoutes(app) {
    app.get('/api/item-catalogue', (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (Globals.gameLoaded !== true) {
            return res.status(409).json({
                success: false,
                code: 'GAME_NOT_LOADED',
                error: 'Load or start a game to browse its item catalogue.'
            });
        }
        try {
            return res.json({
                success: true,
                generation: ItemCatalogue.generation,
                definitions: ItemCatalogue.getAll(),
                families: ItemCatalogue.getFamilies(),
                rarityDefinitions: Thing.getAllRarityDefinitions()
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message, stack: error.stack });
        }
    });
}

module.exports = { registerItemCatalogueApiRoutes };
