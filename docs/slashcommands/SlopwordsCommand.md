# SlopwordsCommand

## Purpose
`/slopwords` reports slop words whose frequency in eligible assistant prose exceeds their configured ppm thresholds.

## Metadata
- Command name: `slopwords`
- Aliases: none
- Description: `Report slop words exceeding their configured ppm thresholds.`
- Usage: `/slopwords [default]`

## Arguments
- `default` (integer, optional): replaces the `default` ppm threshold from `defs/slopwords.yaml` for this run. Per-word numeric thresholds still take precedence over the default threshold.

## Behavior
- `execute()` requires `Globals.analyzeChatSlopwords` to be registered by `server.js`; missing registration throws `Slopword analysis is unavailable on this server.`
- The command passes `{ defaultPpmOverride }` to `Globals.analyzeChatSlopwords()`, using the optional `default` argument when present and `null` otherwise.
- Chat analysis reads the in-memory `chatHistory` and includes entries with `type === 'npc-action'`, plus assistant entries with no `type`.
- Empty chat history, missing eligible prose, invalid slopword definitions, or an invalid default override cause analysis to fail.
- Successful analysis returns an array of flagged words from `analyzeSlopwordsForText()`.
- Flagged words are sent as a comma-separated chat reply.
- A run with no flagged words replies `No slopwords exceed the configured thresholds.`
- Analysis failures are reported as an ephemeral reply: `Slopword analysis failed: ...`

## Notes
- The command checks word-level slop entries only. Configured ngrams and regex slop definitions use separate analyzer helpers in `server.js`.
- Active setting `customSlopWords` entries with a single token participate in word-level analysis at the resolved default threshold.
- If `Globals.analyzeChatSlopwords()` returns anything other than an array, the command throws `Slopword analysis returned an invalid result.`
