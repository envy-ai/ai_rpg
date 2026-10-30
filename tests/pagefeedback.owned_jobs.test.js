'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'public', 'js', 'page-feedback.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function loadControllerWithoutMountingDocument() {
    const window = {};
    const document = { addEventListener() {} };
    vm.runInNewContext(scriptSource, { window, document }, { filename: scriptPath });
    return window.AIRPG_PAGE_FEEDBACK;
}

function promptIds(controller) {
    return [...controller.ownedPromptIds()].sort();
}

test('a replacement Stories snapshot drops the prior story and terminal work without clearing other consumers', () => {
    const controller = loadControllerWithoutMountingDocument();
    const storyScope = 'story-authoring.editor';

    controller.setJobs(storyScope, [
        { id: 'old-story-generation', status: 'running', promptIds: ['old-story-prompt'] },
        { id: 'old-story-yolo', status: 'running', promptIds: ['old-yolo-prompt'] }
    ]);
    controller.setJobs('play-runtime', [
        { id: 'runtime-event', status: 'running', promptIds: ['runtime-prompt'] }
    ]);
    assert.deepEqual(promptIds(controller), ['old-story-prompt', 'old-yolo-prompt', 'runtime-prompt']);

    controller.setJobs(storyScope, [
        { id: 'new-story-generation', status: 'running', promptIds: ['new-story-prompt'] },
        { id: 'new-story-yolo', status: 'running', promptIds: ['new-yolo-prompt'] }
    ]);
    assert.deepEqual(promptIds(controller), ['new-story-prompt', 'new-yolo-prompt', 'runtime-prompt']);
    assert.equal(controller.jobs.has('old-story-generation'), false);
    assert.equal(controller.jobs.has('old-story-yolo'), false);

    controller.setJobs(storyScope, [
        { id: 'new-story-generation', status: 'completed', promptIds: ['new-story-prompt'] },
        { id: 'new-story-yolo', status: 'paused', promptIds: ['new-yolo-prompt'] }
    ]);
    assert.equal(controller.jobScopes.has(storyScope), false);
    assert.deepEqual(promptIds(controller), ['runtime-prompt']);
    assert.deepEqual([...controller.jobs.keys()], ['runtime-event']);
});

test('trackJob keeps default and named owners coherent when the same job belongs to two consumers', () => {
    const controller = loadControllerWithoutMountingDocument();

    controller.trackJob({ id: 'legacy-job', status: 'running', promptIds: ['default-prompt'] });
    controller.trackJob({ id: 'shared-job', ownerScope: 'story-authoring.editor', status: 'running', promptIds: ['story-prompt'] });
    controller.trackJob({ id: 'shared-job', status: 'running', promptIds: ['runtime-prompt'] }, 'play-runtime');

    assert.deepEqual(promptIds(controller), ['default-prompt', 'runtime-prompt', 'story-prompt']);
    assert.equal(controller.jobScopes.get('default').has('legacy-job'), true);
    assert.equal(controller.jobScopes.get('story-authoring.editor').has('shared-job'), true);
    assert.equal(controller.jobScopes.get('play-runtime').has('shared-job'), true);

    controller.trackJob({ id: 'shared-job', status: 'completed', promptIds: ['story-prompt'] }, 'story-authoring.editor');
    assert.deepEqual(promptIds(controller), ['default-prompt', 'runtime-prompt']);
    assert.equal(controller.jobs.get('shared-job').ownerScope, 'play-runtime');

    controller.trackJob({ id: 'legacy-job', status: 'completed', promptIds: ['default-prompt'] });
    controller.trackJob({ id: 'shared-job', status: 'paused', promptIds: ['runtime-prompt'] }, 'play-runtime');
    assert.deepEqual(promptIds(controller), []);
    assert.equal(controller.jobs.size, 0);
    assert.equal(controller.jobScopes.size, 0);
});
