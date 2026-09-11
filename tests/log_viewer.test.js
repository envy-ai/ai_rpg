const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const LogViewer = require('../LogViewer');

async function fixture() {
    const root = await fs.mkdtemp(path.join(__dirname, '../tmp/log-viewer-test-'));
    await fs.mkdir(path.join(root, 'logs'));
    await fs.mkdir(path.join(root, 'logs_prev'));
    await fs.writeFile(path.join(root, 'outside.txt'), 'not a log');
    return { root, viewer: new LogViewer(root) };
}

test('lists regular files newest-created first, not by modification time', async () => {
    const { root, viewer } = await fixture();
    await fs.writeFile(path.join(root, 'logs/a.log'), 'old');
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.writeFile(path.join(root, 'logs/b.log'), 'new');
    await fs.utimes(path.join(root, 'logs/a.log'), new Date(), new Date('2030-01-01'));
    await fs.mkdir(path.join(root, 'logs/subdirectory'));
    await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'logs/link.log'));
    const files = await viewer.list('logs');
    assert.deepEqual(files.map(file => file.name), ['b.log', 'a.log']);
    assert.ok(files.every(file => file.createdAt && file.size === 3));
    assert.deepEqual(await viewer.list('logs_prev'), []);
});

test('reads complete literal text and isolates current/previous sessions', async () => {
    const { root, viewer } = await fixture();
    const text = '<script>alert("not HTML")</script>\nline 2\n';
    await fs.writeFile(path.join(root, 'logs/action & details.log'), text);
    await fs.writeFile(path.join(root, 'logs_prev/action & details.log'), 'previous');
    assert.equal((await viewer.read('logs', 'action & details.log')).content, text);
    assert.equal((await viewer.read('logs_prev', 'action & details.log')).content, 'previous');
    await assert.rejects(viewer.read('logs', 'missing.log'), { code: 'ENOENT' });
});

test('rejects path traversal, invalid sessions, directories and symlinks', async () => {
    const { root, viewer } = await fixture();
    for (const session of [undefined, '../logs', '/tmp', ['logs'], '__proto__']) {
        await assert.rejects(viewer.list(session), { status: 400 });
    }
    for (const name of ['', '.', '..', '../outside.txt', '/etc/passwd', '..\\outside.txt', 'bad\0.log', ['a.log']]) {
        await assert.rejects(viewer.read('logs', name), { status: 400 });
    }
    await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'logs/link.log'));
    await fs.mkdir(path.join(root, 'logs/folder'));
    await assert.rejects(viewer.read('logs', 'link.log'), { status: 403 });
    await assert.rejects(viewer.read('logs', 'folder'), { status: 403 });
    const other = await fs.mkdtemp(path.join(__dirname, '../tmp/log-viewer-symlink-test-'));
    await fs.symlink(path.join(root, 'logs'), path.join(other, 'logs'));
    await assert.rejects(new LogViewer(other).list('logs'), { status: 403 });
});

test('missing creation metadata is an explicit error', () => {
    assert.throws(() => new LogViewer(__dirname).metadata('bad.log', { birthtimeMs: 0 }), /Creation date unavailable/);
});

test('routes return uncached data and actionable error backtraces', async () => {
    const { viewer } = await fixture();
    const routes = new Map();
    viewer.registerRoutes({ get: (route, handler) => routes.set(route, handler) });
    async function invoke(route, query) {
        const response = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
        await routes.get(route)({ query }, response);
        return response;
    }
    const ok = await invoke('/api/log-viewer/files', { session: 'logs' });
    assert.deepEqual(ok.body, { success: true, files: [] });
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    const invalid = await invoke('/api/log-viewer/files', { session: '../' });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.stack, /Error: Session must be/);
    const missing = await invoke('/api/log-viewer/file', { session: 'logs', name: 'missing.log' });
    assert.equal(missing.statusCode, 404);
});
