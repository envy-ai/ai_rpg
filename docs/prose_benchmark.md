# Aggregate Prose Benchmark

The aggregate prose benchmark repeats one exact player action from one immutable saved-game snapshot. It is for side-by-side human comparison of narrative output across checkpoints and prompting modes. By default it does not grade prose, inspect error logs, or impose mechanical assertions. An attempt either captures the final player-facing prose returned by `/api/chat`, or records that no final prose was produced.

An optional, independent semantic-judging stage can send captured responses to the Codex CLI bridge using a data-driven rubric. Codex judgments are review aids: they do not alter whether an attempt successfully produced prose, and they do not introduce regular expressions, keyword checks, or generation-time prompt restrictions.

## Command

```bash
npm run benchmark:prose -- \
  --checkpoint "Qwen3.6-27B-Fable-Fusion-711-Uncensored-Heretic-NM-DAU-NEO-MAX-MTP-GGUF" \
  --save latest-manual \
  --input 'I sit beside Lina and ask her out for a drink.' \
  --tries 10 \
  --tinybrain true \
  --halt-after-player-action true
```

To run the same benchmark and judge its captured prose afterward:

```bash
npm run benchmark:prose -- \
  --checkpoint "Qwen3.6-27B-Fable-Fusion-711-Uncensored-Heretic-NM-DAU-NEO-MAX-MTP-GGUF" \
  --save latest-manual \
  --input-file tmp/lamia-shoes-prose-benchmark-input.txt \
  --tries 10 \
  --tinybrain true \
  --halt-after-player-action true \
  --judge-criteria benchmarks/prose/lamia-shoes.criteria.json
```

`--model` is an alias for `--checkpoint`. `--save` accepts `latest-manual`, a save directory path, or an exact directory name under `saves/` or `autosaves/`. Use `--input-file` instead of `--input` for long text or shell-sensitive quoting. `--tinybrain false` runs the standard monolithic prompts. `--halt-after-player-action true` ends `/api/chat` as soon as the final cleaned player prose and mechanics resolved directly by that prompt have been committed. It skips chat summarization, event/need/quest checks, plot and maintenance prompts, corpse processing, NPC turns, random events, tonal evaluation, and turn finalization. The default is `false`, which retains the complete ordinary turn. Other generation options include `--base-override`, `--endpoint`, `--port`, `--turn-timeout`, `--run-id`, and `--output`.

`--judge-criteria <json>` enables the post-generation Codex stage. `--judge-model` defaults to `gpt-5.6-terra`; `--judge-batch-size` defaults to 10 responses per bridge call; `--judge-timeout` defaults to 600 seconds; `--judge-reasoning-effort` defaults to `medium`; and `--judge-codex-home` defaults to `CODEX_HOME` or `~/.codex`. Each bridge request uses a fresh ephemeral Codex thread, read-only sandboxing, and an isolated cwd inside the run's `judging/` directory. The prompt and response are logged by the normal Codex bridge logging path under that isolated directory.

## Judging an existing run

Completed and partially judged runs can be processed without repeating generation:

```bash
npm run benchmark:prose:judge -- \
  --run mizuchi-shoes-20260813T222631Z-G4-MeroMero-31B-uncensored-heretic-GGUF-tinybrain-player-action-only \
  --criteria benchmarks/prose/lamia-shoes.criteria.json
```

`--run` accepts a directory or an exact run id under `benchmarks/prose/runs/`. The command skips responses already judged with the same rubric hash, model, and judge-prompt version. `--force true` explicitly replaces prior judgments when changing one of those inputs. A malformed Codex response, missing criterion, invalid verdict, or bridge failure is recorded as a visible judging error and terminates the judging command; completed batches remain resumable.

Rubrics contain scenario facts plus independent criteria with `pass`, `fail`, and `unclear` guidance. The bundled `benchmarks/prose/lamia-shoes.criteria.json` checks three independent qualities:

1. The response understands that the visibly serpentine lamia has no feet and does not wear shoes.
2. The lamia recognizes that Baato knows this and is making a knowingly absurd, teasing/flirtatious remark rather than an innocent mistake.
3. Because they have barely met, she rejects or defers the unexpected invitation, establishes a boundary or condition, or accepts with meaningful skepticism instead of accepting uncritically.

The judge is instructed to accept implications, deadpan delivery, physical reactions, and other natural evidence. It may not require special keywords or count facts present only in the player input as evidence. Every criterion records a `pass`, `fail`, or `unclear` verdict, confidence level, short rationale, and supporting excerpt when one exists.

The default game-server port is `7778`, allowing the normal game server to remain on `7777`. Every root and prompt-specific model route is pinned to the selected checkpoint. For local-router profiles, the configured llama.cpp router must already be reachable and the checkpoint is preloaded through it; managed local-router startup remains disabled. Image generation plus both ComfyUI/llama image-handoff modes are disabled for every benchmark attempt, so prose comparison does not render images, unload ComfyUI models, or disturb ComfyUI's in-memory cache.

Remote profiles are also supported. When the selected base profile has no local startup script (or `--endpoint` explicitly replaces it), the generated benchmark configuration leaves `router_preload_model` blank and sends completions directly to that profile's endpoint. For example, `--base-override config.yaml.nanogpt.glm51 --checkpoint zai-org/glm-5.1 --tinybrain false` uses NanoGPT and does not contact or start local llama.cpp.

`scripts/run_gemma_prose_benchmarks.sh` runs the retained Mizuchi shop-exterior player-action-only comparison sequentially against the five Gemma 4 31B model IDs and the Gemma 4 26B A4B model advertised by the qwen-combo router on 2026-08-13. Each model receives ten attempts by default. Set `TRIES` or `PORT` in the environment to override those two batch defaults. `START_AT=<exact-model-id>` resumes with a selected model after an earlier fail-fast batch exit; `BATCH_STAMP` can supply a distinct stable run-name prefix. The script stops on the first failed benchmark instead of silently skipping a model.

## Isolation and artifacts

Before attempt 1, the runner copies the complete selected source save to `source-save/` inside the run directory and writes `source-save-manifest.json` with a SHA-256 hash and byte count for every file. Every attempt starts from a new disposable copy of that retained snapshot. If a save contains its own game configuration override, the disposable copy retains it but pins checkpoint, prompt routes, TinyBrain mode, and image-generation settings to the benchmark selection. Neither the original save nor the retained snapshot is loaded mutably.

After every attempt, the runner invokes the normal save API and copies the resulting complete, loadable save to that attempt's `final-save/`. The API-created manual save is also left under `saves/`. This avoids deleting or moving a game save after creation and records its original path in the result.

The default run directory is `benchmarks/prose/runs/<timestamp>-<checkpoint>-<mode>/` and contains:

- `source-save/` and `source-save-manifest.json`: the exact reusable starting point;
- `config.override.yaml`: the generated model/mode-pinned configuration;
- `attempts/attempt-N/`: request, raw load/chat/save responses, result metadata, and complete final save;
- `dialogue/attempt-N.txt`: extracted final prose, or an explicit no-final-prose indication;
- `all-final-dialogue.md`: every result in one readable text document;
- `results.json`: aggregate machine-readable results;
- `airpg-prosebench-<checkpoint>-<mode>.html`: the human comparison dashboard, including optional rubric totals and per-response Codex judgments;
- `judging/criteria.json`, `judging/batch-N.json`, and `judging/codex-cwd/logs/`: the exact rubric, parsed/raw batch results, usage, and ordinary Codex bridge prompt logs when judging is enabled;
- `server-logs/game-server.log`: the managed benchmark server output.

The runner refreshes JSON, Markdown, and HTML after every generation attempt and every completed judge batch, preserving partial results if interrupted. It does not alter the ordinary full-system model benchmark or its grading rules.
