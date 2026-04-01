const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadSlashCommandUploadHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function createSlashCommandHttpError(message, statusCode = 400) {');
    const end = source.indexOf("\n        app.post('/api/slash-command', async (req, res) => {", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate slash command upload helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Error,
        Object,
        Array,
        Number,
        Map,
        console
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.normalizeSlashCommandReplyAction = normalizeSlashCommandReplyAction;
this.normalizeSlashCommandReplyPayload = normalizeSlashCommandReplyPayload;
this.normalizeSlashCommandUploads = normalizeSlashCommandUploads;
this.resolveSlashCommandExecutionOptions = resolveSlashCommandExecutionOptions;`,
        context
    );

    return {
        normalizeSlashCommandReplyAction: context.normalizeSlashCommandReplyAction,
        normalizeSlashCommandReplyPayload: context.normalizeSlashCommandReplyPayload,
        normalizeSlashCommandUploads: context.normalizeSlashCommandUploads,
        resolveSlashCommandExecutionOptions: context.resolveSlashCommandExecutionOptions
    };
}

test('slash command reply payload accepts action-only file upload replies', () => {
    const { normalizeSlashCommandReplyPayload } = loadSlashCommandUploadHelpers();

    const payload = normalizeSlashCommandReplyPayload({
        action: {
            type: 'request_file_upload',
            title: 'Import XML',
            accept: '.xml',
            multiple: true
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        content: '',
        ephemeral: false,
        action: {
            type: 'request_file_upload',
            title: 'Import XML',
            accept: '.xml',
            multiple: true
        }
    });
});

test('slash command reply action rejects unsupported action types', () => {
    const { normalizeSlashCommandReplyAction } = loadSlashCommandUploadHelpers();

    assert.throws(
        () => normalizeSlashCommandReplyAction({ type: 'launch_missiles' }),
        /Unsupported slash command reply action type/
    );
});

test('slash command upload normalization trims names and validates required content', () => {
    const { normalizeSlashCommandUploads } = loadSlashCommandUploadHelpers();

    assert.deepEqual(JSON.parse(JSON.stringify(normalizeSlashCommandUploads([
        {
            filename: '  import.xml  ',
            content: '<item />',
            mimeType: 'text/xml',
            size: 42
        }
    ]))), [
        {
            filename: 'import.xml',
            content: '<item />',
            mimeType: 'text/xml',
            size: 42
        }
    ]);

    assert.throws(
        () => normalizeSlashCommandUploads([{ filename: 'broken.xml' }]),
        /missing string content/
    );
});

test('slash command execution options default to showing the execution overlay', () => {
    const { resolveSlashCommandExecutionOptions } = loadSlashCommandUploadHelpers();

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveSlashCommandExecutionOptions(class DefaultCommand {}))),
        { showExecutionOverlay: true }
    );
});

test('slash command execution options allow commands to disable the execution overlay', () => {
    const { resolveSlashCommandExecutionOptions } = loadSlashCommandUploadHelpers();

    class QuietCommand {
        static get showExecutionOverlay() {
            return false;
        }
    }

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveSlashCommandExecutionOptions(QuietCommand))),
        { showExecutionOverlay: false }
    );

    class BrokenCommand {
        static get showExecutionOverlay() {
            return 'nope';
        }
    }

    assert.throws(
        () => resolveSlashCommandExecutionOptions(BrokenCommand),
        /showExecutionOverlay metadata must be a boolean/
    );
});
