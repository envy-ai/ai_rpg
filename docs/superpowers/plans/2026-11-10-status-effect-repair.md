# Complete NPC alteration effects and explicit repair

## Requested behavior

NPC alteration must author and persist complete status effects. Add
`/repair_status_effects` to inspect existing character effects with incomplete
fields or description-only mechanics using full base context. Standard mode
requests at most ten candidates per completion; TinyBrain asks for one candidate
at a time in a single shared program and conversation.

The user approved removing proven empty intrinsic copies of an existing ability
effect and repairing the owning ability effect instead of applying its bonus
twice. A valid effect may legitimately have no numeric modifiers.

## Implementation order

1. Reuse native typed XML parsing and StatusEffect/Technique validation in a
   shared complete status XML boundary. Preserve existing identities, clocks,
   grant references and provenance; validate populated fields with actionable
   field paths. Empty optional scalars are omitted consistently; zero values and
   meaningful empty containers retain their contracts.
2. Supply only intrinsic effects as writable alteration state. Keep derived
   ability, equipment and mod effects as context rather than intrinsic output.
   Carry all authored mechanics through parsing, application and serialization.
3. Scan canonical character intrinsic effects and owned ability templates once.
   Review description-only candidates without forcing invented modifiers.
   Remove only unambiguous empty intrinsic duplicates with matching description
   and duration and no independent mechanics or provenance.
4. Render the repair through base context. Use native completion validation and
   logging for standard batches; use local parser correction checkpoints, one
   queue reservation and one conversation for the TinyBrain program. Known
   candidate identities remain server-owned.
5. Validate owner-specific rules before mutation, reject stale source snapshots,
   and commit accepted repairs with rollback of both effect lists and health.
   Normal saves persist the canonical repaired state. Report inspected,
   repaired, unchanged and removed-duplicate counts through the slash command.
6. Add focused parser, alteration, scanner, transaction, command and prompt-runner
   regressions. Update focused class/command documentation and docs/README.md.

## Acceptance checks

- Altering appearance cannot copy an ability, equipped-item or implant effect
  into intrinsic statuses or erase a retained effect's mechanics.
- Existing status/ability IDs, applied-at timestamps, technique grant pins and
  provenance survive. Ability effects remain permanent and cannot gain
  unsupported per-minute need deltas.
- Standard batching handles 21 candidates as 10, 10 and 1; TinyBrain handles
  candidates in one transcript with one candidate per checkpoint. Invalid XML
  or populated values are corrected before application; cancellation and fatal
  errors propagate without fallback or replay of accepted mutations.
- Legitimate empty effects and explicit numeric zeros remain valid. Ambiguous
  duplicate matches and independently sourced effects are not removed.
- Failed validation, stale state or a setter failure cannot leave partial actor
  changes or changed health. Tests use isolated state under the required 16 GB
  systemd memory limit.

## Runtime boundary

This work creates the command and fixes future alteration. Do not run repairs on
the user's live game or restart the server without a separate instruction.

## Completed verification

The implementation passed 24 focused parser, repair, batching, slash-command
and error-boundary tests, plus 47 relevant existing checks. The two existing NPC
parser checks were repeated against the final parser changes; unaffected passes
were retained. An isolated Chromium check submitted the new command through the
composer and verified a single persistent error dialog with the original server
backtrace. All changed JavaScript and five prompt templates passed syntax checks.
No repair was run against the live game during implementation.
