const fs = require('fs');
const path = require('path');
const Utils = require('./Utils.js');

// Bare flags are a schema-definition shorthand, never a generated-response repair.
function expandBareFlags(source) {
    let result = '';
    for (let index = 0; index < source.length;) {
        const terminator = source.startsWith('<!--', index) ? '-->' : source.startsWith('<![CDATA[', index) ? ']]>' : source.startsWith('<?', index) ? '?>' : null;
        if (terminator) {
            const end = source.indexOf(terminator, index + 2);
            if (end < 0) return result + source.slice(index);
            result += source.slice(index, end + terminator.length); index = end + terminator.length; continue;
        }
        if (source[index] !== '<' || /[!?/]/.test(source[index + 1] || '')) { result += source[index++]; continue; }
        let end = index + 1, quote = null;
        for (; end < source.length; end += 1) {
            if (quote) { if (source[end] === quote) quote = null; }
            else if (source[end] === '"' || source[end] === "'") quote = source[end];
            else if (source[end] === '>') break;
        }
        const tag = source.slice(index, end + 1);
        result += tag.replace(/("[^"]*"|'[^']*')|(\s)(optional|multiple)\b(?!\s*=)(?=\s|\/?>)/g,
            (match, quoted, space, flag) => quoted || `${space}${flag}="true"`);
        index = end + 1;
    }
    return result;
}

function compileXmlGenerationSchema(source, { resolveReference = null, extensions = {} } = {}) {
    if (typeof source !== 'string' || !source.trim()) throw new TypeError('XML generation schema requires nonempty source.');
    const document = Utils.parseXmlDocumentStrict(expandBareFlags(source), 'text/xml');
    const compile = element => {
        const attributes = Array.from(element.attributes || []);
        for (const attribute of attributes) {
            if (!['optional', 'multiple', 'ref', 'text', 'markup'].includes(attribute.name) && attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) {
                throw new Error(`Unknown XML schema attribute ${attribute.name} on ${element.tagName}.`);
            }
        }
        const flag = name => {
            const value = element.getAttribute(name);
            if (!element.hasAttribute(name)) return false;
            if (value !== 'true' && value !== 'false') throw new Error(`XML schema ${name} must be true or false.`);
            return value === 'true';
        };
        const children = [];
        for (const child of Array.from(element.childNodes || []).filter(node => node.nodeType === 1)) {
            if (child.tagName === 'extensions' && child.hasAttribute('source')) {
                if (Array.from(child.attributes).some(attribute => attribute.name !== 'source')
                    || Array.from(child.childNodes || []).some(node => node.nodeType === 1 || node.nodeValue?.trim())) {
                    throw new Error('XML schema extension slots must contain only a source attribute.');
                }
                const fragments = extensions[child.getAttribute('source')];
                if (!Array.isArray(fragments)) throw new Error(`Missing XML schema extensions: ${child.getAttribute('source')}.`);
                for (const fragment of fragments) {
                    if (!fragment || !Array.isArray(fragment.children)) throw new TypeError('XML schema extensions require compiled fragment roots.');
                    children.push(...fragment.children);
                }
            } else children.push(compile(child));
        }
        const description = Array.from(element.childNodes || [])
            .filter(node => node.nodeType === 3 || node.nodeType === 4).map(node => node.nodeValue || '').join('').trim();
        let resolved = null;
        if (element.hasAttribute('ref')) {
            if (typeof resolveReference !== 'function' || children.length || description) throw new Error('XML schema references need a resolver and an empty reference element.');
            resolved = resolveReference(element.getAttribute('ref'));
            if (!resolved || resolved.name !== element.tagName) throw new Error(`XML schema reference root must match ${element.tagName}.`);
            children.push(...resolved.children);
        }
        if (flag('markup') && children.length) throw new Error(`XML schema markup payload ${element.tagName} cannot declare child fields.`);
        if (children.length && description && !flag('text')) throw new Error(`XML schema container ${element.tagName} cannot also declare leaf text.`);
        if (new Set(children.map(child => child.name)).size !== children.length) throw new Error(`Duplicate child declaration in XML schema ${element.tagName}.`);
        return Object.freeze({ name: element.tagName, min: flag('optional') ? 0 : 1,
            max: flag('multiple') ? Infinity : 1, allowText: flag('text') || resolved?.allowText || false, markup: flag('markup') || resolved?.markup || false, children: Object.freeze(children),
            description: resolved?.description || description });
    };
    return compile(document.documentElement);
}

function loadXmlGenerationSchema(file, { baseDirectory = path.join(__dirname, 'schemas', 'xml'), extensions = {} } = {}) {
    const root = fs.realpathSync(baseDirectory);
    const active = new Set();
    const load = (reference, parent = root) => {
        if (typeof reference !== 'string' || !reference.trim() || path.isAbsolute(reference)) throw new TypeError('XML schema file must be a relative named file.');
        const target = fs.realpathSync(path.resolve(parent, reference));
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('XML schema reference escapes its schema directory.');
        if (active.has(target)) throw new Error(`Cyclic XML schema file reference: ${reference}.`);
        active.add(target);
        try {
            return compileXmlGenerationSchema(fs.readFileSync(target, 'utf8'), {
                extensions, resolveReference: nested => load(nested, path.dirname(target))
            });
        } finally { active.delete(target); }
    };
    return load(file);
}
module.exports = { compileXmlGenerationSchema, loadXmlGenerationSchema };
