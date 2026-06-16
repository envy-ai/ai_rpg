# `run_all_combinations.js`

`tmp/glm-5.1_vs_glm-5/run_all_combinations.js` is a Node helper for the GLM prompt-comparison workspace. It enumerates config files and system-prompt files in its own directory, runs each pair through `scripts/run_prompts.js`, and writes aggregate output files for side-by-side review.

## Command

```bash
node tmp/glm-5.1_vs_glm-5/run_all_combinations.js
```

`package.json` does not define an npm script for this helper.

## Inputs

All inputs are read from `tmp/glm-5.1_vs_glm-5/`, the directory that contains the helper script:

- `prompt.txt`: required shared user-prompt template.
- `config*.yaml` or `config*.yml`: required config files, matched case-insensitively.
- `sysprompt*.txt`: required system-prompt template files, matched case-insensitively.

The script scans only files directly inside `tmp/glm-5.1_vs_glm-5/`. It does not recurse into comparison archive directories such as `run1/`, `run2/`, or `run3/`.

## Child Runs

For each config/system-prompt pair, the helper invokes:

```bash
node scripts/run_prompts.js --config <config file> <system prompt file> tmp/glm-5.1_vs_glm-5/prompt.txt 10
```

The child process runs with the project root as its working directory. `run_prompts.js` renders the system prompt and user prompt as Nunjucks templates with `config` in the template context, runs 10 prompt calls in parallel, writes prompt responses and the average runtime line to stdout, and sends prompt logs through `LLMClient.logPrompt()` with the `run_prompts` metadata label.

`run_all_combinations.js` captures the child stdout for the aggregate files. Child stderr is inherited, so progress, prompt logs, and errors appear in the caller's stderr stream rather than in the aggregate output files.

## Ordering

- Config files are processed in lexicographic filename order by basename.
- System prompt files are processed in lexicographic filename order by basename within each config.
- Section labels follow that deterministic order: `OUTPUT A`, `OUTPUT B`, ..., `OUTPUT Z`, `OUTPUT AA`, and so on.

## Outputs

- `tmp/glm-5.1_vs_glm-5/combined-output.txt`: contains one section per config/system-prompt pair. Each section starts with `OUTPUT <label>`, `Config: <basename>`, and `System Prompt: <basename>`, followed by the captured `run_prompts.js` stdout, including the trailing `Average prompt runtime:` line.
- `tmp/glm-5.1_vs_glm-5/combined-output-redacted.txt`: contains the same labeled sections without the `Config:` line, `System Prompt:` line, or trailing `Average prompt runtime:` line for each section. Prompt responses and `---` separators from `run_prompts.js` remain intact.

The output files are written after every combination completes successfully.

## Failure Behavior

The helper exits with status `1` and prints a clear error if:

- `scripts/run_prompts.js` is missing.
- `tmp/glm-5.1_vs_glm-5/prompt.txt` is missing.
- No matching config files are present.
- No matching system-prompt files are present.
- Any `run_prompts.js` child process exits non-zero or is terminated by a signal.

When a child run fails, the error includes the config basename, system-prompt basename, exit detail, and partial child stdout when stdout is available.
