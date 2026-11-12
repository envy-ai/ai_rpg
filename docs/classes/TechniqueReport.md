# TechniqueReport

`projectTechniqueReceiptReport(receipt)` returns a detached presentation copy. Successful damage/healing amounts, deltas and displayed final calculations are rounded to the nearest integer. `reportedTotals.damage`, `healing` and `healthDelta` each round their exact aggregate once, so two effects of 0.4 report total 1. Re-projecting an existing report preserves these totals. Formula inputs, coefficients, costs and previous/new health stay exact.

`receiptInvocation`, player/NPC render contexts and event prompt contexts use this projection. Canonical `metadata.techniqueReceipt`, durable receipts and actual health mutation remain exact. Check-result summaries aggregate exact deltas before rounding; receipt detail UI labels rounded results and shows runtime damage effectiveness separately from the authored base formula.
