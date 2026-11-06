import { createDisclosure, disclosureMarkup, createFieldComparison, createValueProjection } from '../src/structured-details.js';

export function mountStructuredDetails(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'structured-details-example';
    const title = document.createElement('h2');
    title.textContent = 'Native structured readers';
    const { details } = createDisclosure({ document, summaryText: 'Read literal values', dataset: { specimenDisclosure: 'values' } });
    details.id = 'reader-disclosure';
    const projection = createValueProjection({
        document, value: { count: 0, enabled: false, empty: '', nested: ['Literal <text>', { value: null }] },
        formatKey: key => key,
        formatValue: value => String(value ?? '')
    });
    projection.id = 'reader-projection';
    details.append(projection);
    const comparison = createFieldComparison({ document, beforeLabel: 'Stored', afterLabel: 'Reviewed', rows: [
        { label: 'Count · Changed', before: '0', after: '1', changed: true },
        { label: 'Enabled', before: 'false', after: 'false', changed: false },
        { label: 'Literal text', before: '<before> & "quotes"', after: '<after> & "quotes"', changed: true }
    ] });
    comparison.id = 'reader-comparison';
    const host = document.createElement('div');
    host.innerHTML = disclosureMarkup({ document, summaryText: 'Host-rendered body', bodyHtml: '<p>Existing <strong>host markup</strong> stays markup.</p>', open: true });
    host.id = 'reader-host-markup';
    section.append(title, details, comparison, host);
    parent.append(section);
    return () => section.remove();
}
