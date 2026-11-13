# `run_prosebench.js`

`scripts/run_prosebench.js` collects baseline, critic-prefixed and author-prefixed
responses through native `LLMClient.chatCompletion` and `logPrompt`, or accepts
an ordered custom variant set through `--variants JSON`. Existing
[run_prompts](run_prompts.md) renders Nunjucks inputs and starts repeats with
`Promise.all`; this benchmark instead needs exact raw inputs, grouped sequential
sampling, durable rejection records and explicit resume.

Prepare without contacting a model:

```bash
node scripts/run_prosebench.js --prepare-only
```

Defaults are `config.yaml.strata-davidau`, the SYSTEM section of
`logs/logs_prev/2026-11-12T19-26-23-978Z_event_checks_xml_event_checks.log`, and raw
`~/prose_bench_scenario.txt`. Preparation prints a new absolute
`prosebench/<UTC timestamp>/` directory. Override with `--config FILE`,
`--system-log FILE`, `--generation FILE`, `--output DIR`, or `--variants JSON`. `--repeat N` changes
the accepted target from ten and the per-variant attempt cap from thirty to
`3 * N`; normal requested collection uses the defaults.

Run or resume that exact directory under the required test/benchmark resource
wrapper:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p "User=$(id -un)" -p "Group=$(id -gn)" \
  -p "WorkingDirectory=$PWD" \
  "$(command -v node)" scripts/run_prosebench.js --run /absolute/path/to/prepared-directory
```

The service runs as your account so its result files remain user-owned. The
model must already be available. The runner never starts/restarts a model or
loads/saves a game. Its process-local client limits and awaited loop permit one
request at a time; unrelated game/server processes must be kept from issuing
prompts during collection if uninterrupted backend cache reuse is required.

## Inputs and sampling

The log's system section is extracted without GENERATION/RESPONSE sections;
only outer line breaks are removed. Generation bytes are copied unchanged and
never rendered as a template. Each request contains exactly one system and one
user message. System variants are independently formed from the baseline:

- Baseline: original extracted system.
- Critic: `For the duration of this session, do not engage your writing/roleplaying experts. Instead, engage your writing critic experts.` plus a blank line and baseline.
- Author: `You are "award-winning" fanfiction author XxDankBongwater69xX. Although your grammar, spelling, and punctuation are correct, your writing seems bad on the surface. However, due to a strong understanding of people and humor, it works well despite itself.` plus a blank line and baseline.

Custom variants use a nonempty JSON array of objects containing only `id` and
`prefix`. IDs must be unique lowercase filename-safe identifiers (letters,
digits, underscores and hyphens, beginning with a letter). Prefixes must be
strings; an empty string selects the unprefixed system. The exact authored text,
including punctuation, Unicode and typos, is retained. Each nonempty prefix is
independently followed by one blank line and the same original system; prefixes
never accumulate. The source JSON is copied into `originals/variants.json` and
hashed. Reports use the selected order and IDs rather than default labels.

```json
[
  {"id": "variant_one", "prefix": "Your exact first prefix."},
  {"id": "variant_two", "prefix": "Your exact second prefix."}
]
```

Order is all baseline attempts, then critic, then author by default, or the
custom array order when supplied. Each variant stops at
ten accepted responses or thirty attempts. Nonempty responses are accepted only
when exactly one ordered, complete, nonempty `<finalProse>...</finalProse>` block
can be extracted. Draft/analysis outside it is allowed. There is no prose-quality
rubric or semantic grading. Formatting rejects retain raw text and a reason;
they consume one attempt and do not enter the combined comparison. A thirty-
attempt shortfall is explicit and collection then proceeds to the next variant.

Automatic native transport/validation retries are zero: each runner invocation
of the client consumes one attempt. Transport/provider errors and empty replies
stop collection with available partial response/error details saved; explicit
`--run` resumes without regenerating accepted samples. An abruptly interrupted
invocation conservatively consumes its reserved attempt, since a crashed client
cannot establish whether the provider completed it. Native cancellation handles
SIGINT/SIGTERM. Forced-output/recording environment controls are rejected.

The current profile's seed omission is preserved, allowing independent provider
sampling rather than ten copies of a fixed seed. Temperature, top-p, configured
maxTokens, custom sampling arguments and native transport timeouts are retained.
Actual captured request JSON is authoritative for provider-visible settings;
for example, a standalone `ai.top_k` is retained in configuration metadata but
native LLMClient forwards provider-specific fields through `custom_args`.

## Isolation and artifacts

The runner copies only relevant text configuration, neutralizes automatic system
prefixes, model overrides, assistant prefill, append text, tools, cachebusters,
XML/live corrections, forced outputs and model lifecycle controls. It explicitly
opts this compatible local transport into `custom_args.return_progress: true`
so real prefill reports retain native idle-timeout liveness. A pre-transport
request callback checks exact prepared message strings and absence of tools or
a transmitted seed. No additional prompts, warmups or grading calls are sent.

`Globals.baseDir` points to the artifact directory, isolating native prompt logs,
audit files and character statistics from the game's normal logs. Artifacts:

- `originals/`: untouched generation/source-log/variant-definition copies, extracted baseline system, and the frozen runner source plus SHA-256 recorded before inference.
- `systems/`: the independently composed transmitted system texts.
- `manifest.json`: source/config hashes, original paths, order, prefixes, sampling policy and limits.
- `config.runtime.redacted.json`: relevant isolated settings, excluding unrelated image/game credentials. The original config is reread and hash-checked on resume; credentials are never copied into this snapshot.
- `results.json`: per-variant attempts, accepted/rejected/completed counts, extraction statuses, timestamps, hashes and errors.
- `responses/`: native request/response JSON, raw assistant content before native think-tag stripping, and extracted final prose when available. This is response content, not a wire-SSE dump.
- `logs/`: native logs, including every completion and rejected response.
- `index.md`: accepted prose grouped by variant, raw links, explicit shortfalls and rejected/failed-attempt links.

The transient `.run.lock` rejects simultaneous invocations. Resume removes only
a verified dead process's stale lock. Config/input hash changes fail instead of
mixing conditions. `/prosebench/` is ignored by git; this helper does no git work.

New preparations archive `originals/run_prosebench.executed.js` and record its
hash in the manifest. Execution verifies both the current runner and archived
source match that hash before contacting the model. Finish code changes before
preparation and keep the runner frozen throughout collection. To reuse a prior
scenario without touching the old run, pass its archived `originals/generation.txt`
and `originals/system-source.log` as the new preparation's input paths.
