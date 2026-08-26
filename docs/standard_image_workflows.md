# Standard ComfyUI Image Workflows

`imagegen/standard/` contains the canonical, application-owned ComfyUI API
workflows. It is deliberately separate from `imagegen/`: files in that root
remain selectable custom workflows, while standard templates are selected by
`imagegen.workflow.generation.family` or `imagegen.workflow.edit.family`.
Canonical Krea generation and batch templates contain their own neutral graphs
rather than including, aliasing, or retaining the baked style LoRAs and
half-resolution output stage from an old `test_*` custom template. Every Krea 2
graph uses `d/text_encoders/qwen3vl_4b_fp8_scaled.safetensors`; the legacy
Heretic Qwen3-VL encoder is not part of any canonical or custom Krea workflow.

## Supported families

Generation supports `krea2` (the default), `sdxl`, `flux_klein`, `zimage`,
`qwen`, `anima`, and `ideogram4`. Editing currently supports exactly `krea2`,
`flux_klein`, and `qwen`. Selecting another edit family throws an explicit
configuration/job error; it never substitutes Flux Klein for another model.

The Ideogram template uses its native conditional/unconditional model topology
and scheduler, rather than routing through Qwen. Qwen Image Edit uses the
model's dedicated image-conditioning nodes. Flux Klein uses the installed
Flux-specific graph. Those model-specific nodes are required by their model
families; the remaining family templates use core nodes where the architecture
allows it.

## Settings application

Templates establish their own valid topology and baseline model names. Once a
standard template renders, `StandardImageWorkflows.js` applies nonblank UI or
profile values to compatible model, text-encoder, VAE, sampler, scheduler,
steps, CFG, denoise, seed, and canvas nodes. The workflow panel's sampling
values and per-entity generation resolutions are authoritative; retired
per-entity image settings embedded in older configs cannot override them. This
post-render dictionary update avoids interpolating settings or prompts into raw
JSON. Selected LoRAs are chained immediately before sampling/guidance. The
canonical Krea graph contains no hidden style LoRAs and does not resize the
decoded image, so its output matches the selected resolution.
If a selected LoRA cannot be attached to a workflow safely, rendering fails
with a clear error instead of silently ignoring it.

Ideogram 4 is deliberately paired conditional/unconditional guidance, so its
single **Model** field must stay blank; replacing both sides with one selected
model would invalidate the graph. Its text-encoder and VAE fields can still be
set when a compatible alternative is installed.

The standard Flux Klein edit workflow exposes **Flux KV cache**, enabled by
default. Disabling it applies ComfyUI's ordinary pass-through-node bypass to
the per-request API graph: the cache node remains in the canonical workflow,
while that request connects its consumer directly to the cache node's model
input. The control is hidden for other edit families and custom workflows.

Standard editing preserves the source image's resolution. The editor
intentionally shows resolution controls only for generation; edit-setting
normalization and preset persistence remove stale `resolutions` fields. The
standard Krea 2, Flux Klein, and Qwen graphs run ComfyUI `GetImageSize` on the
loaded source and explicitly scale the decoded result to that width and height
before saving. Custom edit workflows remain responsible for their own
dimensions.

The standard Krea 2 edit graph uses the full
`d/krea2_identity_edit_v1_2.safetensors` release at its training strength of
`1.0`; that required adapter is part of the graph and does not appear in the
optional LoRA list. It applies `Krea2EditModelPatch` with `fit` geometry,
`ref_boost: 4`, the source VAE latent, and the source-sized target latent. Both
positive and empty-negative conditioning use `Krea2EditGroundedEncode` with
the source image and `grounding_px: 768`. Selected optional LoRAs are chained
after the required identity-edit patch. The supplied preset uses the Krea 2
Turbo model at 10 steps, CFG 1, Euler/simple, and full denoise; source images at
or below roughly two megapixels match the adapter author's recommendation.

A directly loadable ComfyUI UI graph is available at
`exports/krea2_identity_edit_v1_2_comfyui.json` for interactive testing. It is
filled with the installed AIRPG model paths, `example.png`, and a sample winter
season edit instruction. The optional second-reference group is bypassed by
default. This standalone graph retains the adapter author's one-megapixel
resolution selector, while the application-owned API workflow above preserves
the source image dimensions.

Named presets live in the standalone root `image-workflow-presets.yaml` store,
split into `generation` and `edit` mappings. **Load** applies one to the current
form, **Save** replaces the selected name, and **Save As** requests a bare
display name in a modal. Because this store is independent of `config.yaml` and
all CLI/session override files, every preset is visible under every runtime
configuration. Preset writes back up and replace only that shared store.

Custom workflow selection belongs to `imagegen.workflow.generation.custom_template`
or `imagegen.workflow.edit.custom_template`. A blank custom template uses the
selected standard family. Obsolete top-level `imagegen.api_template` and
`imagegen.location_variant_settings.api_template` values no longer participate
in workflow resolution and are removed on the next System Configuration save.
Likewise, a stale `api_template` copied into an already-created render job is
not permitted to bypass the currently selected global or per-world workflow.

## Editing and location variants

Location seasonal/weather variants are edit jobs and use
`imagegen.workflow.edit`, which defaults to Flux Klein. Selecting a custom edit
workflow in that mode applies it to those variants as well. Their model,
encoder, VAE, LoRAs, steps, CFG, sampler, scheduler, denoise, and applicable
Flux KV-cache selection all come from the effective edit profile (global or
per-world). The standard Flux Klein topology retains its native
`Flux2Scheduler`, whose node schema accepts steps and source dimensions rather
than generic scheduler or denoise inputs. The retired
`imagegen.location_variant_settings` sampling block is not overlaid on
seasonal jobs. The current root `config.yaml` selects the standard Krea 2
Identity Edit v1.2 profile for this experimental edit path; the shipped default
remains Flux Klein.

Standard templates are covered by `tests/standard_image_workflows.test.js` for
renderable JSON, family registry correctness, parameter application, and
LoRA-chain insertion, including the Flux KV-cache bypass topology. This is
structural validation; a model family still must be installed and exposed by
the running ComfyUI instance to render successfully.

## Prompt-list rendering

The canonical Krea 2 workflow has a matching list workflow and is selected
automatically when `imagegen.batch_prompts: true`. The other canonical families
do not currently expose equivalent list graphs. Enabling that flag for one of
them produces a clear configuration/job error instead of sending a prompt list
to a single-image workflow. A custom workflow remains responsible for declaring
its own list support.
