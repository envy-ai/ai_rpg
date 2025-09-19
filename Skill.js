class Skill {
  constructor({ name, description, attribute }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Skill name must be a non-empty string');
    }

    this.name = name.trim();
    this.description = typeof description === 'string' ? description.trim() : '';
    this.attribute = typeof attribute === 'string' ? attribute.trim() : '';
  }

  update({ name, description, attribute } = {}) {
    if (typeof name === 'string' && name.trim()) {
      this.name = name.trim();
    }
    if (typeof description === 'string') {
      this.description = description.trim();
    }
    if (typeof attribute === 'string') {
      this.attribute = attribute.trim();
    }
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      attribute: this.attribute
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided to Skill.fromJSON');
    }
    return new Skill({
      name: data.name,
      description: data.description,
      attribute: data.attribute
    });
  }
}

module.exports = Skill;
