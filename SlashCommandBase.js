const { getRegisteredSlashCommands } = require('./SlashCommandRegistry.js');

class SlashCommandBase {
  static get name() {
    throw new Error('Name not implemented');
  }

  static get aliases() {
    return [];
  }

  static get description() {
    throw new Error('Description not implemented');
  }

  static get args() {
    throw new Error('Args not implemented');

    // Follow this format:
    /*
    return [
      { name: 'amount', type: 'integer', required: true },
      { name: 'character', type: 'string', required: false }
    ]
    */
  }

  static get usage() {
    // Assemble a usage string based on the args
    const argsUsage = this.args.map(arg => {
      if (arg.required) {
        return `<${arg.name}>`;
      } else {
        return `[${arg.name}]`;
      }
    }).join(' ');

    return `/${this.name} ${argsUsage}`;
  }

  static validateArgs(providedArgs) {
    const argsDef = this.args || [];
    const errors = [];

    for (const argDef of argsDef) {
      const { name, type, required } = argDef;
      const value = providedArgs[name];

      if (required && (value === undefined || value === null)) {
        errors.push(`Missing required argument: ${name}`);
        continue;
      }

      if (value !== undefined && value !== null) {
        switch (type) {
          case 'string':
            if (typeof value !== 'string') {
              errors.push(`Argument "${name}" must be a string.`);
            }
            break;
          case 'integer':
            if (!Number.isInteger(value)) {
              errors.push(`Argument "${name}" must be an integer.`);
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`Argument "${name}" must be a boolean.`);
            }
            break;
          default:
            errors.push(`Unknown type "${type}" for argument "${name}".`);
        }
      }
    }

    return errors;
  }

  static listCommands() {
    const commands = [];
    const entries = getRegisteredSlashCommands();
    for (const entry of entries) {
      if (!entry || entry.isAlias) {
        continue;
      }

      const CommandModule = entry.module;
      if (!CommandModule) {
        continue;
      }

      const commandName = typeof entry.canonicalName === 'string' && entry.canonicalName.trim()
        ? entry.canonicalName.trim()
        : (typeof CommandModule.name === 'string' ? CommandModule.name : null);
      if (!commandName) {
        continue;
      }

      let description = '';
      try {
        const rawDescription = CommandModule.description;
        description = typeof rawDescription === 'string' ? rawDescription : '';
      } catch (_) {
        description = '';
      }

      let usage;
      try {
        usage = typeof CommandModule.usage === 'string' ? CommandModule.usage : `/${commandName}`;
      } catch (_) {
        usage = `/${commandName}`;
      }

      commands.push({
        name: commandName,
        description,
        usage
      });
    }

    commands.sort((a, b) => a.name.localeCompare(b.name));
    return commands;
  }
}

module.exports = SlashCommandBase;  
