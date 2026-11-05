# ItemChargeService

Implementation scope: one optional durable pool per individual Thing, discrete ammunition or continuous decimal charge. Loose ammunition uses a normalized exact `ammoType` key and stack count. Depleted equipment remains intact. Existing saves without these fields retain no charge resource.

Implementation sequence: validate pools and exact decimal arithmetic; preserve Thing state and prohibit charged stacks; omit live amounts from catalogue templates while retaining declared fresh-spawn initial amounts; add transactional, selected-source spend/reload/adjust services and durable idempotent receipts; expose XML, generation, API and prompt context; verify syntax and focused tests.

Acceptance gates: reject negative/nonfinite/fractional discrete/over-capacity values without clamping; never guess ammunition compatibility or substitute sources; preserve zero and charge on copy/save; recheck ownership, world epoch and selected state before commit; rollback failures and replay committed operation IDs once. Reload moves loose-ammunition quantity into compatible discrete pools, using available capacity by default and rejecting explicit overfill. Continuous charge adjustments are checked and explicit, without timed recharge or automatic fuel conversion.

## Public operations

- `assertOwned(actor,itemId)` returns the exact owned Thing, including installed modules whose parent and child links prove ownership. No substitute source is selected.
- `preflightSpend({actor,itemId,amount,operationId?})` captures item identity, pool and world epoch without mutation. `assertCurrent(plan)` rechecks epoch, ownership and unchanged pool. `commitSpend(plan)` applies it; without operationId it leaves receipt ownership to an enclosing technique/attack transaction. `spend(options)` provides standalone receipt replay.
- `reload({actor,itemId,ammoItemId,amount?,operationId})` transfers compatible loose-ammunition count. Omitted amount loads the smaller of capacity available and this source count; explicit excess rejects. It snapshots source registry membership and ownership, restores target/source/ledger on failure, and reports incomplete restoration with original causes. A fully consumed source is deleted through the native Thing lifecycle.
- `adjust({actor,itemId,amount,operationId})` sets a checked absolute charge amount. It does not consume ammunition or implement automatic recharge.
- `getReloadOptions({actor,itemId})` lists eligible directly held compatible loose ammunition and default transfer amounts.
- `getOperationRecord(operationId)` reads a detached saved request/result. `getOperation(operationId,request)` returns the full prior result only for the same request. `recordOperation({operationId,request,result})` validates and records the complete result. Charged ordinary attacks store complete outcomes here; techniques retain their existing enclosing receipt transaction.
- `toJSON()`/`serialize()`, `hydrate()`/`restore()`, `validateState()`, `snapshot()`/`restoreSnapshot()` manage the version-1 ledger. `clear()` invalidates prepared plans by advancing `epoch`. Receipt references may name intentionally destroyed historical items/actors, but their schema and exact payment identity remain validated.

The ledger is saved as `itemCharges.json`; legacy absence means empty state while malformed existing data rejects. No polling, delayed replenishment, detachable magazines, crafting recipes or automatic transfers are implemented.
