import { OtherEntry } from '../../packages/ui-widgets/src/other-entry.js';
import { Tabs } from '../../packages/ui-widgets/src/tabs.js';

import { Repeater, createRowActions } from '../../packages/ui-widgets/src/repeater.js';
import { OrderedTextList } from '../../packages/ui-widgets/src/ordered-text-list.js';
import { createField, serializeField, setFieldState, bindSecretToggle } from '../../packages/ui-widgets/src/field.js';
import { NumberRange } from '../../packages/ui-widgets/src/number-range.js';

import { NativeSuggestions } from '../../packages/ui-widgets/src/native-suggestions.js';

import { ReaderRows } from '../../packages/ui-widgets/src/reader-rows.js';

window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
Object.assign(window.AIRPG_WIDGETS, { Tabs, Repeater, createRowActions, OrderedTextList, createField, serializeField, setFieldState, bindSecretToggle, OtherEntry, NumberRange, ReaderRows, NativeSuggestions });
