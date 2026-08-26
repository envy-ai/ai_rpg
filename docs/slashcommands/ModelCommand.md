# ModelCommand

`/model` reports the current `Globals.config.ai.model`; `/model <model>` changes it in the running process.

It affects subsequent prompts that use the root AI configuration. Prompt-specific `ai_model_overrides` still take precedence for their matching labels. The command does not edit YAML or a loaded save, so a configuration reload or server restart restores the configured model.

Model names may be quoted when needed.
