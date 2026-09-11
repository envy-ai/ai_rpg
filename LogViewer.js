const fs = require('node:fs');
const path = require('node:path');

class LogViewer {
    constructor(rootDirectory) {
        this.rootDirectory = path.resolve(rootDirectory);
    }

    static error(message, status = 400) {
        return Object.assign(new Error(message), { status });
    }

    async directory(session) {
        if (session !== 'logs' && session !== 'logs_prev') {
            throw LogViewer.error('Session must be logs or logs_prev.');
        }
        const directory = path.join(this.rootDirectory, session);
        const info = await fs.promises.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) {
            throw LogViewer.error('Log session must be a real directory.', 403);
        }
        return directory;
    }

    metadata(name, stat) {
        if (!Number.isFinite(stat.birthtimeMs) || stat.birthtimeMs <= 0) {
            throw LogViewer.error(`Creation date unavailable for log file: ${name}`, 500);
        }
        return { name, createdAt: stat.birthtime.toISOString(), size: stat.size };
    }

    async list(session) {
        const directory = await this.directory(session);
        const entries = await fs.promises.readdir(directory, { withFileTypes: true });
        const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
            const stat = await fs.promises.lstat(path.join(directory, entry.name));
            if (!stat.isFile()) {
                throw LogViewer.error(`Log file changed while listing: ${entry.name}`, 409);
            }
            return this.metadata(entry.name, stat);
        }));
        return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
    }

    async read(session, name) {
        if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
            throw LogViewer.error('A single log filename is required.');
        }
        const directory = await this.directory(session);
        const filename = path.join(directory, name);
        const stat = await fs.promises.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw LogViewer.error('Only regular log files can be viewed.', 403);
        }
        // Do not follow a symlink substituted between lstat and open.
        const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
            const openedStat = await handle.stat();
            if (!openedStat.isFile()) {
                throw LogViewer.error('Only regular log files can be viewed.', 403);
            }
            return { ...this.metadata(name, openedStat), content: await handle.readFile('utf8') };
        } finally {
            await handle.close();
        }
    }

    registerRoutes(app) {
        app.get('/log-viewer', (_req, res) => {
            res.render('log-viewer.njk', { title: 'Log Viewer', currentPage: 'log-viewer' });
        });
        const respond = handler => async (req, res) => {
            res.set('Cache-Control', 'no-store');
            try {
                res.json({ success: true, ...await handler(req) });
            } catch (error) {
                const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
                res.status(status).json({ success: false, error: error.message, stack: error.stack });
            }
        };
        app.get('/api/log-viewer/files', respond(async req => ({ files: await this.list(req.query.session) })));
        app.get('/api/log-viewer/file', respond(async req => ({ file: await this.read(req.query.session, req.query.name) })));
    }
}

module.exports = LogViewer;
