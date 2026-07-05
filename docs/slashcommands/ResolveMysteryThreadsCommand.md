# ResolveMysteryThreadsCommand

## Purpose

`/resolve_mystery_threads` runs the mystery box cleanup prompt immediately and reports which mystery threads and boxes were resolved.

## Usage

```text
/resolve_mystery_threads
```

The command takes no arguments.

## Behavior

- Requires `interaction.runMysteryBoxCleanupPrompt` and throws `Mystery thread cleanup is unavailable in this command context.` when the helper is absent.
- Runs `prompts/_includes/mystery_box_cleanup.njk` through the shared base-context wrapper with active mystery threads and unresolved contained boxes listed by exact id.
- Applies returned `<resolved>true</resolved>` thread decisions by setting those threads to `inactive`.
- Applies returned `<revealed>true</revealed>` box decisions through `MysteryBox.markResolved()`.
- The runner returns both newly applied records (`appliedResolvedThreads` / `appliedResolvedBoxes`) and decision summaries (`decisionResolvedThreads` / `decisionResolvedBoxes`) keyed to the prompt candidates. The command displays the merged resolved summaries so the user sees the model's resolved/revealed decisions even if the same state change was already applied by a concurrent cleanup.
- Persists `mysteryBoxes.json`, `mysteryThreads.json`, and metadata counts when a current save directory is attached.

## Replies

When at least one candidate mystery is marked resolved or revealed, the command replies publicly with `Resolved mystery threads` and/or `Resolved mystery boxes` sections. Each item includes the resolved thread or box name and the prompt's `<thoughts>` text.

When no mystery resolves, it replies:

```text
Mystery cleanup completed. No mystery threads or boxes were resolved.
```

## Registration

`SlashCommandRegistry` auto-loads the command from `slashcommands/resolve_mystery_threads.js`, and `/help` lists `/resolve_mystery_threads`.
