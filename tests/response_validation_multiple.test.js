'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
const Technique = require('../Technique.js');
const { parseTechniqueXmlValue, candidateSchema } = require('../TechniqueXml.js');
const { ValidationIssueCollector, ResponseValidationError, withValidationContext } = require('../ResponseValidation.js');

function errorFrom(fn) {
    try { fn(); } catch (error) { return error; }
    assert.fail('Expected validation to reject the complete response');
}

test('collector preserves original single errors and caps distinct issues in encounter order', () => {
    const only = new TypeError('one', { cause: new Error('underlying cause') });
    const single = new ValidationIssueCollector();
    single.add(only);
    assert.equal(errorFrom(() => single.throwIfAny()), only);

    const collector = new ValidationIssueCollector();
    const issues = ['one', 'two', 'two', ...Array.from({ length: 10 }, (_, i) => `problem ${i + 3}`)].map(message => new Error(message));
    issues.forEach(issue => collector.add(issue));
    const error = errorFrom(() => collector.throwIfAny());
    assert.ok(error instanceof ResponseValidationError);
    assert.deepEqual(error.issues.map(issue => issue.message), ['one', 'two', ...Array.from({ length: 8 }, (_, i) => `problem ${i + 3}`)]);
    assert.equal(error.cause, issues[0]);
    assert.match(error.message, /1[.)].*one[\s\S]*2[.)].*two[\s\S]*10[.)].*problem 10/);
    assert.doesNotMatch(error.message, /problem 11/);
});

test('nested aggregates flatten and deduplicate while context preserves individual causes', () => {
    const first = new Error('first');
    const second = new TypeError('second', { cause: new Error('root cause') });
    const collector = new ValidationIssueCollector();
    collector.add(new ResponseValidationError([first, new ResponseValidationError([second, new Error('first')])]));
    const error = errorFrom(() => collector.throwIfAny());
    assert.deepEqual(error.issues.map(issue => issue.message), ['first', 'second']);
    const contextual = withValidationContext(error, 'status[0]');
    assert.deepEqual(contextual.issues.map(issue => issue.message), ['status[0]: first', 'status[0]: second']);
    assert.equal(contextual.issues[0].cause, first);
    assert.equal(contextual.issues[1].cause, second);
    assert.equal(contextual.issues[1].cause.cause.message, 'root cause');
});

test('cancellation propagates through nested aggregate and context even after the issue budget is full', () => {
    const cancelled = Object.assign(new Error('cancelled'), { code: 'PROMPT_CANCELLED' });
    const wrapped = withValidationContext(new ResponseValidationError([new Error('ordinary'), cancelled]), 'status');
    const collector = new ValidationIssueCollector();
    for (let i = 0; i < 10; i++) collector.add(new Error(`problem ${i}`));
    assert.throws(() => collector.add(wrapped), error => error === wrapped);
});

test('independent errors in one revision are reported together without cascading from an invalid check kind', () => {
    const revision = {
        revision: 1,
        target: { kind: 'unknown' },
        check: { kind: 'invalid', skill: 'Arcana' },
        costs: [{ resource: 'health', amount: -1 }],
        effects: [{ id: 'heal', kind: 'healing', amount: 1 }]
    };
    const error = errorFrom(() => Technique.normalizeRevision(revision, 'revision'));
    assert.match(error.message, /revision\.target\.kind/);
    assert.match(error.message, /revision\.check\.kind/);
    assert.match(error.message, /revision\.costs\[0\]\.amount/);
    assert.doesNotMatch(error.message, /revision\.check\.skill.*required/);
    assert.ok(error.issues.length >= 3);
});

test('typed XML reports distinct invalid sibling values and retains valid empty list semantics', () => {
    const xml = '<candidate><unique>yes</unique><provenance><private>perhaps</private><worldMinute>NaN</worldMinute><reason>ok</reason></provenance></candidate>';
    const parse = input => parseTechniqueXmlValue(new DOMParser().parseFromString(input, 'text/xml').documentElement, candidateSchema, 'candidate');
    const error = errorFrom(() => parse(xml));
    assert.ok(error.issues.length >= 3);
    assert.match(error.message, /candidate\.unique/);
    assert.match(error.message, /candidate\.provenance\.private/);
    assert.match(error.message, /candidate\.provenance\.worldMinute/);
    assert.deepEqual(parse('<candidate><unique>false</unique><provenance><private>false</private><worldMinute>0</worldMinute><sourceId/></provenance><revisions><revision><failureCosts/></revision></revisions></candidate>'), {
        unique: false, provenance: { private: false, worldMinute: 0 }, revisions: [{ revision: 1, failureCosts: [] }]
    });
});

test('recipe validation reports independent selector, requirement and check problems', () => {
    const { parseAutomaticTechniqueCandidate } = require('../TechniquePrompt.js');
    const candidate = {
        id: 'technique-test', disciplineId: 'discipline-test', name: 'Test', description: 'A test.', semanticKey: 'test',
        provenance: { kind: 'discovery', reason: 'Practice.' },
        revisions: [{ revision: 1, recipe: { kind: 'invalid' }, acquisitionRequirements: [{ kind: 'level' }],
            check: { kind: 'skill' }, target: { kind: 'area' } }]
    };
    const error = errorFrom(() => parseAutomaticTechniqueCandidate(candidate));
    assert.ok(error.issues.length >= 3);
    assert.match(error.message, /recipe\.kind/);
    assert.match(error.message, /acquisitionRequirements\[0\]\.minimum/);
    assert.match(error.message, /check\.skill/);
    assert.doesNotMatch(error.message, /target/, 'target validation waits for a valid recipe kind');
    const targetError = errorFrom(() => parseAutomaticTechniqueCandidate({ ...candidate, revisions: [{ ...candidate.revisions[0], recipe: { kind: 'healing' }, target: { kind: 'area', allowDead: true }, acquisitionRequirements: [], check: { kind: 'automatic' } }] }));
    assert.match(targetError.message, /target/);
});

test('shared retry appends numbered issues when a callback omits the error and does so only once', async () => {
    const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
    const messages = [];
    const aggregate = new ResponseValidationError([new Error('first actual problem'), new Error('second actual problem')]);
    const result = await runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Produce complete XML.' }], maxAttempts: 2,
        complete: ({ messages: attemptMessages }) => { messages.push(attemptMessages); return messages.length === 1 ? '<bad/>' : '<good/>'; },
        parse: response => { if (response === '<bad/>') throw aggregate; return response; },
        buildRetryInstruction: () => 'Correct the complete XML response.'
    });
    assert.equal(result.value, '<good/>');
    const feedback = messages[1].at(-1).content;
    assert.match(feedback, /complete XML/);
    assert.match(feedback, /1\. first actual problem[\s\S]*2\. second actual problem/);
    const { withResponseRetryFeedback } = require('../XmlRetryFeedback.js');
    assert.equal(withResponseRetryFeedback(feedback, { error: aggregate }), feedback);
});
