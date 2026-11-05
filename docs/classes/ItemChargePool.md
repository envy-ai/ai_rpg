# ItemChargePool

Shared pool validation and XML helpers. `normalizePool(value,{count=1,path='chargePool',template=false})` validates mode, current amount, capacity, unit and optional initialAmount/ammoType/costPerUse. Missing/null pool means no resource; an empty object is invalid. Optional blank scalars are omitted consistently; explicit zero is retained. Discrete values are safe integers. Negative, nonfinite and over-capacity amounts reject without clamping. Template mode prohibits current amount.

`normalizeAmmoType(value)` trims, normalizes NFC and lowercases an exact compatibility key. `validatePayment(pool,amount,path)` validates payment type and discrete integer rules. `add(a,b)`/`subtract(a,b)` perform decimal-spelling arithmetic at a common BigInt scale before returning a finite number, avoiding ordinary binary subtraction residue for charges such as 0.3 minus 0.1 three times.

`templateFrom(pool)` removes current amount; `materialize(template)` requires declared initialAmount and returns a validated fresh pool. `parseXml(parent)` parses optional direct `<chargePool>` and `<ammoType>` elements, rejects duplicate or nested scalar fields, and shares normalization with all standard/TinyBrain item XML paths.
