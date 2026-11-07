#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function setNestedValue(obj, segments, value) {
    let cursor = obj;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i];
        if (cursor[segment] == null || typeof cursor[segment] !== 'object') {
            cursor[segment] = {};
        }
        cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    cursor[leaf] = value;
}

function isValidUrl(value) {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function main() {
    const [targetPath] = process.argv.slice(2);
    if (!targetPath) {
        console.error('Usage: node docker-config-env.js <target-config-path>');
        process.exit(1);
    }

    if (!fs.existsSync(targetPath)) {
        console.error(`Config file ${targetPath} does not exist, skip overrides.`);
        process.exit(0);
    }

    const fileContent = fs.readFileSync(targetPath, 'utf8');
    const config = yaml.load(fileContent) || {};
    const mappings = [
        { env: 'SERVER_HOST', segments: ['server', 'host'] },
        { env: 'SERVER_PORT', segments: ['server', 'port'] },
        { env: 'AI_ENDPOINT', segments: ['ai', 'endpoint'], isEndpoint: true },
        { env: 'AI_API_KEY', segments: ['ai', 'apiKey'], isSecret: true },
        { env: 'AI_MODEL', segments: ['ai', 'model'] },
        { env: 'IMAGEGEN_API_KEY', segments: ['imagegen', 'apiKey'], isSecret: true },
        { env: 'IMAGEGEN_ENDPOINT', segments: ['imagegen', 'endpoint'], isEndpoint: true },
        { env: 'IMAGEGEN_MODEL', segments: ['imagegen', 'model'] },
    ];

    let updated = false;
    for (const mapping of mappings) {
        if (!Object.prototype.hasOwnProperty.call(process.env, mapping.env)) {
            continue;
        }
        const value = process.env[mapping.env];
        if (value === undefined || value === '') {
            continue;
        }

        if (mapping.isEndpoint && !isValidUrl(value)) {
            console.warn(`Warning: Invalid URL for ${mapping.env}: "${value}" - skipping`);
            continue;
        }

        setNestedValue(config, mapping.segments, value);
        updated = true;

        if (mapping.isSecret) {
            console.warn(`Warning: ${mapping.env} was set. Consider using a secrets manager instead of environment variables.`);
        }
    }

    if (updated) {
        const yamlContent = yaml.dump(config, { lineWidth: -1 });
        fs.writeFileSync(targetPath, yamlContent + '\n', 'utf8');
    }
}

main();
