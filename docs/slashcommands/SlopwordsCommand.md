# SlopwordsCommand

## Purpose
Slash command `/slopwords` to report slop words exceeding configured ppm thresholds.

## Args
- `default` (integer, optional): override default ppm threshold.

## Behavior
- Calls `Globals.analyzeChatSlopwords({ defaultPpmOverride })`.
- Replies with a comma-separated list or a clean bill of health.

## Notes
- Throws if analysis returns an invalid result.
