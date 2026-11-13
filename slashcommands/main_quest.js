const SlashCommandBase = require('../SlashCommandBase.js');
const MainQuest = require('../MainQuest.js');

function describe(mainQuest) {
    const lines = [`## ${mainQuest.title} (${mainQuest.status})`, '', `**Premise:** ${mainQuest.premise}`];
    if (mainQuest.playerGoal) lines.push(`**Player goal:** ${mainQuest.playerGoal}`);
    lines.push(`**Hidden truth:** ${mainQuest.hiddenTruth}`, `**Antagonist:** ${mainQuest.antagonist.description}`,
        `**Turns since progress:** ${mainQuest.turnsSinceProgress}`);
    if (mainQuest.pressure.playerFacingText) lines.push(`**Pressure:** ${mainQuest.pressure.playerFacingText}`);
    lines.push('', '### Stages');
    mainQuest.stages.forEach((stage, index) => {
        const marker = index === mainQuest.currentStageIndex && mainQuest.status === 'active' ? ' ← current' : '';
        lines.push(`${index + 1}. **${stage.title}** [${stage.status}]${marker} — ${stage.outline} _(exit: ${stage.exitCondition})_`);
        if (stage.outcome) lines.push(`   - Outcome: ${stage.outcome}`);
    });
    if (mainQuest.roles.length) {
        lines.push('', '### Roles');
        for (const role of mainQuest.roles) {
            lines.push(`- **${role.key}**: ${role.description} → ${role.boundTo ? `${role.boundTo.type} ${role.boundTo.name || role.boundTo.id}` : 'unbound'}`);
        }
    }
    if (mainQuest.lockedFacts.length) {
        lines.push('', '### Established facts', ...mainQuest.lockedFacts.map(fact => `- ${fact}`));
    }
    lines.push('', '### Endings', ...mainQuest.endings.map(ending => `- ${ending.id}: ${ending.description}`));
    if (mainQuest.reachedEnding) lines.push('', `**Reached ending:** ${mainQuest.reachedEnding.description}`);
    return lines.join('\n');
}

class MainQuestCommand extends SlashCommandBase {
    static get name() {
        return 'mainquest';
    }

    static get description() {
        return 'Start, inspect, check or abandon the main quest.';
    }

    static get args() {
        return [
            { name: 'action', type: 'string', required: true },
            { name: 'goal', type: 'string', required: false },
            { name: 'mode', type: 'string', required: false }
        ];
    }

    static get usage() {
        return '/mainquest action=start|status|check|abandon [goal="What my character wants"] [mode=new|sequel|auto]';
    }

    static async execute(interaction, args = {}) {
        const runtime = interaction?.mainQuestRuntime;
        if (!runtime) {
            throw new Error('The main quest runtime is unavailable in this command context.');
        }
        const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
        const reply = content => interaction.reply({ content, ephemeral: false });
        if (action === 'status') {
            const active = MainQuest.getActive();
            const offer = MainQuest.getOffer();
            if (!active) {
                await reply(`No active main quest. Offer state: ${offer.state}${offer.followUpOf ? ` (follow-up of ${offer.followUpOf})` : ''}. Past main quests: ${MainQuest.getAll().length}.`);
                return;
            }
            await reply(describe(active));
            return;
        }
        if (action === 'start') {
            const request = {};
            if (typeof args.goal === 'string' && args.goal.trim()) request.goal = args.goal.trim();
            if (typeof args.mode === 'string' && args.mode.trim()) request.mode = args.mode.trim().toLowerCase();
            const mainQuest = await runtime.start(request);
            await reply(`Main quest started: **${mainQuest.title}**\n\n${mainQuest.premise}`);
            return;
        }
        if (action === 'check') {
            const result = await runtime.runCheck({ reason: 'manual' });
            await reply(result ? `Main quest check: progress **${result.progress}**${result.stageOutcome ? ` — ${result.stageOutcome}` : ''}.` : 'There is no active main quest to check.');
            return;
        }
        if (action === 'abandon') {
            const abandoned = await runtime.abandon();
            await reply(`Abandoned the main quest **${abandoned.title}**. Its antagonist and consequences remain in the world.`);
            return;
        }
        throw new Error(`Unknown action "${args.action}". Usage: ${this.usage}`);
    }
}

module.exports = MainQuestCommand;
