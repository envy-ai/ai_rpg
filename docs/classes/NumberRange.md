# NumberRange and native labeled fields

`packages/ui-widgets/src/number-range.js` exports `NumberRange`; `field.js` exports `createField`. Both are available under the classic `AIRPG_WIDGETS` controls adapter. They supply native input behavior and presentation structure while the host retains validation, domain values, serialization and theme.

`new NumberRange(rangeInput, numberInput, {normalize = value => value, onChange})` adopts a same-document native range/number pair. It synchronizes range input, finite numeric input and number blur. `setValue(value, {notify = true})` requires a finite number, applies the caller's `normalize(value)`, requires its finite result, writes both controls and optionally calls `onChange(value)`. It returns the normalized number. There is no library clamping policy; native range controls retain their browser behavior. Play needs/dispositions pass their existing normalization functions, keeping prior domain bounds and numeric coercion.

`setDisabled(boolean)` controls both native inputs. `destroy()` removes listeners/references while retaining native controls; it is idempotent, and later operations throw. Detached controls cannot call the widget callback after destruction.

`createField({document = globalThis.document, label, className = '', inputClass = '', type = 'text', value = '', rows = 2, placeholder = '', step, id})` returns `{field, input, label}`. It creates a wrapper, explicit native label association and input, textarea or select. Null/undefined values become empty; explicit zero and false remain text values. Select options and validation stay caller-owned. Omitted IDs are generated per instance. Worlds calendar fields and both dimensions of image-workflow resolution rows use this builder.

The independent specimen contains a labeled retained draft, structured-row fields, a synchronized range/number pair and disabled/destroy/remount controls.
