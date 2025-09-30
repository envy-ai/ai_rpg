# Agent Notes

- Prefer explicit exceptions over silent fallbacks. If an operation cannot proceed, raise or propagate a clear error instead of returning a placeholder result.
- Avoid adding "fallback" or "best effort" flows unless the user has explicitly asked for them.
- When in doubt, fail loudly so the issue surfaces during development rather than being hidden.
- At the start of a coding session, inform the user that you have seen this file.
