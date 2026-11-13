const SlashCommandBase = require('../SlashCommandBase.js');
const Faction = require('../Faction.js');

class FactionFavorsCommand extends SlashCommandBase {
    static get name() {
        return 'faction_favors';
    }

    static get description() {
        return 'Generate favors for factions that have positive reputation tiers but no favors yet.';
    }

    static get args() {
        return [
            { name: 'action', type: 'string', required: true },
            { name: 'faction', type: 'string', required: false }
        ];
    }

    static get usage() {
        return '/faction_favors generate [faction="Faction Name"]';
    }

    static async execute(interaction, args = {}) {
        const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
        if (action !== 'generate') {
            throw new Error(`Unknown action "${args.action}". Usage: ${this.usage}`);
        }
        const generate = interaction?.generateMissingFactionFavors;
        const listNeeding = interaction?.listFactionsNeedingFavors;
        if (typeof generate !== 'function' || typeof listNeeding !== 'function') {
            throw new Error('Faction favor generation is unavailable in this command context.');
        }
        let factionNames = null;
        if (typeof args.faction === 'string' && args.faction.trim()) {
            const faction = Faction.getByName(args.faction.trim());
            if (!faction) {
                throw new Error(`No faction named "${args.faction.trim()}".`);
            }
            factionNames = [faction.name];
        }
        const pending = listNeeding({ factionNames });
        if (!pending.length) {
            await interaction.reply({
                content: factionNames
                    ? `${factionNames[0]} already has favors or has no reputation tier above 0.`
                    : 'Every faction with a positive reputation tier already has favors.',
                ephemeral: false
            });
            return;
        }
        const result = await generate({ factionNames });
        const updated = Array.isArray(result?.updated) ? result.updated : [];
        await interaction.reply({
            content: updated.length
                ? `Generated favors for: ${updated.join(', ')}.`
                : 'No favors were added (the factions gained favors elsewhere, or the game changed while generating).',
            ephemeral: false
        });
    }
}

module.exports = FactionFavorsCommand;
