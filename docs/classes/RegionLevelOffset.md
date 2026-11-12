# RegionLevelOffset

`parseRegionLevelOffsetResponse(response)` validates the shared region-difficulty
selection response. It accepts exactly one `<regionLevelOffset>` scalar containing
an integer from `1` through `4`. Blank/self-closing values, fractions, attributes,
nested elements, multiple roots and surrounding prose are rejected with field
and correction guidance. The wrapper preserves the whole response for strict
validation rather than extracting only its first XML root.

`server.js`'s `requestRegionLevelOffset(...)` renders
`prompts/region-level-offset.xml.njk` with the new region description and a
captured source-region average/name/description. It uses the native completion
and parser-retry helpers, logs every attempt under `region_level_offset`, disables
tools and inner XML correction, and uses the configured retry budget. No explicit
token limit is supplied. Calls inside standard or TinyBrain owned work inherit
the existing queue reservation.

The shared `createRegionStubFromEvent(...)` path requests an offset only when a
region is genuinely new and its caller omitted the offset. This covers travel,
discovered exits, offscreen NPC/thing destinations, tools and manual exit creation
without adding another field to every prose/event response. Existing live or
pending targets are reused without another offset request. Explicit supplied
offsets, including intentional `0` for huge vehicles, retain their native
semantics. There is no invented positive offset when selection fails.

New pending records store `regionAverageLevel` as their source-level anchor and
`relativeLevel` as the chosen offset. Expansion computes the final regional
average from that anchor plus the offset once; the doorway's already computed
base level is not incremented again. Sibling doorways copy the canonical pending
record/entrance's known anchor and offset, even when approached from a different
level region. Historical pending records without the anchor retain their saved
entrance-metadata/player-reference behavior. Existing regions and saves are not
retuned by this change.

The source snapshot is captured before selection. Native runtime-generation and
origin-identity checks reject stale results after an awaited selection, and
concurrent target creation re-enters the native reuse checks before publishing a
new stub.

Direct `generateRegionFromPrompt(...)` also selects an offset when it has a
source region and no explicit average. It assigns the computed average before
constructing the Region or instantiating child locations; the layout XML's
placeholder region-level `relativeLevel` is not the authoritative average.
Starting-world callers explicitly supply `averageLevel: 1`; an origin-free
generator likewise starts at `1`. Explicit positive-integer `averageLevel`
remains available to native callers. Location and NPC relative levels remain
separate offsets from their regional/location bases.

Native direct-generator callers may also supply an integer `relativeLevel`
with a recorded `originLocation`/current source region; explicit `0` bypasses
selection without increasing the average. A supplied absolute `averageLevel`
takes precedence. Blank optional offsets are omitted; populated noninteger
offsets fail explicitly. These native options are not new public route fields.

