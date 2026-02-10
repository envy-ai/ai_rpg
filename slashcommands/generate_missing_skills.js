const SlashCommandBase = require('../SlashCommandBase.js');
const Player = require('../Player.js');
const Skill = require('../Skill.js');

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function hasGeneratedMetadata(skillDefinition) {
  if (!skillDefinition || typeof skillDefinition !== 'object') {
    return false;
  }
  const description = normalizeText(skillDefinition.description);
  const attribute = normalizeText(skillDefinition.attribute);
  return Boolean(description) && Boolean(attribute) && attribute.toLowerCase() !== 'n/a';
}

function toBulletList(names = []) {
  if (!Array.isArray(names) || !names.length) {
    return '- None';
  }
  return names.map(name => `- ${name}`).join('\n');
}

class GenerateMissingSkillsCommand extends SlashCommandBase {
  static get name() {
    return 'generate_missing_skills';
  }

  static get aliases() {
    return ['skills_generate_missing', 'regen_skill_metadata'];
  }

  static get description() {
    return 'Find skills missing generated metadata, list them, and generate their details.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const registry = interaction?.skillRegistry instanceof Map
      ? interaction.skillRegistry
      : (Player.availableSkills instanceof Map ? Player.availableSkills : null);

    if (!(registry instanceof Map)) {
      throw new Error('Skill registry is unavailable in command context.');
    }

    const missingNames = [];
    for (const [name, definition] of registry.entries()) {
      const skillName = normalizeText(name);
      if (!skillName) {
        continue;
      }
      if (!hasGeneratedMetadata(definition)) {
        missingNames.push(skillName);
      }
    }

    missingNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (!missingNames.length) {
      await interaction.reply({
        content: 'All registered skills already have generated metadata.',
        ephemeral: false
      });
      return;
    }

    if (typeof interaction?.generateSkillsByNames !== 'function') {
      await interaction.reply({
        content: [
          'Missing skill metadata detected, but generation is unavailable in this command context.',
          '',
          `Missing skills (${missingNames.length}):`,
          toBulletList(missingNames)
        ].join('\n'),
        ephemeral: false
      });
      return;
    }

    let settingDescription = null;
    if (typeof interaction.describeSettingForPrompt === 'function') {
      const settingSnapshot = typeof interaction.getActiveSettingSnapshot === 'function'
        ? interaction.getActiveSettingSnapshot()
        : null;
      settingDescription = interaction.describeSettingForPrompt(settingSnapshot);
    }

    let generatedSkills = [];
    try {
      generatedSkills = await interaction.generateSkillsByNames({
        skillNames: missingNames,
        settingDescription
      });
    } catch (error) {
      throw new Error(`Skill metadata generation failed: ${error.message || error}`);
    }

    const generatedNow = [];
    const stillMissing = [];

    for (let index = 0; index < missingNames.length; index += 1) {
      const skillName = missingNames[index];
      const existing = registry.get(skillName);
      const generated = Array.isArray(generatedSkills) ? generatedSkills[index] : null;

      const description = normalizeText(generated?.description)
        || normalizeText(existing?.description);
      const attribute = normalizeText(generated?.attribute)
        || normalizeText(existing?.attribute);

      const merged = new Skill({
        name: skillName,
        description,
        attribute
      });

      registry.set(skillName, merged);
      if (Player.availableSkills instanceof Map) {
        Player.availableSkills.set(skillName, merged);
      }

      if (hasGeneratedMetadata(merged)) {
        generatedNow.push(skillName);
      } else {
        stillMissing.push(skillName);
      }
    }

    const lines = [
      '## Skill Metadata Generation',
      '',
      `Missing before generation (${missingNames.length}):`,
      toBulletList(missingNames),
      '',
      `Generated/filled (${generatedNow.length}):`,
      toBulletList(generatedNow)
    ];

    if (stillMissing.length) {
      lines.push('');
      lines.push(`Still missing metadata (${stillMissing.length}):`);
      lines.push(toBulletList(stillMissing));
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = GenerateMissingSkillsCommand;
