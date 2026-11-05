import { SearchableSelect as PortableSearchableSelect } from '../../packages/ui-widgets/src/index.js';

class SearchableSelect extends PortableSearchableSelect {
    constructor(root, { emptyLabel = 'Use workflow default', ...options } = {}) {
        super(root, { ...options, emptyLabel });
    }
}

window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
window.AIRPG_WIDGETS.SearchableSelect = SearchableSelect;
