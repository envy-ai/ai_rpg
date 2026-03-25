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
