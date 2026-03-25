const test = require('node:test');
const assert = require('node:assert/strict');

const Region = require('../Region.js');

test('Region.removeFromIndex removes id and name lookups for rolled-back regions', () => {
    Region.clear();

    try {
        const region = new Region({
            id: 'test-region-id',
            name: 'Rollback Region',
            description: 'A temporary region used for index cleanup tests.'
        });

        assert.equal(Region.get('test-region-id'), region);
        assert.equal(Region.getByName('Rollback Region'), region);

        Region.removeFromIndex(region);

        assert.equal(Region.get('test-region-id'), null);
        assert.equal(Region.getByName('Rollback Region'), null);
    } finally {
        Region.clear();
    }
});
