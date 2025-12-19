# Agent Notes

- Prefer explicit exceptions over silent fallbacks. If an operation cannot proceed, raise or propagate a clear error instead of returning a placeholder result.
- If instructions are unclear, ask for clarification before implementing.
- Avoid adding "fallback" or "best effort" flows unless the user has explicitly asked for them.
- When in doubt, fail loudly so the issue surfaces during development rather than being hidden.
- At the start of a coding session, inform the user that you have seen this file.
- Use VS code's internal functions when possible.
- Always prefer updating scss files over css files. If no corresponding scss file exists, create one.
- Don't do anything with git unless specifically asked (if it's necessary, ask permission first).
- Lint/syntax check any files you alter, if applicable.
