const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../../Globals.js');
const Player = require('../../Player.js');
const Thing = require('../../Thing.js');

const DEFAULT_ATTRIBUTES = [
    { id: 'strength', label: 'Strength', default: 5 }
];
const DEFAULT_NEED_BARS_YAML = 'need_bars: {}\n';

function buildAttributesYaml(attributes) {
    const entries = (attributes && attributes.length ? attributes : DEFAULT_ATTRIBUTES)
        .map(attribute => `  ${attribute.id}:\n    label: ${attribute.label}\n    default: ${attribute.default}\n`)
        .join('');
    return `\nattributes:\n${entries}`;
}

function createTempDefsDir({
    prefix = 'ai-rpg-test-defs-',
    attributes = DEFAULT_ATTRIBUTES,
    needBarsYaml = DEFAULT_NEED_BARS_YAML
} = {}) {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', buildAttributesYaml(attributes));
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', needBarsYaml);

    return tempBaseDir;
}

function withBaseHealthOnly(previousConfig = {}) {
    return {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
}

function withStandardTestConfig(previousConfig = {}, { preserveBaseHealth = true } = {}) {
    return {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: preserveBaseHealth && Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            character_creation: {
                attribute_pool_formula: '0',
                skill_pool_formula: '0',
                max_attribute: '18',
                max_skill: '10'
            }
        }
    };
}

function withMergedTestConfig(previousConfig = {}) {
    return {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            ...(previousConfig?.formulas && typeof previousConfig.formulas === 'object' ? previousConfig.formulas : {}),
            character_creation: {
                ...(previousConfig?.formulas?.character_creation && typeof previousConfig.formulas.character_creation === 'object'
                    ? previousConfig.formulas.character_creation
                    : {}),
                attribute_pool_formula: previousConfig?.formulas?.character_creation?.attribute_pool_formula ?? '0',
                skill_pool_formula: previousConfig?.formulas?.character_creation?.skill_pool_formula ?? '0',
                max_attribute: previousConfig?.formulas?.character_creation?.max_attribute ?? '999',
                max_skill: previousConfig?.formulas?.character_creation?.max_skill ?? '999'
            }
        }
    };
}

function resolveConfig(configStyle, previousConfig, configOverrides) {
    let config;
    if (typeof configStyle === 'function') {
        config = configStyle(previousConfig);
    } else if (configStyle === 'health-only') {
        config = withBaseHealthOnly(previousConfig);
    } else if (configStyle === 'merged') {
        config = withMergedTestConfig(previousConfig);
    } else if (configStyle === 'standard-force-health') {
        config = withStandardTestConfig(previousConfig, { preserveBaseHealth: false });
    } else {
        config = withStandardTestConfig(previousConfig);
    }
    if (configOverrides && typeof configOverrides === 'object') {
        config = { ...config, ...configOverrides };
    }
    return config;
}

function withTempPlayerEnvironment(options, run) {
    const {
        tempBaseDir: providedTempBaseDir = null,
        configStyle = 'standard',
        configOverrides = null,
        currentPlayer = null,
        manageModRegistry = false,
        manageWorldTime = false,
        clearThings = false
    } = options || {};
    const tempBaseDir = providedTempBaseDir || createTempDefsDir(options || {});

    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousCurrentPlayer = currentPlayer ? Globals.currentPlayer : undefined;
    const previousRegistry = manageModRegistry ? Globals.modExtensionRegistry : undefined;
    const previousWorldTime = manageWorldTime ? Globals.worldTime : undefined;

    const resetRuntimeState = () => {
        Player.clearRuntimeRegistries();
        if (clearThings) {
            Thing.clear();
        }
    };

    resetRuntimeState();
    if (currentPlayer === 'null') {
        Globals.currentPlayer = null;
    }
    Globals.baseDir = tempBaseDir;
    Globals.config = resolveConfig(configStyle, previousConfig, configOverrides);
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        return run();
    } finally {
        resetRuntimeState();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        if (currentPlayer) {
            Globals.currentPlayer = previousCurrentPlayer;
        }
        if (manageModRegistry) {
            Globals.modExtensionRegistry = previousRegistry;
        }
        if (manageWorldTime) {
            Globals.worldTime = previousWorldTime;
        }
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
}

module.exports = {
    createTempDefsDir,
    withBaseHealthOnly,
    withStandardTestConfig,
    withMergedTestConfig,
    withTempPlayerEnvironment
};
