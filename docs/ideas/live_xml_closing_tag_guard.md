# Live XML closing-tag guard

Status: implemented 2026-10-31. Original proposal recorded 2026-10-30.

See [XmlClosingTagGuard](../classes/XmlClosingTagGuard.md) and the
[implementation plan](../superpowers/plans/2026-10-31-live-xml-closing-tag-guard.md)
for the shipped scope, configuration and failure contract.

## Intent

Reuse the live de-slopper's rejection and rewind machinery to prevent mismatched XML closing tags during generation. This structural guard should operate on XML-producing requests even when ordinary prose de-slopping is disabled. It should apply to both standard prompts and TinyBrain XML checkpoints, rather than only player-facing prose.

The motivating failure occurred during Bolted Workbench Station contents generation. The model emitted:

```xml
<item>
  <isVehicle>false</isVehicle>
  <!-- copied explanatory comment --> </isVehicle>
</item>
```

The second `</isVehicle>` attempted to close an element that had already closed. Several retries repeated the same malformed output despite parser feedback. The source item template itself had balanced tags; the generated response duplicated a closing tag while copying template comments.

## Proposed rejection rule

Maintain a stack of open XML elements for the generated response. Only the innermost currently open element may close. Use a dynamically generated regular expression to identify closing tags with any other name.

For example, with `item` at the top of the stack:

```regex
<\/(?!item\s*>)[A-Za-z_][\w:.-]*\s*>
```

This illustrative regex matches `</isVehicle>` while allowing `</item>`. Escape the actual current element name when constructing the expression, and preserve XML's case sensitivity. Use the shared parser's supported XML-name rules rather than treating the illustrative ASCII pattern as a complete XML grammar. With an empty stack, any real closing tag is invalid.

The regex performs rejection; tracking nested state still requires an XML-aware incremental scanner. A single fixed regex cannot identify the current open element for arbitrarily nested output.

On an invalid close, locate the sampled tokens that produced it and use the existing alternative-token/assistant-prefill continuation mechanism to generate another branch. Recheck the alternative against the same structural rule. This is a generation-time correction, not deletion or replacement of tags in a completed response.

## State handling

- Push opening elements, pop matching closing elements, and leave self-closing elements off the stack.
- Ignore apparent tags inside XML comments, CDATA, and processing instructions. Respect quoted attribute values when finding tag boundaries.
- Buffer incomplete markup across token/chunk boundaries. Do not reject a closing tag while its name is still an unfinished prefix of the valid name.
- Track the response and retained assistant prefill, not XML examples in the input prompt or tool-result messages.
- After a rewind, restore the scanner state corresponding to the retained prefix. Discard stack changes from the rejected suffix.
- Scope enforcement to XML output. Plain prose checkpoints and native tool-call payloads have different syntax contracts.

## Existing integration points and limitations

[LiveDeslop](../classes/LiveDeslop.md) already accepts regex detections, maps matches to sampled tokens, selects alternate branches, and requests rewind through [LLMClient](../classes/LLMClient.md). However, its current prose extraction excludes XML markup, its alternative selection rejects XML delimiters, and its rewind search stops at XML boundaries. Structural detection and correction therefore need a raw-XML path while reusing the common transport/continuation machinery. Adding a regex to the ordinary prose-slop list alone would not activate this guard.

Some backend content, including XML tag fragments, may arrive without usable token alternatives. Detection can still observe raw text, but branch correction requires an eligible sampled position. The implementation must explicitly decide how to handle an invalid tag when no viable branch is available, preserving clear diagnostics rather than silently accepting or repairing malformed XML. Provider support and scope beyond the OpenAI-compatible live-token path remain implementation decisions.

Strict final XML parsing and domain validation remain authoritative. This guard does not by itself enforce required fields, field types, valid references, or tag closure at end of generation. Missing closing tags at end-of-response are a separate issue from mismatched closing tags.

## Focused verification when implemented

Exercise nested valid closes, the duplicate `isVehicle` case, wrong ancestor closes, empty-stack closes, self-closing elements, comments/CDATA containing example tags, quoted attributes, namespaced names, split-token closes, and scanner restoration after rewind. Verify structural correction with prose de-slopping disabled, with both guards active, and in standard and TinyBrain XML output. Test missing token alternatives and exhausted branches as explicit failure cases, alongside unchanged final parser validation.
