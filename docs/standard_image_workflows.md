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

Generation supports `krea2` (the default), `moss`, `moss_full_turbo`, `sdxl`, `flux_klein`, `zimage`,
`qwen`, `qwen21`, `anima`, and `ideogram4`. Editing currently supports exactly `krea2`,
`flux_klein`, `qwen`, `qwen21`, and `qwen21_skimmed`. Selecting another edit family throws an explicit
configuration/job error; it never substitutes Flux Klein for another model.

The Ideogram template uses its native conditional/unconditional model topology
and scheduler, rather than routing through Qwen. Qwen Image Edit uses the
model's dedicated image-conditioning nodes. Flux Klein uses the installed
Flux-specific graph. Those model-specific nodes are required by their model
families; the remaining family templates use core nodes where the architecture
allows it.

**Standard: MOSS Image** (`moss`) has single-image and prompt-list generation
templates based on the ordinary Krea generation graph. Its defaults are
`d/kromoss_int8_convrot.safetensors`,
`d/qwen3.5_9b_ultra_uncensored_heretic_int8_convrot.safetensors` with encoder
type `moss_image`, and `d/flux2-vae_small.safetensors`. It uses core
`VAELoader` and `VAEDecode` nodes and `EmptyFlux2LatentImage` for MOSS's Flux 2
latent format. This avoids the older VAE Utils loader's decoder-channel
assumptions, which reject the small Flux 2 VAE. The graph retains zeroed
negative conditioning, ordinary KSampler settings, prompt logging, metadata
saving, and optional selected LoRA insertion. Model, encoder/type, VAE,
sampling, and resolution controls apply through the standard settings path.
No optional LoRAs are baked into the graph. MOSS editing is not registered.

**Standard: MOSS Full Turbo** (`moss_full_turbo`) is a separate single-image
and prompt-list family adapted from MOSS Simplified Full Turbo. It uses the
same MOSS model, encoder/type, core VAE nodes, and Flux 2 latent as `moss`.
Its required `d/kromoss-8-steps-dmd2-lora.safetensors` adapter runs at strength
`1`, followed by the enabled `Skimmed CFG - linear interpolation dual scales`
model patch with positive and negative scales both `1.5`. Its baseline sampler
uses 8 steps, CFG `35`, `dpmpp_2m_fixed`, `simple`, and denoise `1`.
Negative conditioning is encoded from the application's negative prompt,
including each image's own negative prompt in a batch; an empty negative
prompt is encoded as empty text. Optional selected style LoRAs run in table
order before the required turbo adapter and skim patch. The template marks the
turbo node's model input with `_meta.airpg_selected_loras_before: true` for
this insertion point. No style is baked in, and the **MOSS Full Turbo** preset
starts with `loras: []` because the turbo adapter is already required by the
graph. Load that preset to apply its full settings: selecting the family alone
retains the editor's existing sampling/model values, which remain authoritative.
The original `moss` family and its presets remain available unchanged. This
family does not add editing, a second sampling pass, or source prompt generation.
ComfyUI must have the turbo adapter, skim node, and sampler installed.

Qwen Image 2.1 (`qwen21`) has separate generation and edit graphs adapted from
`Qwen 2.1 Edit Simplified.json`. Both retain the source Qwenvy 2.1 model,
Qwen3-VL Heretic encoder, Qwen Image 2.1 VAE, and built-in
`qwen2.1/qwen2.1-anime-classic-flat.safetensors` LoRA at strength 1. Their
named **Qwen Image 2.1** generation and **Qwen Image 2.1 Edit** presets use
20 steps, CFG 3.5, `dpmpp_2m_sharp`, and `bong_tangent`; the optional LoRA
list starts empty so it does not duplicate the built-in adapter; selected extra
LoRAs chain after it. The shared
`TextEncodeQwenImage21` node receives the application's prompt and negative
prompt, with the source's conditioning resolution of 1376. Generation omits
all source-image inputs and samples an `EmptyLatentImage` sized from the
selected entity resolution. Editing conditions on the uploaded source image,
uses its dimensions for the empty latent, and scales the decoded output back
to those exact dimensions. Both save with static `airpg/qwen21-*` prefixes.
The Qwen 2.1 node, model assets, sampler, and scheduler must be installed in
ComfyUI; the graph does not substitute another model or encoder.

**Standard: Qwen Image 2.1 Edit Skimmed CFG** (`qwen21_skimmed`) is a separate
edit-only graph and named preset. It retains the ordinary Qwen Image 2.1 edit
model, required classic-flat LoRA, source-image conditioning and output
dimensions. The regular `Skimmed CFG` model patch runs after that required LoRA
and before the sampler, with `Skimming_CFG: 4`, `full_skim_negative: false`,
and `disable_flipping_filter: false`. Selected optional LoRAs run after the
required style LoRA and before the skim patch, using the skim node's explicit
`_meta.airpg_selected_loras_before` insertion point. Sampler CFG is
`35`; the skim scale is a separate setting. Load the **Qwen Image 2.1 Edit
Skimmed CFG** preset for the existing 20-step `dpmpp_2m_sharp`/`bong_tangent`
settings, because explicit editor settings remain authoritative. The original
`qwen21` workflows and presets retain their behavior. ComfyUI must have the
regular `Skimmed CFG` node installed. This edit family has no generation or
prompt-list batch workflow.

## Settings application

Model, text encoder, text encoder type, VAE, sampler, and scheduler use the
shared [SearchableSelect](classes/SearchableSelect.md) widget's native
single-selection dropdown, with a separate search field. Search matches all
space-separated substrings case insensitively, in any order, and does not
change the selected value. Optional LoRAs use an ordered table with a filename,
numeric **Strength**, and **Remove** button per row. The **Add LoRA** control
composes that same native single-choice selector and search with an explicit
**Add LoRA** button. Already-selected names are excluded from its choices;
new rows start at strength `1`. Adding focuses/selects the new strength, removing
returns focus to a neighboring row (or the add search for the last row), and
ordinary Tab/Enter/native dropdown keys work throughout. Enter in the add search
adds its selected LoRA without submitting the surrounding form. Status messages
announce additions and removals. The table uses the shared `Repeater` lifecycle,
and strength fields use `createField`; no parallel selector or row widget is
implemented. The full-width table wraps long filenames, and its add controls
stack on narrow screens.
Sampler, scheduler, and encoder-type choices come from ComfyUI's live node
schemas through `GET /api/comfyui/workflow-options`; they are not a fixed list
in the form.

Templates establish their own valid topology and baseline model names. Once a
standard template renders, `StandardImageWorkflows.js` applies nonblank UI or
profile values to compatible model, text-encoder, VAE, sampler, scheduler,
steps, CFG, denoise, seed, and canvas nodes. The workflow panel's sampling
values and per-entity generation resolutions are authoritative; retired
per-entity image settings embedded in older configs cannot override them. This
post-render dictionary update avoids interpolating settings or prompts into raw
JSON. Selected LoRAs are chained in table order immediately before
sampling/guidance, or at a template's explicit insertion point, with each row's
strength passed to `strength_model`. The
canonical Krea graph contains no hidden style LoRAs and does not resize the
decoded image, so its output matches the selected resolution.
If a selected LoRA cannot be attached to a workflow safely, rendering fails
with a clear error instead of silently ignoring it.

The shared Generate/Edit settings editor reconciles optional LoRA selections
against the successfully loaded live ComfyUI LoRA list. LoRAs absent from that
list are removed from the form's workflow JSON, so saving System Configuration,
a World Profile, or a preset removes those unavailable selections. Loading a
profile or preset applies the same reconciliation. Filtering the searchable
list does not remove valid selections. A failed or malformed options response
does not establish availability and leaves stored LoRAs intact; a successful
empty list clears all optional selections. This does not change required LoRAs
embedded in a standard or custom workflow template.

Workflow settings and presets persist optional adapters as
`loras: [{ name: "styles/example.safetensors", strength: 0.75 }]`. Existing
saved string entries remain supported at strength `1` and become explicit
name/strength rows in the editor. Strengths must be finite numbers; `0`, negative
values, and values above `1` are preserved without clamping. Blank or invalid
strength fields block form and preset saves. Preset writes and standard rendering
reject malformed entries with their field path and correction guidance.
The standard post-render LoRA insertion does not run for custom templates;
custom workflows remain responsible for consuming the supplied settings.

`text_encoder_type` is an optional workflow-profile string, persisted with
generation/edit settings and presets. Blank means to retain the graph's own
loader type. An explicit value becomes `image.textEncoderType` in template
data and overrides `inputs.type` on `CLIPLoader`, `CLIPLoaderGGUF`,
`DualCLIPLoader`, and `DualCLIPLoaderGGUF` nodes after JSON parsing, for both
standard and custom workflows, including prompt-list batches. Encoder names
and graph connections are preserved. A graph without one of those loaders
raises an explicit error for a nonblank type override; for example, the SDXL
standard graph's checkpoint-owned encoder requires leaving this field blank.
Choosing a type still requires a compatible encoder file and model family.

Advanced samplers receive the selected seed through `noise_seed`, rather than
the ordinary `KSampler`'s `seed` input. Qwen 2.1 retains the source
`KSamplerAdvanced` full-sampling step range (`start_at_step: 0`,
`end_at_step: 10000`); the generic **Denoise** setting does not apply to this
node, which has no `denoise` input.

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
standard Krea 2, Flux Klein, Qwen, and both Qwen 2.1 edit graphs run ComfyUI `GetImageSize` on the
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

When vision is available, the base-context `generate-seasonal-image-vision`
prompt inspects the attached base location image and writes the edit instructions
for the current season, weather, and lighting. An `N/A` response reuses the base
image without running an edit workflow. Without vision, the existing deterministic
location-variant templates supply the instructions. See
[configuration](config.md#location-weatherlighting-image-variants) for model
routing and caching behavior.

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
`tests/e2e/image-workflow-loras.spec.js` exercises the real shared editor and
selector with mocked live options, covering form serialization, preset saves,
profile updates, native dropdown and multi-term search behavior, empty lists,
and failed/invalid discovery. Encoder-type application and blank defaults are
also covered by the standard-workflow tests.

## Prompt-list rendering

The canonical Krea 2, MOSS Image, and MOSS Full Turbo workflows have matching list workflows,
selected automatically when `imagegen.batch_prompts: true`. The other canonical families
do not currently expose equivalent list graphs. Enabling that flag for one of
them produces a clear configuration/job error instead of sending a prompt list
to a single-image workflow. A custom workflow remains responsible for declaring
its own list support.

Standard settings preserve linked sampler seed inputs, so a batch's seed list
keeps each image's own seed instead of being replaced by the first image's
scalar seed. Single-image scalar seeds still receive the selected value.
