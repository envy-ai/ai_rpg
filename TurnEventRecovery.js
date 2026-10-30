class TurnEventRecovery {
    static decisionCode = 'TURN_EVENT_RECOVERY';
    static failureCode = 'TURN_EVENT_RECOVERY_FAILED';

    static isDecision(error) {
        return error?.code === this.decisionCode;
    }

    static validateChoice(answer, choices) {
        const choice = choices.find(candidate => candidate.value === answer);
        if (!choice || choice.disabled === true) {
            const error = new Error('That turn recovery option is unavailable.');
            error.code = this.failureCode;
            throw error;
        }
        return choice.value;
    }

    static timeSkipMinutes({ vehicleMinutes = null, onwardMinutes = null, sameDestination = false } = {}) {
        const durations = [vehicleMinutes, ...(sameDestination ? [] : [onwardMinutes])]
            .filter(value => value !== null && value !== undefined);
        if (durations.some(value => !Number.isInteger(value) || value < 0)) {
            throw new Error('Time-skip durations must be non-negative integer minutes.');
        }
        return durations.reduce((total, value) => total + value, 0);
    }

    static async resolve({ error, requestChoice, canTimeSkip = false, autosaveName = null, routeDescription = '' }) {
        if (!(error instanceof Error) || typeof requestChoice !== 'function') {
            throw new TypeError('Turn recovery requires an error and a player decision channel.');
        }
        const choices = [
            { value: 'rerun', label: 'Re-run turn', disabled: !autosaveName,
                description: autosaveName ? 'Restore this turn’s starting autosave and generate a new response.' : 'No starting autosave is available for this turn.' },
            { value: 'accept-route', label: 'Accept and time-skip', disabled: !canTimeSkip,
                description: 'Move your character and companions off the vehicle to the narrated destination, then continue processing.' },
            { value: 'skip-events', label: 'Don’t process events',
                description: 'Keep the prose and stop the remaining post-action processing. Earlier changes remain.' }
        ];
        const response = await requestChoice({
            mode: 'choice',
            title: 'Travel could not be processed',
            question: error.message,
            choices,
            details: { stack: error.stack || '', routeDescription }
        });
        const action = this.validateChoice(response.answer, choices);
        if (action === 'accept-route') {
            return action;
        }
        const decision = new Error(error.message, { cause: error });
        decision.code = this.decisionCode;
        decision.action = action;
        decision.autosaveName = action === 'rerun' ? autosaveName : null;
        throw decision;
    }
}

module.exports = TurnEventRecovery;
