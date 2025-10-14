const fs = require('fs');
const path = require('path');

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
    const directory = path.join(__dirname, 'slashcommands');
    let files;
    try {
      files = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Failed to enumerate slash commands: ${error.message}`);
    }

    const commands = [];
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) {
        continue;
      }
      const commandPath = path.join(directory, entry.name);
      let CommandModule;
      try {
        CommandModule = require(commandPath);
      } catch (error) {
        console.warn(`Failed to load slash command '${entry.name}':`, error.message);
        continue;
      }
      if (!CommandModule || typeof CommandModule.name !== 'string' || typeof CommandModule.usage !== 'string') {
        continue;
      }
      commands.push({
        name: CommandModule.name,
        description: typeof CommandModule.description === 'string' ? CommandModule.description : '',
        usage: CommandModule.usage
      });
    }

    commands.sort((a, b) => a.name.localeCompare(b.name));
    return commands;
  }
}

module.exports = SlashCommandBase;  
