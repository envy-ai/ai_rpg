const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');
const Globals = require('../Globals.js');

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

test('parseXmlDocument does not dump full XML content when parsing fails', () => {
    const previousConfig = Globals.config;
    const originalLog = console.log;
    const originalWarn = console.warn;
    const captured = [];
    const largePayload = 'x'.repeat(5000);

    try {
        Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
        console.log = (...args) => captured.push(args.join(' '));
        console.warn = (...args) => captured.push(args.join(' '));

        assert.throws(
            () => Utils.parseXmlDocument(`<root><![CDATA ${largePayload}</root>`, 'text/xml'),
            /Invalid CDATA/
        );
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        Globals.config = previousConfig;
    }

    const output = captured.join('\n');
    assert.doesNotMatch(output, /XML Content:\s*<root/);
    assert.equal(output.includes(largePayload), false);
    assert.match(output, /XML parse failure/i);
});

test('parseXmlDocumentStrict does not dump full XML content when parsing fails', () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const captured = [];
    const largePayload = 'x'.repeat(5000);

    try {
        console.log = (...args) => captured.push(args.join(' '));
        console.warn = (...args) => captured.push(args.join(' '));

        assert.throws(
            () => Utils.parseXmlDocumentStrict(`<root><child>${largePayload}</root>`, 'text/xml'),
            /Failed to parse XML content strictly/
        );
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }

    const output = captured.join('\n');
    assert.doesNotMatch(output, /XML Content:\s*<root/);
    assert.equal(output.includes(largePayload), false);
    assert.match(output, /XML parse failure/i);
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

test('extractFinalXmlRootBlock returns the last complete requested root block', () => {
    const response = [
        'Draft:',
        '<turnResult>Draft text.</turnResult>',
        'Final:',
        '<travelProse><originProse>Origin.</originProse></travelProse>'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlRootBlock(response, ['turnResult', 'travelProse']),
        '<travelProse><originProse>Origin.</originProse></travelProse>'
    );
});

test('extractFinalXmlRootBlock supports root attributes', () => {
    const response = [
        '<turnResult>Draft text.</turnResult>',
        '<turnResult mode="final">Final text.</turnResult>'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlRootBlock(response, 'turnResult'),
        '<turnResult mode="final">Final text.</turnResult>'
    );
});

test('extractFinalXmlBlockFromResponse returns the final complete XML block using its closing tag', () => {
    const response = [
        'blah blah',
        '<response>hello</response>',
        '',
        'blah blah',
        '<response>world</response>',
        'blah blah'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlBlockFromResponse(response),
        '<response>world</response>'
    );
});

test('extractFinalXmlBlockFromResponse supports attributes on the final root opening tag', () => {
    const response = [
        'analysis',
        '<editedText>draft</editedText>',
        '<editedText mode="final">final</editedText>',
        'trailing commentary'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlBlockFromResponse(response),
        '<editedText mode="final">final</editedText>'
    );
});

test('extractFinalXmlBlockFromResponse returns the outer final block when the root tag is nested inside it', () => {
    const response = [
        '<region>',
        '  <regionName>Northern Mountain Range</regionName>',
        '  <locations>',
        '    <location>',
        '      <name>Western Slope Landing Shelf</name>',
        '      <vehicles>',
        '        <vehicle>',
        '          <destinations>',
        '            <destination>',
        '              <region>Vehicle Bay Theta-7</region>',
        '              <location>Primary Cradle Gallery</location>',
        '            </destination>',
        '          </destinations>',
        '        </vehicle>',
        '      </vehicles>',
        '    </location>',
        '  </locations>',
        '</region>'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlBlockFromResponse(response),
        response
    );
});

test('extractFinalXmlBlockFromResponse ignores unmatched earlier opening tags when matching the final close', () => {
    const response = [
        '<turnResult> since the vehicle is just completing its normal journey to its preset destination.',
        '',
        '<turnResult>',
        'Fifteen minutes. The Windcutter completes its approach.',
        '<hidden>Windcutter has landed.</hidden>',
        '<timePassed>',
        '<reasoning>15 minutes of remaining flight time.</reasoning>',
        '<duration>15 minutes</duration>',
        '</timePassed>',
        '</turnResult>'
    ].join('\n');

    assert.equal(
        Utils.extractFinalXmlBlockFromResponse(response),
        [
            '<turnResult>',
            'Fifteen minutes. The Windcutter completes its approach.',
            '<hidden>Windcutter has landed.</hidden>',
            '<timePassed>',
            '<reasoning>15 minutes of remaining flight time.</reasoning>',
            '<duration>15 minutes</duration>',
            '</timePassed>',
            '</turnResult>'
        ].join('\n')
    );
});
