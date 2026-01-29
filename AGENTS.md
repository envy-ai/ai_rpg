# Agent Notes

- Prefer explicit exceptions over silent fallbacks. If an operation cannot proceed, raise or propagate a clear error instead of returning a placeholder result.
- If instructions are unclear, ask for clarification before implementing.
- Before writing code, ascertain any potential "gotchas" that might arise from following the user's instructions (maybe something will break or something important is being missed). If there are any, list them and then stop and ask for confirmation or changes before continuing.
- Avoid adding "fallback" or "best effort" flows unless the user has explicitly asked for them.
- When in doubt, fail loudly so the issue surfaces during development rather than being hidden.
- At the start of a coding session, inform the user that you have seen this file.
- Use VS code's internal functions when possible.
- Always prefer updating scss files over css files. If no corresponding scss file exists, create one.
- Don't do anything with git unless specifically asked (if it's necessary, ask permission first).
- Lint/syntax check any files you alter, if applicable.
- Be aware of things in Globals.js to avoid reinventing the wheel to get the current player, location, region, etc.
- Make sure all new prompts are logged via LLMClient.logPrompt()
