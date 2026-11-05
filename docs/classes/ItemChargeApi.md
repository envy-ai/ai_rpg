# ItemChargeApi

`registerItemChargeApiRoutes(app,{getCurrentPlayer,assertCanMutate?})` registers current-player reload routes under the existing global game/mod mutation barrier.

`GET /api/things/:id/reload-options` returns `{success,actorId,itemId,chargePool,capacityAvailable,sources}`. Each compatible source contains `id,name,count,ammoType,amount`, where amount is the default available transfer. Targets must be owned inventory items or installed modules on owned equipment; loose ammunition sources must be directly in the actor inventory.

`POST /api/things/:id/reload` accepts `{ammoItemId,amount?,operationId}`. The operation ID is required and must remain stable across retries. Missing amount loads available capacity from that exact source; an explicitly excessive or fractional amount rejects. Success returns `{success,receipt,item,inventory}`. Replays return the committed receipt without consuming again. Failures return `{success:false,error,stack}` for the persistent client error modal. Unknown request fields reject; callers cannot select an arbitrary actor or substitute ammunition by name.
