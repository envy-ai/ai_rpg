import { createField } from '../src/field.js';

/** Native, opt-in style specimen; no app globals or interaction policy. */
export function mountFoundations(parent) {
    const document = parent.ownerDocument;
    const section = document.createElement('section');
    section.id = 'foundations-example';
    section.innerHTML = '<h2>Portable visual foundations</h2><p>Native content with local theme overrides.</p><div class="foundations-columns"></div><label for="foundations-native">Unclassed native control</label><input id="foundations-native" value="Package styles leave this control alone">';
    const columns = section.querySelector('.foundations-columns');
    for (const [id, name, themeClass] of [['default', 'Default surface', ''], ['dark', 'Local dark surface', 'foundations-theme-dark']]) {
        const surface = document.createElement('div');
        surface.className = `uiw-surface ${themeClass}`;
        surface.id = `foundations-${id}`;
        const heading = document.createElement('h3');
        heading.textContent = name;
        const badge = document.createElement('span');
        badge.className = 'uiw-badge';
        badge.textContent = 'Native badge';
        const field = createField({ document, label: 'Labeled entry', id: `foundations-entry-${id}`, className: 'uiw-field', value: 'Long content stays inside its native field.' });
        const help = document.createElement('small');
        help.className = 'uiw-help';
        help.textContent = 'Help text follows the field without app fonts or tokens.';
        field.field.append(help);
        const invalid = createField({ document, label: 'Entry with an error', id: `foundations-invalid-${id}`, className: 'uiw-field', value: 'Retained invalid draft' });
        invalid.input.setAttribute('aria-invalid', 'true');
        const error = document.createElement('small');
        error.id = `foundations-error-${id}`;
        error.className = 'uiw-field-error';
        error.textContent = 'Correct this entry before submitting.';
        invalid.input.setAttribute('aria-describedby', error.id);
        invalid.field.append(error);
        const actions = document.createElement('div');
        actions.className = 'foundations-actions';
        actions.innerHTML = '<button type="button" class="uiw-button">Normal action</button><button type="button" class="uiw-icon-button" aria-label="Close example">×</button><button type="button" class="uiw-button" disabled>Unavailable</button><button type="button" class="uiw-button" disabled aria-busy="true">Working…</button>';
        const region = document.createElement('div');
        region.className = 'uiw-table-scroll';
        region.tabIndex = 0;
        region.setAttribute('role', 'region');
        region.setAttribute('aria-label', `${name} tabular details`);
        region.innerHTML = '<table class="uiw-table"><caption>Literal read-only details</caption><thead><tr><th scope="col">Field</th><th scope="col">Recorded value</th></tr></thead><tbody><tr><th scope="row">Zero</th><td>0</td></tr><tr><th scope="row">Long text</th><td><code>long_literal_value_with_symbols_&lt;&amp;&gt;_and_a_deliberately_wide_column</code></td></tr></tbody></table>';
        surface.append(heading, badge, field.field, invalid.field, actions, region);
        columns.append(surface);
    }
    parent.append(section);
    return () => section.remove();
}
