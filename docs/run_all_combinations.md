# `run_all_combinations.js`

Helper script for the `tmp/glm-5.1_vs_glm-5` prompt-comparison workspace. It runs every config and system-prompt combination through `scripts/run_prompts.js`, then writes combined output files with sequential `OUTPUT A`, `OUTPUT B`, `OUTPUT C`, ... headings.

## Location

- `tmp/glm-5.1_vs_glm-5/run_all_combinations.js`

## Behavior

- Discovers every `config*.yaml` or `config*.yml` file in `tmp/glm-5.1_vs_glm-5`.
- Discovers every `sysprompt*.txt` file in `tmp/glm-5.1_vs_glm-5`.
- Uses `tmp/glm-5.1_vs_glm-5/prompt.txt` as the shared prompt file.
- Runs `scripts/run_prompts.js` once per config/system-prompt pair with repeat count `10`.
- Writes the combined stdout from all runs to `tmp/glm-5.1_vs_glm-5/combined-output.txt`.
- Writes a redacted variant to `tmp/glm-5.1_vs_glm-5/combined-output-redacted.txt` with the same `OUTPUT` sections but without the `Config:` and `System Prompt:` lines or the trailing `Average prompt runtime:` line from each section.
- Fails immediately if any required file is missing or any child run exits non-zero.

## Ordering

- Config files are processed in lexicographic filename order.
- System prompt files are processed in lexicographic filename order within each config.
- Output headings are assigned in that deterministic order.
