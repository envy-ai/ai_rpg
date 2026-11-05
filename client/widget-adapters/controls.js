import { Tabs } from '../../packages/ui-widgets/src/tabs.js';

import { Repeater, createRowActions } from '../../packages/ui-widgets/src/repeater.js';
import { OrderedTextList } from '../../packages/ui-widgets/src/ordered-text-list.js';
import { createField } from '../../packages/ui-widgets/src/field.js';
import { NumberRange } from '../../packages/ui-widgets/src/number-range.js';

window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
Object.assign(window.AIRPG_WIDGETS, { Tabs, Repeater, createRowActions, OrderedTextList, createField, NumberRange });
