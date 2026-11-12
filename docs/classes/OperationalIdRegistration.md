# OperationalIdRegistration

`registerOperationalIds(snapshot)` reserves supplied sequential IDs at the native hydration boundary. It examines explicit operational namespaces in known identity/reference fields and exact map keys. It never infers a category from arbitrary prose or a name such as `thing_gold_coin_2`. Existing domain `register`/`seedCounters` reserve only exact numeric domain prefixes, while name-derived domain behavior stays unchanged.

Hydration discards unused process-local operational ranges, reserves incoming operational identities, then performs the existing domain reset/seed/hydration sequence. The durable installation store is never reset by loading an older save. UUID/custom historical IDs remain untouched. Story library reads validate/register their own new sequential identities separately. See [OperationalIdAllocator](OperationalIdAllocator.md).
