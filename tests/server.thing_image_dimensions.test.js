const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadResolveThingImageDimensions(config) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveThingImageDimensions(thing) {');
    const end = source.indexOf('\n\n// Process a single image generation job', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate resolveThingImageDimensions in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Number,
        config
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveThingImageDimensions = resolveThingImageDimensions;`,
        context
    );

    return context.resolveThingImageDimensions;
}

test('item and scenery images fall back to default image dimensions when per-type overrides are unset', () => {
    const resolveThingImageDimensions = loadResolveThingImageDimensions({
        imagegen: {
            default_settings: {
                image: {
                    width: 640,
                    height: 960
                }
            },
            item_settings: {
                image: {
                    width: null,
                    height: null
                }
            },
            scenery_settings: {
                image: {
                    width: null,
                    height: null
                }
            }
        }
    });

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveThingImageDimensions({ thingType: 'item' }))),
        { width: 640, height: 960 }
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveThingImageDimensions({ thingType: 'scenery' }))),
        { width: 640, height: 960 }
    );
});

test('per-type scenery overrides win over default image dimensions', () => {
    const resolveThingImageDimensions = loadResolveThingImageDimensions({
        imagegen: {
            default_settings: {
                image: {
                    width: 640,
                    height: 960
                }
            },
            scenery_settings: {
                image: {
                    width: 1440,
                    height: 810
                }
            }
        }
    });

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveThingImageDimensions({ thingType: 'scenery' }))),
        { width: 1440, height: 810 }
    );
});

test('resolveThingImageDimensions throws when no configured size is available', () => {
    const resolveThingImageDimensions = loadResolveThingImageDimensions({
        imagegen: {
            default_settings: {
                image: {}
            },
            item_settings: {
                image: {}
            }
        }
    });

    assert.throws(
        () => resolveThingImageDimensions({ thingType: 'item' }),
        /missing configured width for item images/
    );
});
