function requireScenarioFile(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} requires a non-empty scenario file.`);
    }
    return value.trim();
}

export function materializeStoredSelection(inventory, storedScenarios) {
    if (!Array.isArray(storedScenarios) || !storedScenarios.length) {
        throw new Error('The benchmark session has no selected scenarios to continue.');
    }
    const byFile = new Map(inventory.scenarios.map(entry => [entry.file, entry]));
    return storedScenarios.map((stored, index) => {
        const file = requireScenarioFile(stored?.file, `selectedScenarios[${index}]`);
        const entry = byFile.get(file);
        if (!entry) {
            throw new Error(`Benchmark scenario ${file} from the saved session is no longer in the manifest.`);
        }
        return entry;
    });
}

export function mergeScenarioSelections(existing, additions) {
    const merged = [];
    const seen = new Set();
    for (const entry of [...existing, ...additions]) {
        const file = requireScenarioFile(entry?.file, 'Scenario selection');
        if (seen.has(file)) continue;
        seen.add(file);
        merged.push(entry);
    }
    return merged;
}

export function selectUnfinishedScenarios(selected, results) {
    const completed = new Set((results || []).map(result => result?.scenarioFile).filter(Boolean));
    return selected.filter(entry => !completed.has(entry.file));
}

export function replaceScenarioResult(results, replacement) {
    const scenarioFile = requireScenarioFile(replacement?.scenarioFile, 'Benchmark result');
    const source = [...(results || [])];
    const index = source.findIndex(result => result?.scenarioFile === scenarioFile);
    const next = source.filter(result => result?.scenarioFile !== scenarioFile);
    if (index === -1) next.push(replacement);
    else next.splice(index, 0, replacement);
    return next;
}

export function orderScenarioResults(results, selected) {
    const order = new Map(selected.map((entry, index) => [entry.file, index]));
    return [...results].sort((left, right) => {
        const leftIndex = order.get(left.scenarioFile) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.scenarioFile) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex || String(left.scenarioFile).localeCompare(String(right.scenarioFile));
    });
}

export function scenarioMutatesRuntimeConfig(definition) {
    return Array.isArray(definition?.steps) && definition.steps.some(step => (
        step?.type === 'request'
        && String(step.method || 'GET').toUpperCase() !== 'GET'
        && step.route === '/api/game-config-override'
    ));
}
