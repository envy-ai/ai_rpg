# `run_prompts.js`

Helper script for rendering a system prompt and user prompt from files, then executing them through the configured LLM client multiple times in parallel.

## Usage

```bash
node scripts/run_prompts.js [--config <config file>] <systemprompt file> <prompt file> <repeat count> [xmlTag] [requiredRegex]
```

## Arguments

- `<systemprompt file>`: Path to the system prompt template file.
- `<prompt file>`: Path to the user prompt template file.
- `<repeat count>`: Positive integer number of parallel runs.
- `[xmlTag]`: Optional XML tag to extract from each response.
- `[requiredRegex]`: Optional response validation regex string passed through to `LLMClient.chatCompletion`.

## Config Resolution

- By default, the script loads `scripts/config.yaml`.
- Pass `--config <config file>` or `--config=<config file>` to override that path for a single run.
- Override paths are resolved relative to the current working directory, matching the prompt file arguments.

## Notes

- Prompt files are rendered as Nunjucks templates before execution.
- The rendered template context currently exposes `config`.
- Responses are logged through `LLMClient.logPrompt()` with the `run_prompts` metadata label.
