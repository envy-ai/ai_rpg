const { QName, S_OPT } = require('@xmldom/xmldom/lib/grammar');

const NAME = QName.source;
const SPACE = S_OPT.source;
const OPEN_NAME = new RegExp(`^(${NAME})(?=[\\x20\\t\\r\\n/>])`, 'u');
const CLOSE = new RegExp(`^<\\/(${NAME})${SPACE}>$`, 'u');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CDATA_FRAME = '![CDATA[';

class XmlClosingTagGuard {
    constructor({ mode = true, schema = null, expectedRootTags = null, stopAtDocumentEnd = false, allowToolCalls = true, checkStructure = true } = {}) {
        if (mode !== true && mode !== 'auto') throw new TypeError('XML closing guard mode must be true or auto.');
        if (schema && (!schema.name || !Array.isArray(schema.children))) throw new TypeError('XML guard schema must be compiled.');
        if (typeof allowToolCalls !== 'boolean') throw new TypeError('XML guard allowToolCalls must be a boolean.');
        if (typeof checkStructure !== 'boolean') throw new TypeError('XML guard checkStructure must be a boolean.');
        const roots = expectedRootTags === null ? [] : expectedRootTags;
        if (!Array.isArray(roots) || roots.some(name => typeof name !== 'string' || !new RegExp(`^${NAME}$`, 'u').test(name))) {
            throw new TypeError('XML guard expectedRootTags must be an array of XML tag names.');
        }
        this.expectedRootTags = schema ? [schema.name] : [...new Set(roots)];
        this.mode = this.expectedRootTags.length ? true : mode;
        this.schema = schema;
        this.stopAtDocumentEnd = stopAtDocumentEnd;
        this.allowToolCalls = allowToolCalls;
        this.checkStructure = checkStructure;
        this.beginGeneration();
    }
    beginGeneration() {
        this.text = '';
        this.offset = 0;
        this.stack = [];
        this.frames = [];
        this.documentFrame = this.schema ? { node: { name: null, children: [this.schema] }, counts: new Map() } : null;
        this.cdataFrame = null;
        this.active = this.mode === true;
        this.plain = false;
        this.detection = null;
        this.invalidMarkup = false;
        this.completedAt = null;
        this.rootOpened = false;
        this.rootName = null;
        this.rootDepth = 0;
    }
    currentFrame() { return this.frames.at(-1) || this.documentFrame; }
    missing(frame = this.currentFrame()) {
        return frame?.node?.children.filter(child => (frame.counts.get(child.name) || 0) < child.min) || [];
    }
    push(frame) { this.frames.push(frame); this.stack.push(frame.name); }
    pop() { this.stack.pop(); return this.frames.pop(); }
    violation(start, end, actualName, message, kind = 'xml-closing-tag', rewindStart = start) {
        this.detection = { start, end, actualName, expectedName: this.stack.at(-1) || null,
            message, kind, rewindStart, pattern: kind === 'xml-closing-tag' ? 'current-open-element' : kind };
        return this.detection;
    }
    terminalState(text) {
        this.inspect(text);
        if ((this.stopAtDocumentEnd || this.expectedRootTags.length) && this.completedAt !== null) return { active: true, openElements: [], pendingMarkup: false, pendingMarkupStart: null, missingRequired: [], missingRoot: false, incomplete: false };
        const leading = text.replace(/^\s*```(?:xml)?[\t ]*(?:\r?\n)?/i, '').trimStart();
        const pendingAuto = !this.active && !this.plain && leading.startsWith('<');
        const pendingMarkup = this.active ? this.offset < text.length && (text[this.offset] === '<'
            || Boolean(this.cdataFrame && /^\]{1,2}$/.test(text.slice(this.offset)))) : pendingAuto;
        const missingRequired = this.missing().map(child => child.name);
        const missingRoot = this.expectedRootTags.length > 0 && !this.rootOpened;
        return { active: this.active || pendingAuto, openElements: [...this.stack], pendingMarkup,
            pendingMarkupStart: pendingMarkup ? this.offset : null, missingRequired, missingRoot,
            incomplete: !this.plain && (missingRoot || this.stack.length > 0 || pendingMarkup || missingRequired.length > 0) };
    }
    nextForcedPrefix(text, rewindOffset = text.length) {
        const prefix = text.slice(0, rewindOffset);
        const retained = new XmlClosingTagGuard({ mode: this.mode, schema: this.schema, expectedRootTags: this.expectedRootTags, allowToolCalls: this.allowToolCalls });
        if (retained.inspect(prefix)) throw new Error('Cannot force XML structure over an already invalid retained prefix.');
        const state = retained.terminalState(prefix);
        if (state.pendingMarkup) return retained.nextForcedPrefix(prefix, state.pendingMarkupStart);
        const frame = retained.currentFrame();
        const required = retained.missing(frame)[0];
        if (required) return { rewindOffset, text: `<${required.name}>`, requirement: required.name };
        if (frame?.kind === 'cdata') return { rewindOffset, text: ']]>', requirement: 'CDATA close' };
        if (frame?.name) return { rewindOffset, text: `</${frame.name}>`, requirement: frame.name };
        throw new Error('XML schema has no missing required field or current element to close.');
    }
    isViablePrefix(text) {
        if (this.inspect(text) || this.invalidMarkup) return false;
        if (this.expectedRootTags.length && (!this.rootOpened || this.completedAt !== null)) return true;
        const pending = text.slice(this.offset);
        if (this.cdataFrame && /^\]{1,2}$/.test(pending)) return this.currentFrame() === this.cdataFrame;
        if (!pending.startsWith('</')) {
            if (!pending || pending === '<') return true;
            if (['<!--', '<![CDATA[', '<?', '<!DOCTYPE'].some(prefix => prefix.startsWith(pending) || pending.startsWith(prefix))) return true;
            if (!new RegExp(`^<${NAME}`, 'u').test(pending)) return false;
            if (this.schema && !this.cdataFrame && !this.currentFrame()?.payload) {
                const partial = pending.slice(1).split(/[\x20\t\r\n/>]/)[0];
                const parent = this.currentFrame();
                const candidates = parent?.node?.children.filter(child => (parent.counts.get(child.name) || 0) < child.max) || [];
                return pending.length === partial.length + 1
                    ? candidates.some(child => child.name.startsWith(partial))
                    : candidates.some(child => child.name === partial);
            }
            return true;
        }
        const expected = this.stack.at(-1);
        if (!expected || expected === CDATA_FRAME) return false;
        const name = pending.slice(2);
        if (expected.startsWith(name)) return true;
        return new RegExp(`^${escapeRegex(expected)}${SPACE}$`, 'u').test(name);
    }
    closeCdata(start, rewindStart = start) {
        if (!this.cdataFrame || this.currentFrame() !== this.cdataFrame) {
            return this.violation(start, start + 3, 'CDATA', 'CDATA may close only after its inner tags close.', 'cdata-close', rewindStart);
        }
        this.pop(); this.cdataFrame = null; this.offset = start + 3;
        return null;
    }
    inspect(text) {
        if (typeof text !== 'string') throw new TypeError('XML closing guard requires response text.');
        if (!text.startsWith(this.text)) this.beginGeneration();
        this.text = text;
        if (this.detection) return this.detection;
        if ((this.stopAtDocumentEnd || this.expectedRootTags.length) && this.completedAt !== null) return null;
        if (this.plain) return null;
        if (!this.active) {
            const leading = text.trimStart().toLowerCase();
            if ('```xml'.startsWith(leading) || '```'.startsWith(leading)) return null;
            const prefix = text.replace(/^\s*```(?:xml)?[\t ]*(?:\r?\n)?/i, '').trimStart();
            if (!prefix) return null;
            if (['<!--', '<![CDATA[', '<?', '</', '<!DOCTYPE'].some(marker => marker.startsWith(prefix))) return null;
            const declaration = ['<!--', '<![CDATA[', '<?', '<!DOCTYPE'].some(marker => prefix.startsWith(marker));
            const namePrefix = prefix.startsWith('</') ? prefix.slice(2) : prefix.slice(1);
            if (!prefix.startsWith('<') || (!declaration && !new RegExp(`^${NAME}`, 'u').test(namePrefix))) { this.plain = true; return null; }
            this.active = true;
        }
        while (this.offset < text.length) {
            if (this.cdataFrame?.outerFrame?.node?.children.length && !this.cdataFrame.outerFrame.node.allowText) {
                const close = text.indexOf(']]>', this.offset);
                let content = text.slice(this.offset, close < 0 ? text.length : close);
                if (close < 0) content = content.replace(/\]{1,2}$/, '');
                if (content.trim()) return this.violation(this.cdataFrame.start, close < 0 ? text.length : close,
                    '#text', 'A schema container cannot contain nonempty CDATA text.', 'schema-text', this.cdataFrame.start);
            }
            const nextTag = text.indexOf('<', this.offset);
            const cdataEnd = text.indexOf(']]>', this.offset);
            const start = nextTag < 0 ? cdataEnd : cdataEnd < 0 ? nextTag : Math.min(nextTag, cdataEnd);
            const textEnd = start < 0 ? text.length : start;
            const frame = this.currentFrame();
            if (!this.cdataFrame && frame?.node?.name && frame.node.children.length && !frame.node.allowText && text.slice(this.offset, textEnd).trim()) {
                return this.violation(this.offset, textEnd, '#text', 'A schema container accepts child elements, not direct text.', 'schema-text');
            }
            if (start < 0) {
                const tail = text.match(/\]{1,2}$/)?.[0] || '';
                this.offset = text.length - tail.length;
                break;
            }
            if (start === cdataEnd) {
                if (!this.checkStructure || (this.expectedRootTags.length && !this.rootOpened)) { this.offset = start + 3; continue; }
                const error = this.closeCdata(start); if (error) return error; continue;
            }
            const fragment = text.slice(start);
            if (['<!--', '<![CDATA[', '<?', '<!DOCTYPE', '</'].some(prefix => prefix.startsWith(fragment))) { this.offset = start; break; }
            // Outside a declared root, markup is lexical context only. Still skip
            // complete quoted tags/comments/CDATA so their contents cannot open it.
            if (this.expectedRootTags.length && !this.rootOpened) {
                const opening = OPEN_NAME.exec(fragment.slice(1));
                if (!fragment.startsWith('</') && opening && this.expectedRootTags.includes(opening[1])) {
                    this.rootOpened = true;
                    this.rootName = opening[1];
                }
            }
            const outsideRoot = this.expectedRootTags.length > 0 && !this.rootOpened;
            if (fragment.startsWith('<![CDATA[')) {
                if (!this.checkStructure || outsideRoot) {
                    const end = text.indexOf(']]>', start + 9);
                    if (end < 0) { this.offset = start; break; }
                    this.offset = end + 3; continue;
                }
                if (!this.cdataFrame) {
                    this.cdataFrame = { name: CDATA_FRAME, kind: 'cdata', node: null, counts: new Map(),
                        outerFrame: this.currentFrame(), start };
                    this.push(this.cdataFrame);
                }
                this.offset = start + 9; continue;
            }
            if (fragment.startsWith('<!--') || fragment.startsWith('<?')) {
                const ending = fragment.startsWith('<!--') ? '-->' : '?>';
                const end = text.indexOf(ending, start + 2);
                if (this.cdataFrame && cdataEnd >= 0 && (end < 0 || cdataEnd < end)) {
                    const error = this.closeCdata(cdataEnd, start); if (error) return error; continue;
                }
                if (end < 0) { this.offset = start; break; }
                this.offset = end + ending.length; continue;
            }
            if (!outsideRoot && !this.allowToolCalls && !this.cdataFrame && /^<tool_call(?=[\x20\t\r\n/>])/.test(fragment)) {
                const path = '/' + [...this.stack, 'tool_call'].join('/');
                const error = this.violation(start, start + '<tool_call'.length + 1, 'tool_call',
                    `${path}: no native tools are available for this completion. Return the requested XML without <tool_call> elements.`, 'xml-tool-call-policy');
                error.end = Math.min(error.end, text.length);
                error.path = path;
                return error;
            }
            if (this.cdataFrame && !new RegExp(`^<\\/?${NAME}`, 'u').test(fragment) && !fragment.startsWith('<!')) {
                this.offset = start + 1; // Literal comparisons inside CDATA are text, not malformed XML tags.
                continue;
            }
            let quote = null, subsetDepth = 0, end = start + 1;
            for (; end < text.length; end += 1) {
                if (this.cdataFrame && end === cdataEnd) break;
                const char = text[end];
                if (quote) { if (char === quote) quote = null; continue; }
                if (fragment.startsWith('<!') && text.startsWith('<!--', end)) {
                    const commentEnd = text.indexOf('-->', end + 4);
                    if (commentEnd < 0) { end = text.length; break; }
                    end = commentEnd + 2; continue;
                }
                if (char === '"' || char === "'") { quote = char; continue; }
                if (fragment.startsWith('<!')) { if (char === '[') subsetDepth += 1; if (char === ']') subsetDepth -= 1; }
                if (char === '>' && subsetDepth <= 0) break;
            }
            if (this.cdataFrame && end === cdataEnd) {
                return this.violation(cdataEnd, cdataEnd + 3, 'CDATA',
                    'CDATA close interrupts an unfinished inner tag.', 'cdata-partial-tag', start);
            }
            if (end === text.length) { this.offset = start; break; }
            const markup = text.slice(start, end + 1);
            if (outsideRoot) { this.offset = end + 1; continue; }
            if (markup.startsWith('</')) {
                const close = CLOSE.exec(markup);
                if (close) {
                    if (!this.checkStructure) {
                        if (this.rootName === close[1] && --this.rootDepth === 0) {
                            this.completedAt = end + 1; this.offset = this.completedAt; return null;
                        }
                        const index = this.stack.lastIndexOf(close[1]);
                        if (index >= 0) { this.stack.length = index; this.frames.length = index; }
                        this.offset = end + 1; continue;
                    }
                    const expected = this.stack.at(-1) || null;
                    const allowed = expected && expected !== CDATA_FRAME ? `(?!${escapeRegex(expected)}${SPACE}>)` : '';
                    const pattern = new RegExp(`^<\\/${allowed}${NAME}${SPACE}>$`, 'u');
                    if (pattern.test(markup)) {
                        const error = this.violation(start, end + 1, close[1], `Closing ${close[1]} does not match ${expected || 'an open element'}.`);
                        error.pattern = pattern.source; return error;
                    }
                    const required = this.missing()[0];
                    if (required) return this.violation(start, end + 1, close[1], `Missing required <${required.name}> before closing ${close[1]}.`, 'schema-close');
                    this.pop();
                    if ((this.schema || this.expectedRootTags.length) && this.frames.length === 0 && this.missing(this.documentFrame).length === 0) {
                        this.completedAt = end + 1;
                        if (this.stopAtDocumentEnd || this.expectedRootTags.length) { this.offset = this.completedAt; return null; }
                    }
                } else this.invalidMarkup = true;
            } else if (!markup.startsWith('<!')) {
                const name = OPEN_NAME.exec(markup.slice(1));
                if (name) {
                    let childSchema = null;
                    const parent = this.currentFrame();
                    if (this.schema && !this.cdataFrame && !parent?.payload && !parent?.node?.markup) {
                        childSchema = parent?.node?.children.find(child => child.name === name[1]);
                        if (!childSchema) return this.violation(start, end + 1, name[1], `Unknown child <${name[1]}> in ${parent?.name || 'document'}.`, 'schema-opening');
                        if ((parent.counts.get(name[1]) || 0) >= childSchema.max) return this.violation(start, end + 1, name[1], `Duplicate singleton <${name[1]}>.`, 'schema-opening');
                    }
                    const opened = { name: name[1], kind: 'element', node: childSchema, counts: new Map(),
                        payload: Boolean(parent?.payload || parent?.node?.markup || childSchema?.markup) };
                    const selfClosing = /\/\s*>$/.test(markup);
                    if (this.rootName === name[1] && !selfClosing) this.rootDepth += 1;
                    if (selfClosing && this.missing(opened).length) return this.violation(start, end + 1, name[1], `Self-closing ${name[1]} omits required children.`, 'schema-opening');
                    if (childSchema) parent.counts.set(name[1], (parent.counts.get(name[1]) || 0) + 1);
                    if (!selfClosing) this.push(opened);
                    else if ((this.schema || this.expectedRootTags.length) && this.frames.length === 0 && this.missing(this.documentFrame).length === 0) {
                        this.completedAt = end + 1;
                        if (this.stopAtDocumentEnd || this.expectedRootTags.length) { this.offset = this.completedAt; return null; }
                    }
                } else this.invalidMarkup = true;
            }
            this.offset = end + 1;
        }
        return null;
    }
}
module.exports = { XmlClosingTagGuard };
