# RegenFactionEmblemsCommand

`/regen_faction_emblems` queues forced emblem regeneration for every faction in
the active game's native `Faction.getAll()` registry. It takes no arguments and
does not include World Profile faction drafts.

The command calls the existing
`interaction.generateFactionImage(faction, { force: true, clientId })` helper
concurrently for the complete roster. The invoking client ID is trimmed or
passed as `null`. Native prompt generation, batching, force clearing, job
coalescing, client subscription, image dimensions and ellipse masking remain
owned by that helper. Already-running jobs are joined rather than replaced.
The reply reports submission results; it does not wait for finished image files.

An empty registry replies `No factions are available for emblem regeneration.`
If factions exist but the helper is missing, the command throws
`Faction image generation helper is unavailable in slash-command context.`

Successful invocation replies under `## Faction Emblem Regeneration` with each
nonempty group:

- `Queued emblems`
- `Joined existing emblem jobs`
- `Skipped emblems`, including the native reason when supplied

Native skips such as `disabled`, `no-client` or image-prompt generation failure
remain explicit skips. A skipped result takes precedence over a coalesced
`existingJob` flag when no job was produced. An unrecognized helper result
throws a faction-specific error. Actual helper exceptions propagate unchanged
through the existing slash-command error path, preserving the original stack;
other already-started generation requests are not rolled back.

The API supplies the helper through its normal slash interaction context, and
the command registry discovers `slashcommands/regen_faction_emblems.js` at
startup. Implementing this command does not execute it or generate live images.
