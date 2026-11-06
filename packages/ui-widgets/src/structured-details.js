function requireDocument(document) {
    if (!document?.createElement) throw new TypeError('Structured details require a browser document.');
}

/** Native details chrome; the browser owns open state and keyboard interaction. */
export function createDisclosure({ document = globalThis.document, summaryText = '', className = '', summaryClass = '', open = false, dataset = {} } = {}) {
    requireDocument(document);
    if (typeof summaryText !== 'string' || typeof open !== 'boolean') throw new TypeError('createDisclosure requires summary text and a boolean open state.');
    const details = document.createElement('details');
    details.className = className;
    details.open = open;
    for (const [key, value] of Object.entries(dataset)) details.dataset[key] = String(value);
    const summary = document.createElement('summary');
    if (summaryClass) summary.className = summaryClass;
    summary.textContent = summaryText;
    details.append(summary);
    return { details, summary };
}

/** Preserve already-rendered host HTML without parsing/re-serializing nested controls. */
export function disclosureMarkup({ document = globalThis.document, summaryText = '', className = '', summaryClass = '', open = false, dataset = {}, bodyHtml } = {}) {
    if (typeof bodyHtml !== 'string') throw new TypeError('disclosureMarkup requires trusted, already-rendered host bodyHtml.');
    const { details } = createDisclosure({ document, summaryText, className, summaryClass, open, dataset });
    const chrome = details.outerHTML;
    return `${chrome.slice(0, -'</details>'.length)}${bodyHtml}</details>`;
}

/** Layout only: callers supply ordered, formatted labels/values and change flags. */
export function createFieldComparison({ document = globalThis.document, rows, beforeLabel = 'Before', afterLabel = 'After', classNames = {} } = {}) {
    requireDocument(document);
    if (!Array.isArray(rows) || typeof beforeLabel !== 'string' || typeof afterLabel !== 'string') throw new TypeError('createFieldComparison requires ordered rows and text column labels.');
    const classes = { root: 'field-comparison', field: 'field-comparison__field', columns: 'field-comparison__columns', text: 'field-comparison__text', changed: 'is-changed', ...classNames };
    const root = document.createElement('div');
    root.className = classes.root;
    for (const row of rows) {
        if (!row || ['label', 'before', 'after'].some(key => typeof row[key] !== 'string') || typeof row.changed !== 'boolean') throw new TypeError('Comparison rows require formatted label/before/after strings and a boolean changed flag.');
        const field = document.createElement('article');
        field.className = `${classes.field}${row.changed ? ` ${classes.changed}` : ''}`;
        const heading = document.createElement('h3');
        heading.textContent = row.label;
        const columns = document.createElement('div');
        columns.className = classes.columns;
        for (const [label, value] of [[beforeLabel, row.before], [afterLabel, row.after]]) {
            const column = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = label;
            const text = document.createElement('p');
            text.className = classes.text;
            text.textContent = value;
            column.append(title, text);
            columns.append(column);
        }
        field.append(heading, columns);
        root.append(field);
    }
    return root;
}

/** Read-only literal object/list presentation; labels and scalar formatting stay host-owned. */
export function createValueProjection({ document = globalThis.document, value, formatKey, formatValue, classNames = {} } = {}) {
    requireDocument(document);
    if (typeof formatKey !== 'function' || typeof formatValue !== 'function') throw new TypeError('createValueProjection requires key and scalar text formatters.');
    const textClass = classNames.text ?? 'value-projection__text';
    const formatted = (formatter, value) => {
        const text = formatter(value);
        if (typeof text !== 'string') throw new TypeError('Value projection formatters must return literal text strings.');
        return text;
    };
    const paragraph = value => {
        const text = document.createElement('p');
        text.className = textClass;
        text.textContent = formatted(formatValue, value);
        return text;
    };
    const render = value => {
        if (Array.isArray(value)) {
            const list = document.createElement('ul');
            for (const item of value) {
                const row = document.createElement('li');
                row.append(typeof item === 'object' ? render(item) : document.createTextNode(formatted(formatValue, item)));
                list.append(row);
            }
            return list;
        }
        if (value && typeof value === 'object') {
            const list = document.createElement('dl');
            for (const [key, item] of Object.entries(value)) {
                const term = document.createElement('dt');
                term.textContent = formatted(formatKey, key);
                const definition = document.createElement('dd');
                definition.append(typeof item === 'object' ? render(item) : paragraph(item));
                list.append(term, definition);
            }
            return list;
        }
        return paragraph(value);
    };
    return render(value);
}
