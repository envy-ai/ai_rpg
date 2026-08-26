const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    resolveConfigSaveTarget,
    formatConfigSaveTarget
} = require('../ConfigSaveTarget.js');

test('configuration saves default to config.yaml', () => {
    assert.equal(
        resolveConfigSaveTarget('/game'),
        path.join('/game', 'config.yaml')
    );
});

test('a startup CLI override becomes the configuration save target', () => {
    assert.equal(
        resolveConfigSaveTarget('/game', {
            cliConfigOverridePath: '/game/config.yaml.qwen-combo-router'
        }),
        '/game/config.yaml.qwen-combo-router'
    );
});

test('a later session override takes precedence over the startup override', () => {
    assert.equal(
        resolveConfigSaveTarget('/game', {
            cliConfigOverridePath: '/game/config.yaml.qwen-combo-router',
            sessionConfigOverridePath: '/game/tmp/session.yaml'
        }),
        '/game/tmp/session.yaml'
    );
});

test('save targets inside the project are displayed relatively', () => {
    assert.equal(
        formatConfigSaveTarget('/game', '/game/tmp/session.yaml'),
        path.join('tmp', 'session.yaml')
    );
    assert.equal(
        formatConfigSaveTarget('/game', '/external/session.yaml'),
        '/external/session.yaml'
    );
});
