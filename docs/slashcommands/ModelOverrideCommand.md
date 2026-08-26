# ModelOverrideCommand

`/model_override` lists every configured override category and its current model. `/model_override <category> <model>` changes the `model` field of one existing `Globals.config.ai_model_overrides.<category>` profile in the running process.

Categories are matched case-insensitively but preserve their configured spelling. The command refuses unknown categories rather than creating a profile that no prompt uses, and it preserves that profile's endpoint, prompt list, and all other settings. Supplying only a category or only a model is an error. It applies to subsequent prompts matching the profile and is not written to YAML or a save.
