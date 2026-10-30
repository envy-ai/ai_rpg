(() => {
    'use strict';

    function normalizeOptions(options = []) {
        return Array.from(new Set(options
            .filter(option => typeof option === 'string')
            .map(option => option.trim())
            .filter(Boolean)));
    }

    /**
     * Shared searchable select/multi-select widget. Values are exposed through
     * getValue(), onChange, and the searchable-select-change event; the host
     * owns form serialization so the widget's internal controls never leak
     * implementation-only fields into a containing form.
     */
    class SearchableSelect {
        constructor(root, { multiple = false, options = [], value = null, onChange = null, emptyLabel = 'Use workflow default' } = {}) {
            if (!(root instanceof HTMLElement)) {
                throw new TypeError('SearchableSelect requires a root element.');
            }
            this.root = root;
            this.emptyLabel = emptyLabel;
            this.multiple = multiple;
            this.options = normalizeOptions(options);
            this.values = multiple
                ? normalizeOptions(Array.isArray(value) ? value : [])
                : normalizeOptions([value])[0] || '';
            this.onChange = typeof onChange === 'function' ? onChange : null;
            this.render();
        }

        setOptions(options) {
            this.options = normalizeOptions(options);
            this.render();
        }

        getValue() {
            return this.multiple ? [...this.values] : this.values;
        }

        setValue(value) {
            this.values = this.multiple
                ? normalizeOptions(Array.isArray(value) ? value : [])
                : normalizeOptions([value])[0] || '';
            this.render();
        }

        emitChange() {
            const value = this.getValue();
            this.root.dispatchEvent(new CustomEvent('searchable-select-change', { bubbles: true, detail: { value } }));
            this.onChange?.(value);
        }

        render() {
            const previousQuery = this.root.querySelector('input[type="search"]')?.value || '';
            const disabled = this.root.querySelector('input,select')?.disabled || false;
            this.root.replaceChildren();
            this.root.classList.add('searchable-select');
            const accessibleName = this.root.dataset.label || 'Options';
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'searchable-select__search';
            search.placeholder = this.root.dataset.placeholder || 'Search…';
            search.value = previousQuery;
            search.disabled = disabled;
            search.setAttribute('aria-label', `Search ${accessibleName} options`);
            const choices = document.createElement(this.multiple ? 'div' : 'select');
            choices.className = this.multiple ? 'searchable-select__choices' : 'searchable-select__select';
            if (this.multiple) {
                choices.setAttribute('role', 'group');
            } else {
                choices.disabled = disabled;
                choices.addEventListener('change', () => {
                    this.values = choices.value;
                    this.emitChange();
                });
            }
            choices.setAttribute('aria-label', accessibleName);
            const renderChoices = () => {
                const terms = search.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
                const matches = this.options.filter(option => terms.every(term => option.toLocaleLowerCase().includes(term)));
                choices.replaceChildren();
                if (!this.multiple) {
                    choices.append(new Option(this.emptyLabel, ''));
                    const visibleOptions = [...matches];
                    if (this.values && !visibleOptions.includes(this.values)) visibleOptions.unshift(this.values);
                    visibleOptions.forEach(option => {
                        const label = this.options.includes(option) ? option : `${option} (unavailable)`;
                        choices.append(new Option(label, option));
                    });
                    if (!matches.length && terms.length) {
                        const noMatches = new Option('No matching options', '');
                        noMatches.disabled = true;
                        choices.append(noMatches);
                    }
                    choices.value = this.values;
                    return;
                }
                const selected = new Set(this.values);
                matches.forEach(option => {
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = selected.has(option);
                    input.disabled = search.disabled;
                    input.addEventListener('change', () => {
                        input.checked ? selected.add(option) : selected.delete(option);
                        this.values = [...selected];
                        this.emitChange();
                    });
                    label.append(input, document.createTextNode(option));
                    choices.appendChild(label);
                });
            };
            search.addEventListener('input', renderChoices);
            this.root.append(search, choices);
            renderChoices();
        }
    }

    window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
    window.AIRPG_WIDGETS.SearchableSelect = SearchableSelect;
})();
