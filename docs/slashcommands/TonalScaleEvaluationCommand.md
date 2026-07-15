# TonalScaleEvaluationCommand

`/tonal_scale_evaluation` runs the tonal-scale evaluation prompt immediately.

## Behavior

- Requires `interaction.runTonalScaleEvaluationPrompt` and throws `Tonal scale evaluation is unavailable in this command context.` when the helper is absent.
- Renders `prompts/_includes/tonal-scale-evaluation.njk` through `prompts/base-context.xml.njk` with `promptType: "tonal-scale-evaluation"`.
- Extracts only the text inside the returned `<tonalScaleEvaluation>` XML block.
- Stores the extracted text as the latest save-metadata tonal evaluation.
- Stores a visible assistant chat-history entry with type `tonal-scale-evaluation` and heading `Tonal scale evaluation`.
- The stored chat entry is excluded from every LLM-facing prompt-history path, including all-entry generic prompt modes and the `getHistory` tool.

## Config

Automatic scheduling is controlled by:

```yaml
tonal_scale_evaluation:
  enabled: true
  interval: 5
```

The manual slash command does not check the automatic scheduling gate.
