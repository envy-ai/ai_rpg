# Offline technique save repair

`scripts/rebalance-technique-save.js` prepares a reviewed ordinary-healing repair in a separate process. It does not connect to the running game, listen on a socket, call an LLM, cast a technique, or modify its source save. Obtain a current save through the ordinary save operation before preparing a repair.

Preview is the default:

```bash
node scripts/rebalance-technique-save.js \
  --save-dir /absolute/path/to/source-save \
  --actor-id char_2 --technique-id technique_1 --preview
```

The exact actor must own the exact catalogue technique. Both catalogue and personal revision pins default to `1`; explicit `--expect-definition-revision` and `--expect-personal-revision` select reviewed alternatives. The existing personal revision must contain one ordinary self/single healing effect. Recipe defaults select `Spellcasting`, `intelligence`, the `mana` profile and the existing healing effect ID. Override only through `--skill`, `--attribute`, `--resource-profile` and `--effect-id`. All selections receive the same authoritative recipe/compiler validation as normal authoring.

The JSON preview prints only the selected identities, old/new formulas and resolved healing/costs, operation ID and review guards. Mod initialization diagnostics go to stderr. It derives the actor's actual modified attributes and skills from isolated Player/Thing/Location hydration, with the exact saved enabled-mod manifest and installed-module/implant contributions. Current merged configuration includes the saved `gameConfigOverride.yaml`; optional `--config-override` and `--session-config-override` supply the same additional files used by the original runtime. Invalid files, unavailable resources, mod/config mismatches or missing current-format save data fail explicitly. This command does not migrate legacy saves.

To write, repeat the preview arguments with a distinct sibling `--output-dir` and all four reviewed guard values:

```bash
node scripts/rebalance-technique-save.js \
  --save-dir /absolute/path/to/source-save \
  --actor-id char_2 --technique-id technique_1 \
  --output-dir /absolute/path/to/source-save-balanced \
  --expect-definition-sha256 PREVIEW_DEFINITION_SHA256 \
  --expect-personal-sha256 PREVIEW_PERSONAL_SHA256 \
  --expect-policy-digest PREVIEW_POLICY_DIGEST \
  --expect-source-digest PREVIEW_SOURCE_DIGEST
```

The command rejects stale source bytes, catalogue/personal revisions, mechanics or policy and never overwrites an existing output. `TechniqueService.rebalance()` appends one catalogue revision, one selected owner's personal revision/history entry, and its ordinary receipt. Other owners and equipment remain pinned to their original revisions. Only that owner's raw learned entry, the selected catalogue definition, the appended receipt, and metadata `saveName` change. Other files retain their original bytes, including world time, health, need values, chat, configuration and existing receipts.

The entire source is copied to a staging directory, checked against the reviewed file manifest, patched, and validated with `TechniqueService.validateState()`. The source is checked again before the completed copy is atomically renamed into an exclusively reserved destination. A failed write retains staging for diagnosis and reports its path. Loading the copied save remains a separate explicit operation; this tool never selects it in the running server.
