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
        constructor(root, { multiple = false, options = [], value = null, onChange = null } = {}) {
            if (!(root instanceof HTMLElement)) {
                throw new TypeError('SearchableSelect requires a root element.');
            }
            this.root = root;
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
            this.root.replaceChildren();
            this.root.classList.add('searchable-select');
            const search = document.createElement('input');
            search.type = 'search';
            search.className = 'searchable-select__search';
            search.placeholder = this.root.dataset.placeholder || 'Search…';
            search.value = previousQuery;
            const choices = document.createElement('div');
            choices.className = 'searchable-select__choices';
            const selected = this.multiple ? new Set(this.values) : new Set([this.values]);
            const renderChoices = () => {
                const needle = search.value.trim().toLocaleLowerCase();
                choices.replaceChildren();
                this.options.filter(option => !needle || option.toLocaleLowerCase().includes(needle)).forEach(option => {
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = this.multiple ? 'checkbox' : 'radio';
                    input.checked = selected.has(option);
                    input.addEventListener('change', () => {
                        if (this.multiple) {
                            input.checked ? selected.add(option) : selected.delete(option);
                            this.values = [...selected];
                        } else {
                            choices.querySelectorAll('input[type="radio"]').forEach(choice => {
                                choice.checked = choice === input;
                            });
                            selected.clear();
                            selected.add(option);
                            this.values = option;
                        }
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
