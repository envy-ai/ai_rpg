# Initial Faction Standings

`InitialFactionStandings.js` owns strict parsing and atomic application of the player's generated starting reputation with every active faction.

During `POST /api/new-game`, faction drafts and newly generated factions are combined first. The player is then created and installed as the active player. Before starting-region or game-intro generation, `server.js` renders `prompts/initial-faction-standings.xml.njk` once for the complete active faction roster. A zero-faction game skips the prompt.

The prompt receives only the new player's class, race, and description plus public faction identity fields: exact id/name, descriptions, home-region label, tags, goals, and asset names. It does not receive faction violence, private relation notes, hidden information, or an invented player history. Positive standing is allowed when the supplied player concept plausibly implies membership or affinity.

The configured bounds are `factions.starting_reputation.min` and `factions.starting_reputation.max`, defaulting to `-80` and `20`. Both must be finite integers and `min` must be less than or equal to `max`. The same effective bounds are rendered into the prompt, enforced by the parser, shown in retry correction instructions, and checked again before application.

The response root is `<initialFactionStandings>`. It must contain exactly one direct `<standing>` child for every active faction and no non-whitespace direct text or CDATA. Each entry requires exactly one direct `<factionId>`, matching exact `<factionName>`, and integer `<reputation>`, with no other direct fields, text, or CDATA. Unknown ids, duplicate ids, mismatched names, missing factions, unexpected content, malformed XML, non-integers, and out-of-range values reject the whole response.

Structured failures use the configured parse-retry count. The rejected response and exact parser error are sent back in the retry conversation. Every attempt is logged with `LLMClient.logPrompt()` under `initial_faction_standings_generation`.

All entries are validated before mutation. Application merges the generated values into `Player.factionStandings` with one `setFactionStandings(...)` call. If a standing for an active faction already exists, it is preserved, so reusing the helper cannot reset established reputation. No starting-reputation field is stored on `Faction` or `SettingInfo`.

The same strict XML prompt and parser are model-independent. This setup phase has no alternate TinyBrain response language; effective model routing can use the metadata label while retaining identical validation and persistence behavior.

Focused coverage lives in `tests/initial_faction_standings.test.js` and `tests/server.initial_faction_standings.test.js`.
