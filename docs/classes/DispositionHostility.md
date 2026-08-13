# DispositionHostility

`DispositionHostility.js` owns the shared current-disposition hostility decision.

`isActorDispositionHostile(actor, target, dispositionDefinitions)` resolves the target id, examines every disposition definition with a finite `hostileThreshold`, and returns true when the actor's current value for any such type is less than or equal to that threshold. The persisted `actor.isHostile` flag is deliberately not an input. A missing target or self-target is non-hostile; malformed actor or definition contracts throw explicit errors.

The server uses this one classifier for:

- `NpcProfile.isHostileToPlayer`, which is the client/UI projection;
- barter-session hostility eligibility;
- combat NPC-list friendly/hostile slot pruning; and
- `hostile_to_friendly` reconciliation when disposition hostility exists even though the raw flag is false.

The raw `isHostile` field remains persisted for compatibility and initial hostile seeding. Creating or marking a raw-hostile NPC still initializes configured hostile disposition values. Ongoing player-relative eligibility, however, follows the current disposition map so a stale flag cannot disagree with the UI, commerce, or combat scheduler.

Regression coverage lives in `tests/disposition_hostility.test.js`, `tests/events.hostile_to_friendly.test.js`, and `tests/api.barter_party_members.test.js`. REL-6 also crosses the real configured `platonic` threshold through the API on a disposable fixture copy and verifies the client projection and barter rejection without any LLM prompt.
