function normalizeOptions(options = []) {
    return Array.from(new Set(options
        .filter(option => typeof option === 'string')
        .map(option => option.trim())
        .filter(Boolean)));
}

/** Native search/choice controls. The host owns serialization and persistence. */
export class SearchableSelect {
    constructor(root, { multiple = false, options = [], value = null, onChange = null, emptyLabel = 'Choose…', disabled = false } = {}) {
        if (!root?.ownerDocument?.defaultView || !(root instanceof root.ownerDocument.defaultView.HTMLElement)) {
            throw new TypeError('SearchableSelect requires a root element.');
        }
        this.root = root;
        this.document = root.ownerDocument;
        this.emptyLabel = emptyLabel;
        this.multiple = multiple;
        this.options = normalizeOptions(options);
        this.values = multiple
            ? normalizeOptions(Array.isArray(value) ? value : [])
            : normalizeOptions([value])[0] || '';
        this.onChange = typeof onChange === 'function' ? onChange : null;
        this.destroyed = false;
        this.addedClass = !root.classList.contains('searchable-select');
        this._disabled = Boolean(disabled);
        this.render();
    }

    assertAlive() {
        if (this.destroyed) throw new Error('SearchableSelect has been destroyed. Create a new instance to use this root again.');
    }

    get disabled() {
        this.assertAlive();
        return this.root.querySelector('input,select')?.disabled ?? this._disabled;
    }

    setDisabled(disabled) {
        this.assertAlive();
        if (typeof disabled !== 'boolean') throw new TypeError('SearchableSelect.setDisabled requires a boolean.');
        this._disabled = disabled;
        for (const control of this.root.querySelectorAll('input,select')) control.disabled = disabled;
    }

    setOptions(options) {
        this.assertAlive();
        this.options = normalizeOptions(options);
        this.render();
    }

    getValue() {
        this.assertAlive();
        return this.multiple ? [...this.values] : this.values;
    }

    setValue(value) {
        this.assertAlive();
        this.values = this.multiple
            ? normalizeOptions(Array.isArray(value) ? value : [])
            : normalizeOptions([value])[0] || '';
        this.render();
    }

    emitChange() {
        this.assertAlive();
        const value = this.getValue();
        this.root.dispatchEvent(new this.document.defaultView.CustomEvent('searchable-select-change', { bubbles: true, detail: { value } }));
        this.onChange?.(value);
    }

    render() {
        this.assertAlive();
        const previousQuery = this.root.querySelector('input[type="search"]')?.value || '';
        this._disabled = this.disabled;
        this.listeners?.abort();
        this.checkboxListeners?.abort();
        this.listeners = new this.document.defaultView.AbortController();
        const listen = (element, type, callback) => element.addEventListener(type, callback, { signal: this.listeners.signal });
        this.root.replaceChildren();
        this.root.classList.add('searchable-select');
        const accessibleName = this.root.dataset.label || 'Options';
        const search = this.document.createElement('input');
        this.search = search;
        search.type = 'search';
        search.className = 'searchable-select__search';
        search.placeholder = this.root.dataset.placeholder || 'Search…';
        search.value = previousQuery;
        search.disabled = this._disabled;
        search.setAttribute('aria-label', `Search ${accessibleName} options`);
        const choices = this.document.createElement(this.multiple ? 'div' : 'select');
        this.choices = choices;
        choices.className = this.multiple ? 'searchable-select__choices' : 'searchable-select__select';
        if (this.multiple) {
            choices.setAttribute('role', 'group');
        } else {
            choices.disabled = this._disabled;
            listen(choices, 'change', () => {
                this.values = choices.value;
                this.emitChange();
            });
        }
        choices.setAttribute('aria-label', accessibleName);
        const option = (label, value) => {
            const element = this.document.createElement('option');
            element.textContent = label;
            element.value = value;
            return element;
        };
        let checkboxListeners;
        const renderChoices = () => {
            checkboxListeners?.abort();
            checkboxListeners = new this.document.defaultView.AbortController();
            this.checkboxListeners = checkboxListeners;
            const terms = search.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
            const matches = this.options.filter(value => terms.every(term => value.toLocaleLowerCase().includes(term)));
            choices.replaceChildren();
            if (!this.multiple) {
                choices.append(option(this.emptyLabel, ''));
                const visibleOptions = [...matches];
                if (this.values && !visibleOptions.includes(this.values)) visibleOptions.unshift(this.values);
                visibleOptions.forEach(value => {
                    const label = this.options.includes(value) ? value : `${value} (unavailable)`;
                    choices.append(option(label, value));
                });
                if (!matches.length && terms.length) {
                    const noMatches = option('No matching options', '');
                    noMatches.disabled = true;
                    choices.append(noMatches);
                }
                choices.value = this.values;
                return;
            }
            const selected = new Set(this.values);
            matches.forEach(value => {
                const label = this.document.createElement('label');
                const input = this.document.createElement('input');
                input.type = 'checkbox';
                input.checked = selected.has(value);
                input.disabled = search.disabled;
                input.addEventListener('change', () => {
                    input.checked ? selected.add(value) : selected.delete(value);
                    this.values = [...selected];
                    this.emitChange();
                }, { signal: checkboxListeners.signal });
                label.append(input, this.document.createTextNode(value));
                choices.appendChild(label);
            });
        };
        listen(search, 'input', renderChoices);
        this.root.append(search, choices);
        renderChoices();
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners?.abort();
        this.checkboxListeners?.abort();
        this.search?.remove();
        this.choices?.remove();
        if (this.addedClass) this.root.classList.remove('searchable-select');
        this.onChange = null;
        this.root = null;
        this.document = null;
        this.search = null;
        this.choices = null;
        this.listeners = null;
        this.checkboxListeners = null;
        this.destroyed = true;
    }
}
