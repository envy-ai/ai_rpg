# nunjucks_filters

`nunjucks_filters.js` registers shared server template helpers. Its existing
helpers provide the `eval` filter, `getLocationInfo` and `randomword` globals.

`addXmlTextFilter(env)` registers `xmlText` for **XML text nodes only**. Use
`{{ value | dump | xmlText }}` to embed compact JSON in an element body. Exported
`escapeXmlText(text)` requires a string and escapes `&`, `<` and `>` in that order;
quotes and apostrophes remain literal because they do not delimit text nodes.
The filter returns a Nunjucks safe string to prevent a second autoescape pass.
It must not be used for attribute values or HTML/script contexts.

Literal entity-looking text is preserved (`&quot;` becomes `&amp;quot;`), closing
tags cannot terminate the containing element, and `]]>` cannot terminate the
outer prompt template CDATA. Undefined/nonstring inputs and invalid environments
throw instead of producing placeholder text.

The common server filter setup installs it on the view, prompt, image-prompt and
deterministic template environments. Technique context, committed receipts and
standard/TinyBrain authoring-fact JSON use the filter. The standalone prompt-runner
CLI also registers it.
