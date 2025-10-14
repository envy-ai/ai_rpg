class SlashCommandBase {
  static get name() {
    throw new Error('Name not implemented');
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
}

module.exports = SlashCommandBase;  