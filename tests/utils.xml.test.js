const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');

test('parseXmlDocumentStrict parses well-formed XML', () => {
    const doc = Utils.parseXmlDocumentStrict('<root><child>ok</child></root>', 'text/xml');
    assert.equal(doc.documentElement.nodeName, 'root');
    assert.equal(doc.getElementsByTagName('child')[0]?.textContent, 'ok');
});

test('parseXmlDocumentStrict reports malformed XML diagnostics', () => {
    assert.throws(
        () => Utils.parseXmlDocumentStrict(
            '<root><travelProse><vehicleInfo><name>Ship</name></vehicleDestination></travelProse></root>',
            'text/xml'
        ),
        /Opening and ending tag mismatch|Failed to parse XML content strictly/
    );
});

test('extractXmlNodeContent preserves CDATA text without CDATA markers', () => {
    const doc = Utils.parseXmlDocumentStrict(
        '<template><generationPrompt><![CDATA[Use <events> and mention <unclosed> literally.]]></generationPrompt></template>',
        'text/xml'
    );
    const node = doc.getElementsByTagName('generationPrompt')[0];

    assert.equal(
        Utils.extractXmlNodeContent(node),
        'Use <events> and mention <unclosed> literally.'
    );
});

test('extractXmlNodeContent preserves inner XML for non-CDATA prompt nodes', () => {
    const doc = Utils.parseXmlDocumentStrict(
        '<template><generationPrompt><gameState><name>Test</name></gameState></generationPrompt></template>',
        'text/xml'
    );
    const node = doc.getElementsByTagName('generationPrompt')[0];

    assert.match(
        Utils.extractXmlNodeContent(node),
        /<gameState><name>Test<\/name><\/gameState>/
    );
});
