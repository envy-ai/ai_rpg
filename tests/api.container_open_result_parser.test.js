const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function extractFunction(source, name) {
    const signature = `function ${name}(`;
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Unable to locate ${name} in api.js`);
    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `Unable to locate ${name} params in api.js`);
    let paramDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            paramDepth += 1;
        } else if (char === ')') {
            paramDepth -= 1;
            if (paramDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `Unable to locate ${name} params end in api.js`);
    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `Unable to locate ${name} body in api.js`);

    let depth = 0;
    let state = 'code';
    let quote = '';
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1] || '';

        if (state === 'line-comment') {
            if (char === '\n') {
                state = 'code';
            }
            continue;
        }
        if (state === 'block-comment') {
            if (char === '*' && next === '/') {
                state = 'code';
                index += 1;
            }
            continue;
        }
        if (state === 'string') {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                state = 'code';
                quote = '';
            }
            continue;
        }
        if (state === 'template') {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '`') {
                state = 'code';
            }
            continue;
        }

        if (char === '/' && next === '/') {
            state = 'line-comment';
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            state = 'block-comment';
            index += 1;
            continue;
        }
        if (char === '"' || char === "'") {
            state = 'string';
            quote = char;
            continue;
        }
        if (char === '`') {
            state = 'template';
            continue;
        }
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to locate ${name} end in api.js`);
}

function loadContainerOpenResultParser() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const functionNames = [
        'sanitizeForXml',
        'trimLeadingParagraphSpaces',
        'getDirectChildElementByTagName',
        'getDirectChildTextByTagName',
        'extractProseNodeContentPreservingTags',
        'parseContainerOpenResultXml'
    ];
    const functionSource = functionNames.map(name => extractFunction(source, name)).join('\n\n');
    const context = {
        Utils: require('../Utils.js')
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.parseContainerOpenResultXml = parseContainerOpenResultXml;`,
        context
    );
    return context.parseContainerOpenResultXml;
}

test('container open-check parser reads permanentlyOpened', () => {
    const parseContainerOpenResultXml = loadContainerOpenResultParser();
    const parsed = parseContainerOpenResultXml(`
<containerOpenResult>
  <success>true</success>
  <permanentlyOpened>true</permanentlyOpened>
  <prose>The latch clicks open.</prose>
</containerOpenResult>
`);

    assert.equal(parsed.success, true);
    assert.equal(parsed.permanentlyOpened, true);
    assert.equal(parsed.prose, 'The latch clicks open.');
});

test('container open-check parser requires permanentlyOpened', () => {
    const parseContainerOpenResultXml = loadContainerOpenResultParser();

    assert.throws(
        () => parseContainerOpenResultXml(`
<containerOpenResult>
  <success>true</success>
  <prose>The latch clicks open.</prose>
</containerOpenResult>
`),
        /missing <permanentlyOpened>/
    );
});
