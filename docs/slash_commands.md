Slash Commands Quick Guide

- Lifecycle
  - `server.js` initializes `SlashCommandRegistry` (loads `slashcommands/*.js`), then `/api/slash-command` in `api.js` invokes the matching module by name/alias.
  - `public/js/chat.js` sends `/command arg=value` or `/command arg1 arg2` to `/api/slash-command`; replies are rendered as system messages.

- Command shape
  - Extend `SlashCommandBase` and export the class.
  - Required statics: `name` (string), `description` (string), `args` (array), `execute(interaction, args)`.
  - Optional: `aliases` array; `validateArgs` inherited default checks types against `args`.
  - `args` entries: `{ name, type: 'string'|'integer'|'boolean', required: bool }`.
  - `usage` is auto-built from `args` (shown by `/help` via `SlashCommandBase.listCommands()`).

- Arg parsing (server)
  - Request body carries `args` (object) and `argsText` (raw string).
  - Server tokenizes `argsText` left-to-right (quoted strings respected) to fill missing args in declaration order; types are coerced (integer/boolean/String).
  - After filling, `validateArgs` runs; return 400 with `errors` if invalid.

- Interaction API
  - `interaction.user.id` is the caller’s userId (may be null).
  - `interaction.reply(payload)` collects responses; payload shape: `{ content: string, ephemeral?: boolean }`.
  - Return value is ignored; send one or multiple replies; empty replies produce a generic success message client-side.

- Best practices
  - Fail loudly with clear errors (throw or reply with `ephemeral: true`).
  - Normalize string inputs (trim/strip quotes) before lookups; validate types and existence.
  - Avoid silent fallbacks; if a helper is unavailable (e.g., `Globals.triggerRandomEvent`), throw with a precise reason.
  - Keep commands side-effect scoped and synchronous when possible; mark `execute` async if awaiting I/O.
  - Prefer existing helpers on `Globals`/models (e.g., `Location.get`, `playersByName`, `generateLevelUpAbilitiesForCharacter`).

- Adding a new command (example skeleton)
  ```js
  const Globals = require('../Globals.js');
  const SlashCommandBase = require('../SlashCommandBase.js');

  class MyCommand extends SlashCommandBase {
    static get name() { return 'mycmd'; }
    static get aliases() { return ['mc']; }
    static get description() { return 'Do a thing.'; }
    static get args() { return [{ name: 'target', type: 'string', required: true }]; }

    static async execute(interaction, args = {}) {
      const target = (args.target || '').trim();
      if (!target) throw new Error('Target is required.');
      // ...do work...
      await interaction.reply({ content: `Did the thing to ${target}.`, ephemeral: false });
    }
  }

  module.exports = MyCommand;
  ```
  - Drop the file in `slashcommands/`; it will auto-register on startup (name + aliases).

- Testing
  - Use `/help` to confirm registration/usage text.
  - Run the command in chat; verify expected replies and that invalid args return clear errors.
