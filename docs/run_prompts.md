# `run_prompts.js`

`scripts/run_prompts.js` renders a system prompt file and a user prompt file, then executes the rendered prompts through `LLMClient.chatCompletion()` one or more times in parallel. It is useful for prompt comparison, model/config checks, and collecting repeated completions outside a running game server.

`package.json` does not define an npm script for this helper; invoke it directly with Node.

## Usage

```bash
node scripts/run_prompts.js [--config <config file>] <systemprompt file> <prompt file> <repeat count> [xmlTag] [requiredRegex]
```

## Arguments

- `<systemprompt file>`: Path to the system prompt template file.
- `<prompt file>`: Path to the user prompt template file.
- `<repeat count>`: Positive integer number of parallel runs.
- `[xmlTag]`: Optional XML tag to extract from each response.
- `[requiredRegex]`: Optional response validation regex string passed through to `LLMClient.chatCompletion()`. `LLMClient` accepts either a plain pattern string or `/pattern/flags` syntax.

The CLI accepts exactly three to five positional arguments after option parsing. Unknown `--` options, duplicate `--config` options, missing files, empty prompt files, invalid config files, non-positive repeat counts, invalid XML tag names, and invalid regex patterns fail with an explicit error and a non-zero exit code.

## Config Resolution

- By default, the script loads `scripts/config.yaml`.
- Pass `--config <config file>` or `--config=<config file>` to override that path for a single run.
- Override paths are resolved relative to the current working directory, matching the prompt file arguments.
- The config file must parse as YAML, produce an object, and contain an `ai` block.
- The loaded config is assigned to `Globals.config`; `Globals.baseDir` is set to the project root. Normal `LLMClient` behavior such as backend selection, model overrides, streaming, prompt progress, forced outputs, and prompt-output character stats comes from that config.

## Template Rendering

- Both prompt files are rendered as Nunjucks templates before execution.
- The template context exposes `config`.
- The template loader searches the system prompt directory, the user prompt directory, and the current working directory, in that order.
- Templates can call `randomword()` to render a random non-empty line from `data/words.txt`.
- Rendering uses `autoescape: false` and `throwOnUndefined: false`.

## Response Validation And Extraction

- The script calls `LLMClient.chatCompletion()` with `metadataLabel: "run_prompts"`, `validateXML: false`, and `output: "stderr"`.
- If `[xmlTag]` is omitted, the default required regex is `/\S/`, so each response must contain non-whitespace text.
- If `[xmlTag]` is provided and `[requiredRegex]` is omitted, the default required regex requires a non-empty matching XML element such as `<tag>...</tag>`.
- If `[requiredRegex]` is provided, that regex string is passed to `LLMClient` instead of the default regex.
- When `[xmlTag]` is provided, all matching tag bodies are extracted from the response, trimmed, and joined with blank lines. A response without the tag fails the run.

The XML tag name may contain only letters, numbers, `:`, `_`, and `-`.

## Runs And Output

- The script starts `<repeat count>` prompt calls together with `Promise.all(...)`.
- `LLMClient` still applies its configured concurrency limits, retry handling, backend selection, streaming behavior, and prompt-progress target checks.
- The script makes at least one wrapper attempt for each run. When `config.ai.retryAttempts` is an integer, that value sets the wrapper attempt count; otherwise the wrapper attempts each run once.
- Successful run outputs are written to stdout in input order, separated by `---` lines.
- A trailing `Average prompt runtime: <ms> ms` line is written to stdout. The average is wall-clock elapsed time divided by repeat count.
- Prompt progress, prompt-log console messages, and errors from `LLMClient` are written to stderr because the helper passes `output: "stderr"`.

## Notes

- Each successful run calls `LLMClient.logPrompt()` with prefix `run_prompt` and metadata label `run_prompts`, writing logs under `logs/`.
- `config.default.yaml` includes a `prompt_progress.character_targets.run_prompts` entry for this metadata label.
- `docs/run_all_combinations.md` documents the GLM comparison helper that invokes `scripts/run_prompts.js` for multiple config/system-prompt pairs when that workspace exists under `tmp/`.
