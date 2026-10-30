# Strata VRAM handoff plan

Scope: add an optional Strata elastic expert-cache handoff to the existing
exclusive text/image lifecycle. Preserve existing llama.cpp router and managed
process contracts. Do not change the live root configuration, prompts, UI, or
running services.

Acceptance:

- Explicit `ai.image_generation_handoff: { provider: strata, min_free_vram_mib: 12288 }`
  selects Strata; absent/null preserves legacy configuration. The minimum is total
  free MiB, must be a positive integer, and defaults to 12288 when omitted.
- Validate configuration before startup or runtime reload applies it. Reject
  conflicting legacy modes, incompatible backends/image engines, malformed
  settings, and unknown providers without implicit alternatives.
- Drain text and image-prompt writing; verify the configured Strata model is
  loaded and elastic; request the GPU's total MiB as Strata's reserve goal to
  release as much cache as possible; admit ComfyUI only after actual free VRAM
  reaches the configured minimum. Never unload a model or terminate a process.
- Capture the effective target for the entire batch. Cleanup ComfyUI, then restore
  Strata's startup reserve with explicit JSON null, including failure/cancellation
  and a shrink request whose completion is uncertain. Preserve original errors.
- Keep RAM expert data and engine alive. Do not claim all disk reads disappear:
  the existing PLE mapping is currently not locked against reclaim.
- Supply a separate secret-free all-Strata profile retaining the current base's
  gameplay and image workflow settings. The optional profile is
  [`config.yaml.strata-davidau`](../config.yaml.strata-davidau).

Sequence: implement a pure shared handoff resolver/validator and Strata client;
extend the existing lifecycle and shared OpenAI authentication target builder;
wire server admission, cleanup, validation and reload; add the optional profile;
update focused documentation and its index.

Verification: syntax-check altered JavaScript and parse YAML. A separate test
agent owns focused client/config/lifecycle/gate/reload regression tests, under the
required memory-limited systemd scope. Live acceptance requires a separately
authorized game restart and a real ComfyUI batch; neither is part of this edit.

Risks: Strata must start with elastic VRAM enabled. The configured minimum can
exceed the elastic cache's capacity to yield; HTTP success alone is insufficient.
Restoration honors the startup reserve and need not refill every nominal slot.
New JavaScript requires a game restart; later configuration-only changes can use
the runtime reload command when its ComfyUI client is already initialized.
