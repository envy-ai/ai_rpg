(() => {
  const DEFAULT_ATTRIBUTE_VALUE = 10;
  const DEFAULT_ATTRIBUTE_MIN = 1;
  const DEFAULT_ATTRIBUTE_MAX = 20;
  const DEFAULT_ATTRIBUTE_POOL_FORMULA = 'level * (number_of_attributes / 2)';
  const DEFAULT_SKILL_POOL_FORMULA = 'level * ceil(number_of_skills / 5)';

  const normalizeSkillList = (list) => {
    if (!Array.isArray(list)) {
      return [];
    }
    const result = [];
    const seen = new Set();
    for (const entry of list) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(trimmed);
    }
    return result;
  };

  const ensureElement = (element, label) => {
    if (!element) {
      throw new Error(`AttributeSkillAllocator requires ${label}.`);
    }
    return element;
  };

  const resolveFormulaString = (rawValue, fallback, label) => {
    if (rawValue === undefined || rawValue === null) {
      return fallback;
    }
    if (typeof rawValue !== 'string') {
      throw new Error(`AttributeSkillAllocator expected ${label} to be a string.`);
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw new Error(`AttributeSkillAllocator requires ${label} to be a non-empty string.`);
    }
    return trimmed;
  };

  const formatAttributeModifier = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '+0';
    }
    const modifier = Math.floor((numeric - 10) / 2);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  const escapeSelector = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  };

  const init = (options = {}) => {
    const enableAttributes = options.enableAttributes !== false;
    const enableSkills = options.enableSkills !== false;
    const allowSkillAdd = options.allowSkillAdd !== false;
    const isReadOnly = options.readOnly === true;
    const suppressPoolWarnings = options.suppressPoolWarnings === true || isReadOnly;
    const attributePoolBaseValue = Number.isFinite(Number(options.attributePoolBaseValue))
      ? Number(options.attributePoolBaseValue)
      : null;
    const skillPoolBaseValue = Number.isFinite(Number(options.skillPoolBaseValue))
      ? Number(options.skillPoolBaseValue)
      : null;
    const onPoolsUpdated = typeof options.onPoolsUpdated === 'function'
      ? options.onPoolsUpdated
      : null;

    const levelField = (enableAttributes || enableSkills)
      ? ensureElement(options.levelField, 'level field element')
      : null;

    const attributeGrid = enableAttributes
      ? ensureElement(options.attributeGrid, 'attribute grid element')
      : null;
    const attributePointsDisplay = enableAttributes
      ? ensureElement(options.attributePointsDisplay, 'attribute points display element')
      : null;
    const attributePointsWarning = enableAttributes
      ? ensureElement(options.attributePointsWarning, 'attribute points warning element')
      : null;

    const skillsSection = enableSkills
      ? ensureElement(options.skillsSection, 'skills section element')
      : null;
    const skillsGrid = enableSkills
      ? ensureElement(options.skillsGrid, 'skills grid element')
      : null;
    const skillPointsDisplay = enableSkills
      ? ensureElement(options.skillPointsDisplay, 'skill points display element')
      : null;
    const skillPointsWarning = enableSkills
      ? ensureElement(options.skillPointsWarning, 'skill points warning element')
      : null;

    const attributeDefaultValue = Number.isFinite(Number(options.attributeDefaultValue))
      ? Number(options.attributeDefaultValue)
      : DEFAULT_ATTRIBUTE_VALUE;
    const attributeMinValue = Number.isFinite(Number(options.attributeMinValue))
      ? Number(options.attributeMinValue)
      : DEFAULT_ATTRIBUTE_MIN;
    const attributeMaxValue = Number.isFinite(Number(options.attributeMaxValue))
      ? Number(options.attributeMaxValue)
      : DEFAULT_ATTRIBUTE_MAX;

    const formulaEvaluator = options.formulaEvaluator
      || (typeof window !== 'undefined' ? window.FormulaEvaluator : null);
    if (!formulaEvaluator || typeof formulaEvaluator.compile !== 'function') {
      throw new Error('AttributeSkillAllocator requires FormulaEvaluator.compile to be available.');
    }
    if (typeof formulaEvaluator.normalizeVariableKey !== 'function') {
      throw new Error('AttributeSkillAllocator requires FormulaEvaluator.normalizeVariableKey to be available.');
    }
    if (typeof formulaEvaluator.collectVariables !== 'function') {
      throw new Error('AttributeSkillAllocator requires FormulaEvaluator.collectVariables to be available.');
    }
    const normalizeVariableKey = formulaEvaluator.normalizeVariableKey;
    const normalizeFloorValues = (rawValues = {}, label = 'floor values') => {
      if (rawValues === null || rawValues === undefined) {
        return new Map();
      }
      if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
        throw new Error(`AttributeSkillAllocator expected ${label} to be an object.`);
      }
      const result = new Map();
      for (const [rawKey, rawValue] of Object.entries(rawValues)) {
        if (typeof rawKey !== 'string') {
          continue;
        }
        const trimmedKey = rawKey.trim();
        if (!trimmedKey) {
          continue;
        }
        const normalizedKey = normalizeVariableKey(trimmedKey);
        if (!normalizedKey) {
          continue;
        }
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) {
          continue;
        }
        result.set(normalizedKey, numeric);
      }
      return result;
    };
    const attributeFloorValues = normalizeFloorValues(options.attributeFloorValues, 'attribute floor values');
    const skillFloorValues = normalizeFloorValues(options.skillFloorValues, 'skill floor values');

    const poolFormulas = options.poolFormulas || {};
    const attributePoolFormula = resolveFormulaString(
      poolFormulas.attribute,
      DEFAULT_ATTRIBUTE_POOL_FORMULA,
      'attribute pool formula'
    );
    const skillPoolFormula = resolveFormulaString(
      poolFormulas.skill,
      DEFAULT_SKILL_POOL_FORMULA,
      'skill pool formula'
    );
    const maxAttributeFormula = resolveFormulaString(
      poolFormulas.maxAttribute,
      'infinity',
      'max attribute formula'
    );
    const maxSkillFormula = resolveFormulaString(
      poolFormulas.maxSkill,
      'infinity',
      'max skill formula'
    );
    const attributePoolEvaluator = formulaEvaluator.compile(attributePoolFormula);
    const skillPoolEvaluator = formulaEvaluator.compile(skillPoolFormula);
    const maxAttributeEvaluator = formulaEvaluator.compile(maxAttributeFormula);
    const maxSkillEvaluator = formulaEvaluator.compile(maxSkillFormula);

    const formulaVariables = new Set([
      ...formulaEvaluator.collectVariables(attributePoolFormula),
      ...formulaEvaluator.collectVariables(skillPoolFormula),
      ...formulaEvaluator.collectVariables(maxAttributeFormula),
      ...formulaEvaluator.collectVariables(maxSkillFormula)
    ]);

    const referencedSkillKeys = new Set();
    for (const variableName of formulaVariables) {
      if (typeof variableName !== 'string' || !variableName.startsWith('skill.')) {
        continue;
      }
      const rawKey = variableName.slice('skill.'.length);
      if (!rawKey) {
        continue;
      }
      referencedSkillKeys.add(normalizeVariableKey(rawKey));
    }

    const state = {
      attributes: {
        definitions: [],
        values: new Map(),
        inputElements: new Map(),
        modifierElements: new Map(),
        floorValues: new Map(),
        poolRemaining: 0
      },
      skills: {
        names: [],
        values: new Map(),
        floorValues: new Map(),
        pointsPerLevel: 0,
        poolRemaining: 0
      }
    };

    let lastValidLevel = null;
    let suspendPoolUpdates = false;

    const setPointsWarning = (el, message, tone = '') => {
      if (!el) {
        return;
      }
      if (message) {
        el.textContent = message;
        el.style.display = 'block';
        el.style.visibility = 'visible';
        if (tone === 'warn') {
          el.style.color = '#ff9800';
        } else if (tone === 'error') {
          el.style.color = '#f44336';
        }
      } else {
        el.textContent = '';
        el.style.display = 'block';
        el.style.visibility = 'hidden';
      }
    };

    const getAttributeFloorValue = (attrKey) => {
      if (typeof attrKey !== 'string' || !attrKey.trim()) {
        return null;
      }
      const normalized = normalizeVariableKey(attrKey);
      const floor = state.attributes.floorValues.get(normalized);
      return Number.isFinite(floor) ? floor : null;
    };

    const getSkillFloorValue = (skillName) => {
      if (typeof skillName !== 'string' || !skillName.trim()) {
        return null;
      }
      const normalized = normalizeVariableKey(skillName);
      const floor = state.skills.floorValues.get(normalized);
      return Number.isFinite(floor) ? floor : null;
    };

    const getLevelValue = () => {
      if (!levelField) {
        return Number.isFinite(lastValidLevel) ? lastValidLevel : 1;
      }
      const raw = typeof levelField.value === 'string' ? levelField.value.trim() : '';
      if (!raw) {
        return Number.isFinite(lastValidLevel) ? lastValidLevel : 1;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      return Number.isFinite(lastValidLevel) ? lastValidLevel : 1;
    };

    const buildFormulaVariables = (levelValue, attributeCountOverride = null) => {
      const attrCount = Number.isFinite(Number(attributeCountOverride))
        ? Number(attributeCountOverride)
        : (state.attributes.definitions.length || state.attributes.values.size);
      const skillCount = state.skills.names.length;

      const attributeValues = {};
      const attributeKeys = new Set();
      for (const [key, value] of state.attributes.values.entries()) {
        const normalizedKey = normalizeVariableKey(key);
        if (attributeKeys.has(normalizedKey)) {
          throw new Error(`Duplicate attribute variable key '${normalizedKey}'.`);
        }
        attributeKeys.add(normalizedKey);
        const numericValue = Number(value);
        attributeValues[normalizedKey] = {
          value: numericValue,
          bonus: Math.floor((numericValue - 10) / 2)
        };
      }

      const modifiedAttributeValues = {};
      const modifiedInput = options.modifiedAttributeValues || null;
      let normalizedModifiedInput = null;
      if (modifiedInput !== null && modifiedInput !== undefined) {
        if (!modifiedInput || typeof modifiedInput !== 'object') {
          throw new Error('AttributeSkillAllocator expected modifiedAttributeValues to be an object.');
        }
        normalizedModifiedInput = new Map();
        for (const [rawKey, rawValue] of Object.entries(modifiedInput)) {
          const normalizedKey = normalizeVariableKey(rawKey);
          if (normalizedModifiedInput.has(normalizedKey)) {
            throw new Error(`Duplicate modified attribute key '${normalizedKey}'.`);
          }
          const numericValue = Number(rawValue);
          if (!Number.isFinite(numericValue)) {
            throw new Error(`Modified attribute '${rawKey}' is not a finite number.`);
          }
          normalizedModifiedInput.set(normalizedKey, numericValue);
        }
      }

      for (const [normalizedKey, baseEntry] of Object.entries(attributeValues)) {
        const modifiedValue = normalizedModifiedInput?.has(normalizedKey)
          ? normalizedModifiedInput.get(normalizedKey)
          : baseEntry.value;
        modifiedAttributeValues[normalizedKey] = {
          value: modifiedValue,
          bonus: Math.floor((modifiedValue - 10) / 2)
        };
      }

      const skillValues = {};
      const skillKeys = new Set();
      for (const [name, value] of state.skills.values.entries()) {
        const normalizedKey = normalizeVariableKey(name);
        if (skillKeys.has(normalizedKey)) {
          throw new Error(`Duplicate skill variable key '${normalizedKey}'.`);
        }
        skillKeys.add(normalizedKey);
        skillValues[normalizedKey] = Number(value);
      }

      return {
        level: levelValue,
        number_of_attributes: attrCount,
        number_of_skills: skillCount,
        attribute: attributeValues,
        attribute_modified: modifiedAttributeValues,
        skill: skillValues
      };
    };

    const evaluateMaxAttribute = (levelValue, attributeCountOverride = null) => {
      const variables = buildFormulaVariables(levelValue, attributeCountOverride);
      const rawMax = maxAttributeEvaluator(variables);
      if (!Number.isFinite(rawMax)) {
        throw new Error('Max attribute formula did not return a finite number.');
      }
      return rawMax;
    };

    const evaluateMaxSkill = (levelValue) => {
      const variables = buildFormulaVariables(levelValue);
      const rawMax = maxSkillEvaluator(variables);
      if (!Number.isFinite(rawMax)) {
        throw new Error('Max skill formula did not return a finite number.');
      }
      return rawMax;
    };

    const computeAttributePool = (levelOverride = null) => {
      if (!enableAttributes) {
        return 0;
      }
      if (Number.isFinite(attributePoolBaseValue)) {
        let spent = 0;
        for (const [key, value] of state.attributes.values.entries()) {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) {
            continue;
          }
          const floorValue = getAttributeFloorValue(key);
          const baseline = Number.isFinite(floorValue) ? floorValue : attributeDefaultValue;
          spent += Math.max(0, numeric - baseline);
        }
        return attributePoolBaseValue - spent;
      }
      const attrCount = state.attributes.definitions.length
        || state.attributes.values.size
        || (attributeGrid ? attributeGrid.querySelectorAll('.attribute-group').length : 0);
      if (!attrCount) {
        return 0;
      }
      const hasOverride = levelOverride !== null && levelOverride !== undefined && levelOverride !== '';
      const levelValue = hasOverride && Number.isFinite(Number(levelOverride))
        ? Number(levelOverride)
        : getLevelValue();
      if (!Number.isFinite(levelValue)) {
        return 0;
      }
      const variables = buildFormulaVariables(levelValue, attrCount);
      const basePool = attributePoolEvaluator(variables);
      let pool = basePool;
      for (const value of state.attributes.values.values()) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          continue;
        }
        pool += attributeDefaultValue - numeric;
      }
      return pool;
    };

    const computeSkillPool = (levelOverride = null) => {
      if (!enableSkills || !state.skills.names.length) {
        return 0;
      }
      if (Number.isFinite(skillPoolBaseValue)) {
        let spent = 0;
        for (const [name, value] of state.skills.values.entries()) {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) {
            continue;
          }
          const floorValue = getSkillFloorValue(name);
          const baseline = Number.isFinite(floorValue) ? floorValue : 1;
          spent += Math.max(0, numeric - baseline);
        }
        return skillPoolBaseValue - spent;
      }
      const hasOverride = levelOverride !== null && levelOverride !== undefined && levelOverride !== '';
      const levelValue = hasOverride && Number.isFinite(Number(levelOverride))
        ? Number(levelOverride)
        : getLevelValue();
      if (!Number.isFinite(levelValue)) {
        return 0;
      }
      const variables = buildFormulaVariables(levelValue);
      const basePool = skillPoolEvaluator(variables);
      let spent = 0;
      for (const value of state.skills.values.values()) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          continue;
        }
        spent += Math.max(0, numeric - 1);
      }
      return basePool - spent;
    };

    const updatePoolWarnings = () => {
      const attrPool = Number(state.attributes.poolRemaining);
      const skillPool = Number(state.skills.poolRemaining);

      if (suppressPoolWarnings) {
        if (enableAttributes) {
          setPointsWarning(attributePointsWarning, '');
        }
        if (enableSkills) {
          setPointsWarning(skillPointsWarning, '');
        }
        if (onPoolsUpdated) {
          onPoolsUpdated({
            attributePool: enableAttributes ? state.attributes.poolRemaining : null,
            skillPool: enableSkills ? state.skills.poolRemaining : null
          });
        }
        return;
      }

      if (enableAttributes) {
        if (Number.isFinite(attrPool) && attrPool < 0) {
          setPointsWarning(attributePointsWarning, 'Attribute pool is overspent. Reduce stats or increase level.', 'error');
        } else if (Number.isFinite(attrPool) && attrPool > 0) {
          setPointsWarning(attributePointsWarning, 'You have unspent attribute points.', 'warn');
        } else {
          setPointsWarning(attributePointsWarning, '');
        }
      }

      if (enableSkills) {
        if (Number.isFinite(skillPool) && skillPool < 0) {
          setPointsWarning(skillPointsWarning, 'Skill pool is overspent. Decrease skill ranks or increase level.', 'error');
        } else if (Number.isFinite(skillPool) && skillPool > 0) {
          setPointsWarning(skillPointsWarning, 'You have unspent skill points.', 'warn');
        } else {
          setPointsWarning(skillPointsWarning, '');
        }
      }

      if (onPoolsUpdated) {
        onPoolsUpdated({
          attributePool: enableAttributes ? state.attributes.poolRemaining : null,
          skillPool: enableSkills ? state.skills.poolRemaining : null
        });
      }
    };

    const updateAttributePoolDisplay = (levelOverride = null) => {
      const pool = computeAttributePool(levelOverride);
      state.attributes.poolRemaining = pool;
      if (attributePointsDisplay) {
        attributePointsDisplay.textContent = Number.isFinite(pool) ? String(pool) : '0';
      }
      updatePoolWarnings();
      return pool;
    };

    const updateSkillPoolDisplay = (levelOverride = null) => {
      const pool = computeSkillPool(levelOverride);
      state.skills.poolRemaining = pool;
      if (skillPointsDisplay) {
        skillPointsDisplay.textContent = Number.isFinite(pool) ? String(pool) : '0';
      }
      updatePoolWarnings();
      return pool;
    };

    const setSkillWarning = (message) => {
      setPointsWarning(skillPointsWarning, message, 'error');
    };

    const normalizeElements = (value) => {
      if (!value) {
        return [];
      }
      if (Array.isArray(value)) {
        return value.filter(Boolean);
      }
      if (typeof NodeList !== 'undefined' && value instanceof NodeList) {
        return Array.from(value).filter(Boolean);
      }
      if (typeof HTMLCollection !== 'undefined' && value instanceof HTMLCollection) {
        return Array.from(value).filter(Boolean);
      }
      return [value].filter(Boolean);
    };

    const addSkillInputs = normalizeElements(options.addSkillInputs);
    const addSkillButtons = normalizeElements(options.addSkillButtons);
    if (!allowSkillAdd || isReadOnly) {
      addSkillInputs.forEach(input => {
        if (input && typeof input.closest === 'function') {
          const group = input.closest('.form-group');
          if (group) {
            group.setAttribute('hidden', '');
          }
        }
        if (input) {
          input.disabled = true;
        }
      });
      addSkillButtons.forEach(button => {
        if (button && typeof button.closest === 'function') {
          const group = button.closest('.form-group');
          if (group) {
            group.setAttribute('hidden', '');
          }
        }
        if (button) {
          button.disabled = true;
        }
      });
    }

    const handleAttributeChange = (attrKey, input) => {
      if (!input || !attrKey) {
        return;
      }
      if (isReadOnly) {
        input.value = input.dataset.lastValue || input.value;
        return;
      }
      const previousValue = Number(input.dataset.lastValue);
      const nextValue = Number(input.value);
      if (!Number.isFinite(nextValue)) {
        input.value = Number.isFinite(previousValue) ? previousValue : attributeDefaultValue;
        return;
      }
      const levelValue = getLevelValue();
      const maxAttribute = evaluateMaxAttribute(levelValue);
      const floorValue = getAttributeFloorValue(attrKey);
      const minAllowed = Number.isFinite(floorValue)
        ? Math.max(attributeMinValue, floorValue)
        : attributeMinValue;
      const maxAllowed = Number.isFinite(maxAttribute)
        ? Math.max(maxAttribute, minAllowed)
        : minAllowed;
      if (nextValue < minAllowed || nextValue > maxAllowed) {
        setPointsWarning(attributePointsWarning, `Attributes must stay between ${minAllowed} and ${maxAllowed}.`);
        input.value = Number.isFinite(previousValue) ? previousValue : attributeDefaultValue;
        return;
      }
      state.attributes.values.set(attrKey, nextValue);
      updateAttributePoolDisplay();
      updateSkillPoolDisplay();
      const modifierEl = attributeGrid.querySelector(`.attribute-modifier[data-attr="${escapeSelector(attrKey)}"]`);
      if (modifierEl) {
        modifierEl.textContent = formatAttributeModifier(nextValue);
      }
      input.dataset.lastValue = String(nextValue);
    };

    const buildAttributeGrid = (definitions) => {
      if (!attributeGrid) {
        return;
      }
      state.attributes.definitions = definitions;
      state.attributes.values = new Map();
      state.attributes.inputElements = new Map();
      state.attributes.modifierElements = new Map();
      state.attributes.floorValues = new Map();
      attributeGrid.innerHTML = '';

      definitions.forEach(def => {
        const attrKey = def.key;
        const label = def.label || attrKey;
        const abbr = def.abbreviation || def.abbr || attrKey.slice(0, 3).toUpperCase();
        const description = def.description || '';

        const group = document.createElement('div');
        group.className = 'attribute-group';

        const header = document.createElement('div');
        header.className = 'attribute-header';

        const labelEl = document.createElement('label');
        labelEl.setAttribute('for', `attr-${attrKey}`);
        labelEl.textContent = label;

        const abbrEl = document.createElement('span');
        abbrEl.className = 'attribute-abbr';
        abbrEl.textContent = abbr;

        header.appendChild(labelEl);
        header.appendChild(abbrEl);

        const inputGroup = document.createElement('div');
        inputGroup.className = 'attribute-input-group';

        const input = document.createElement('input');
        input.type = 'number';
        input.id = `attr-${attrKey}`;
        input.name = `attributes.${attrKey}`;
        input.className = 'attribute-input';
        const maxAttribute = evaluateMaxAttribute(getLevelValue());
        const normalizedAttrKey = normalizeVariableKey(attrKey);
        const floorValue = attributeFloorValues.get(normalizedAttrKey);
        const minAllowed = Number.isFinite(floorValue)
          ? Math.max(attributeMinValue, floorValue)
          : attributeMinValue;
        const maxAllowed = Number.isFinite(maxAttribute)
          ? Math.max(Math.floor(maxAttribute), Math.floor(minAllowed))
          : Math.floor(minAllowed);
        input.min = String(minAllowed);
        input.max = String(maxAllowed);
        input.value = String(Number.isFinite(floorValue) ? floorValue : attributeDefaultValue);
        input.dataset.lastValue = String(input.value);
        input.disabled = isReadOnly;
        if (!isReadOnly) {
          input.addEventListener('change', () => handleAttributeChange(attrKey, input));
        }

        const modifier = document.createElement('span');
        modifier.className = 'attribute-modifier';
        modifier.dataset.attr = attrKey;
        modifier.textContent = formatAttributeModifier(Number(input.value));

        inputGroup.appendChild(input);
        inputGroup.appendChild(modifier);

        const help = document.createElement('span');
        help.className = 'help-text';
        help.textContent = description;

        group.appendChild(header);
        group.appendChild(inputGroup);
        group.appendChild(help);

        attributeGrid.appendChild(group);
        state.attributes.floorValues.set(normalizedAttrKey, Number.isFinite(floorValue) ? floorValue : attributeMinValue);
        state.attributes.values.set(attrKey, Number(input.value));
        state.attributes.inputElements.set(attrKey, input);
        state.attributes.modifierElements.set(attrKey, modifier);
      });

      if (!suspendPoolUpdates) {
        updateAttributePoolDisplay(getLevelValue());
      }
    };

    const adjustSkillValue = (name, delta) => {
      if (!state.skills.values.has(name)) {
        return;
      }
      if (isReadOnly) {
        return;
      }
      const current = Number(state.skills.values.get(name));
      const next = current + delta;
      const maxSkill = evaluateMaxSkill(getLevelValue());
      const floorValue = getSkillFloorValue(name);
      const minAllowed = Number.isFinite(floorValue)
        ? Math.max(1, floorValue)
        : 1;
      const maxSkillValue = Number.isFinite(maxSkill)
        ? Math.max(Math.floor(maxSkill), Math.floor(minAllowed))
        : Math.floor(minAllowed);
      if (delta < 0 && current <= minAllowed) {
        setPointsWarning(skillPointsWarning, `Skills cannot go below rank ${minAllowed}.`);
        return;
      }
      if (delta > 0 && next > maxSkillValue) {
        setPointsWarning(skillPointsWarning, `Skills cannot exceed rank ${maxSkillValue}.`);
        return;
      }
      state.skills.values.set(name, next);
      updateSkillPoolDisplay();
      updateAttributePoolDisplay();
      const valueSpan = skillsGrid.querySelector(`[data-skill-name="${escapeSelector(name)}"]`);
      if (valueSpan) {
        valueSpan.textContent = String(next);
      }
    };

    const buildSkillGrid = (skillNames, existingValues = null) => {
      if (!skillsGrid || !skillsSection) {
        return;
      }
      const names = normalizeSkillList(skillNames);
      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      state.skills.names = names;
      state.skills.floorValues = new Map();
      const valuesMap = new Map();
      if (existingValues instanceof Map) {
        for (const [key, value] of existingValues.entries()) {
          valuesMap.set(key, Number(value));
        }
      } else if (existingValues && typeof existingValues === 'object') {
        for (const [key, value] of Object.entries(existingValues)) {
          valuesMap.set(key, Number(value));
        }
      }
      state.skills.values = new Map();
      state.skills.pointsPerLevel = names.length ? Math.ceil(names.length / 5) : 0;
      skillsGrid.innerHTML = '';

      if (!names.length) {
        skillsSection.style.display = '';
        updateSkillPoolDisplay(getLevelValue());
        return;
      }
      skillsSection.style.display = '';

      names.forEach(name => {
        const normalizedName = normalizeVariableKey(name);
        const floorValue = skillFloorValues.get(normalizedName);
        const minAllowed = Number.isFinite(floorValue)
          ? Math.max(1, floorValue)
          : 1;
        state.skills.floorValues.set(normalizedName, minAllowed);
        const existing = valuesMap.has(name) ? valuesMap.get(name) : minAllowed;
        const safeValue = Number.isFinite(existing)
          ? Math.max(existing, minAllowed)
          : minAllowed;
        state.skills.values.set(name, safeValue);

        const card = document.createElement('div');
        card.className = 'skill-card';

        const header = document.createElement('div');
        header.className = 'skill-header';

        const nameEl = document.createElement('span');
        nameEl.className = 'skill-name';
        nameEl.textContent = name;
        header.appendChild(nameEl);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-secondary small skill-remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.setAttribute('aria-label', `Remove ${name}`);
        if (!allowSkillAdd || isReadOnly) {
          removeBtn.disabled = true;
          removeBtn.setAttribute('hidden', '');
        } else {
          removeBtn.addEventListener('click', () => removeSkill(name));
        }
        header.appendChild(removeBtn);

        const valueRow = document.createElement('div');
        valueRow.className = 'skill-value';

        const valueLabel = document.createElement('span');
        valueLabel.textContent = 'Rank: ';

        const valueSpan = document.createElement('span');
        valueSpan.className = 'skill-rank';
        valueSpan.dataset.skillName = name;
        valueSpan.textContent = String(safeValue);

        const buttonGroup = document.createElement('div');

        const decBtn = document.createElement('button');
        decBtn.type = 'button';
        decBtn.className = 'btn btn-secondary small';
        decBtn.textContent = '➖';
        decBtn.setAttribute('aria-label', `Decrease ${name}`);
        decBtn.disabled = isReadOnly;
        if (!isReadOnly) {
          decBtn.addEventListener('click', () => adjustSkillValue(name, -1));
        }

        const incBtn = document.createElement('button');
        incBtn.type = 'button';
        incBtn.className = 'btn btn-secondary small';
        incBtn.textContent = '➕';
        incBtn.setAttribute('aria-label', `Increase ${name}`);
        incBtn.disabled = isReadOnly;
        if (!isReadOnly) {
          incBtn.addEventListener('click', () => adjustSkillValue(name, 1));
        }

        buttonGroup.appendChild(decBtn);
        buttonGroup.appendChild(incBtn);

        valueRow.appendChild(valueLabel);
        valueRow.appendChild(valueSpan);
        valueRow.appendChild(buttonGroup);

        card.appendChild(header);
        card.appendChild(valueRow);
        skillsGrid.appendChild(card);
      });

      if (!suspendPoolUpdates) {
        updateSkillPoolDisplay(getLevelValue());
      }
    };

    const isSkillReferenced = (skillName) => {
      const normalized = normalizeVariableKey(skillName);
      return referencedSkillKeys.has(normalized);
    };

    const addSkill = (rawName) => {
      if (!allowSkillAdd || isReadOnly) {
        setSkillWarning('Adding skills is disabled.');
        return false;
      }
      if (!rawName) {
        setSkillWarning('Enter a skill name to add.');
        return false;
      }
      const trimmed = String(rawName).trim();
      if (!trimmed) {
        setSkillWarning('Enter a skill name to add.');
        return false;
      }
      const normalized = normalizeVariableKey(trimmed);
      const existingKeys = new Set(state.skills.names.map(name => normalizeVariableKey(name)));
      if (existingKeys.has(normalized)) {
        setSkillWarning('That skill already exists.');
        return false;
      }
      const existingValues = new Map(state.skills.values);
      const nextNames = [...state.skills.names, trimmed];
      buildSkillGrid(nextNames, existingValues);
      updateSkillPoolDisplay(getLevelValue());
      updateAttributePoolDisplay(getLevelValue());
      return true;
    };

    const removeSkill = (skillName) => {
      if (!allowSkillAdd || isReadOnly) {
        setSkillWarning('Removing skills is disabled.');
        return;
      }
      if (isSkillReferenced(skillName)) {
        setSkillWarning('This skill is referenced by a formula and cannot be removed.');
        return;
      }
      const existingValues = new Map(state.skills.values);
      existingValues.delete(skillName);
      const nextNames = state.skills.names.filter(name => name !== skillName);
      buildSkillGrid(nextNames, existingValues);
      updateSkillPoolDisplay(getLevelValue());
      updateAttributePoolDisplay(getLevelValue());
    };

    const syncAddSkillInputs = (source) => {
      if (!source) {
        return;
      }
      const value = source.value;
      addSkillInputs.forEach(input => {
        if (input !== source && input.value !== value) {
          input.value = value;
        }
      });
    };

    const handleAddSkillInput = (input) => {
      if (!input) {
        return;
      }
      const didAdd = addSkill(input.value);
      if (didAdd) {
        addSkillInputs.forEach(item => {
          item.value = '';
        });
        setPointsWarning(skillPointsWarning, '');
      }
    };

    if (allowSkillAdd && !isReadOnly) {
      addSkillInputs.forEach(input => {
        input.addEventListener('input', () => syncAddSkillInputs(input));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            handleAddSkillInput(input);
          }
        });
      });

      addSkillButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
          const input = addSkillInputs[index] || addSkillInputs[0];
          handleAddSkillInput(input);
        });
      });
    }

    const handleLevelChange = () => {
      if (!levelField) {
        return;
      }
      const nextLevel = Number(levelField.value);
      if (!Number.isFinite(nextLevel)) {
        return;
      }
      if (enableAttributes) {
        const maxAttribute = evaluateMaxAttribute(nextLevel);
        const maxAttributeValue = Math.floor(maxAttribute);
        attributeGrid.querySelectorAll('.attribute-input').forEach(input => {
          const key = input.name?.replace(/^attributes\./, '') || input.id?.replace(/^attr-/, '');
          const floorValue = key ? getAttributeFloorValue(key) : null;
          const minAllowed = Number.isFinite(floorValue)
            ? Math.max(attributeMinValue, floorValue)
            : attributeMinValue;
          const effectiveMax = Math.max(maxAttributeValue, Math.floor(minAllowed));
          input.min = String(minAllowed);
          input.max = String(effectiveMax);
          const current = Number(input.value);
          if (Number.isFinite(current) && current > effectiveMax) {
            input.value = String(effectiveMax);
            if (key) {
              state.attributes.values.set(key, effectiveMax);
              const modifierEl = attributeGrid.querySelector(`.attribute-modifier[data-attr="${escapeSelector(key)}"]`);
              if (modifierEl) {
                modifierEl.textContent = formatAttributeModifier(effectiveMax);
              }
            }
          }
        });
      }
      updateAttributePoolDisplay(nextLevel);
      updateSkillPoolDisplay(nextLevel);
      lastValidLevel = nextLevel;
    };

    const loadAttributeDefinitions = async () => {
      if (!enableAttributes || !attributeGrid) {
        return false;
      }
      try {
        const response = await fetch('/api/attributes');
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || `Failed to load attributes (${response.status})`);
        }
        const definitions = Object.entries(data.attributes || {}).map(([key, def]) => ({
          key,
          ...def
        }));
        if (!definitions.length) {
          throw new Error('No attribute definitions found.');
        }
        buildAttributeGrid(definitions);
        return true;
      } catch (error) {
        setPointsWarning(attributePointsWarning, `Attributes unavailable: ${error.message || error}`);
        attributeGrid.innerHTML = '';
        throw error;
      }
    };

    const initialize = async () => {
      if (levelField) {
        if (!String(levelField.value || '').trim()) {
          const fallbackLevel = Number(levelField?.dataset?.defaultValue ?? '');
          if (Number.isFinite(fallbackLevel)) {
            levelField.value = String(fallbackLevel);
            lastValidLevel = fallbackLevel;
          }
        }
        levelField.addEventListener('change', handleLevelChange);
      }
      suspendPoolUpdates = true;
      if (enableAttributes) {
        await loadAttributeDefinitions();
      }
      if (enableSkills) {
        buildSkillGrid(options.defaultSkillNames || []);
      }
      suspendPoolUpdates = false;
      if (enableAttributes) {
        const maxAttribute = evaluateMaxAttribute(getLevelValue());
        const maxAttributeValue = Math.floor(maxAttribute);
        attributeGrid.querySelectorAll('.attribute-input').forEach(input => {
          const key = input.name?.replace(/^attributes\./, '') || input.id?.replace(/^attr-/, '');
          const floorValue = key ? getAttributeFloorValue(key) : null;
          const minAllowed = Number.isFinite(floorValue)
            ? Math.max(attributeMinValue, floorValue)
            : attributeMinValue;
          const effectiveMax = Math.max(maxAttributeValue, Math.floor(minAllowed));
          input.min = String(minAllowed);
          input.max = String(effectiveMax);
        });
      }
      const initialLevel = getLevelValue();
      updateAttributePoolDisplay(initialLevel);
      updateSkillPoolDisplay(initialLevel);
    };

    const ready = initialize();

    const getAttributeValues = () => {
      const result = {};
      for (const [key, value] of state.attributes.values.entries()) {
        result[key] = value;
      }
      return result;
    };

    const getSkillValues = () => {
      const result = {};
      for (const [name, value] of state.skills.values.entries()) {
        result[name] = value;
      }
      return result;
    };

    const getPools = () => ({
      attributePool: enableAttributes ? state.attributes.poolRemaining : null,
      skillPool: enableSkills ? state.skills.poolRemaining : null
    });

    const refreshPools = (levelOverride = null) => ({
      attributePool: enableAttributes ? updateAttributePoolDisplay(levelOverride) : null,
      skillPool: enableSkills ? updateSkillPoolDisplay(levelOverride) : null
    });

    const hasSkills = () => enableSkills && state.skills.names.length > 0;
    const hasAttributes = () => enableAttributes && state.attributes.definitions.length > 0;

    const getUnspentSkillPoints = () => (hasSkills() ? state.skills.poolRemaining : null);

    const normalizeIncomingRecord = (value, label) => {
      if (value === null || value === undefined) {
        return new Map();
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`AttributeSkillAllocator expected ${label} to be an object.`);
      }
      const entries = new Map();
      for (const [rawKey, rawValue] of Object.entries(value)) {
        if (typeof rawKey !== 'string') {
          continue;
        }
        const trimmedKey = rawKey.trim();
        if (!trimmedKey) {
          continue;
        }
        const normalizedKey = normalizeVariableKey(trimmedKey);
        if (!normalizedKey) {
          continue;
        }
        if (!entries.has(normalizedKey)) {
          entries.set(normalizedKey, {
            key: trimmedKey,
            value: rawValue
          });
        }
      }
      return entries;
    };

    const buildAttributeLookup = () => {
      const lookup = new Map();
      const normalizeOptionalKey = (value) => {
        if (typeof value !== 'string') {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        return normalizeVariableKey(trimmed);
      };
      for (const definition of state.attributes.definitions) {
        const key = typeof definition?.key === 'string' ? definition.key.trim() : '';
        if (!key) {
          continue;
        }
        const candidates = [
          key,
          typeof definition?.label === 'string' ? definition.label : '',
          typeof definition?.abbreviation === 'string' ? definition.abbreviation : '',
          typeof definition?.abbr === 'string' ? definition.abbr : ''
        ];
        for (const candidate of candidates) {
          const normalized = normalizeOptionalKey(candidate);
          if (!normalized) {
            continue;
          }
          if (!lookup.has(normalized)) {
            lookup.set(normalized, key);
          }
        }
      }
      return lookup;
    };

    const applyLoadedValues = (values = {}) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error('AttributeSkillAllocator expected loaded values to be an object.');
      }
      const summary = {
        attributes: {
          applied: [],
          defaulted: [],
          ignored: []
        },
        skills: {
          applied: [],
          defaulted: [],
          ignored: []
        }
      };
      const levelValue = getLevelValue();
      const incomingAttributes = normalizeIncomingRecord(values.attributes, 'attributes');
      const incomingSkills = normalizeIncomingRecord(values.skills, 'skills');
      suspendPoolUpdates = true;
      try {
        if (enableAttributes && state.attributes.definitions.length) {
          const maxAttribute = evaluateMaxAttribute(levelValue);
          const maxAttributeValue = Math.floor(maxAttribute);
          const attributeLookup = buildAttributeLookup();
          const matchedAttributeKeys = new Set();

          for (const definition of state.attributes.definitions) {
            const attributeKey = typeof definition?.key === 'string' ? definition.key.trim() : '';
            if (!attributeKey) {
              continue;
            }
            const normalizedAttributeKey = normalizeVariableKey(attributeKey);
            const labelValue = typeof definition?.label === 'string' ? definition.label.trim() : '';
            const abbreviationValue = typeof definition?.abbreviation === 'string'
              ? definition.abbreviation.trim()
              : (typeof definition?.abbr === 'string' ? definition.abbr.trim() : '');
            const normalizedLabel = labelValue ? normalizeVariableKey(labelValue) : null;
            const normalizedAbbr = abbreviationValue ? normalizeVariableKey(abbreviationValue) : null;

            let matchedEntry = null;
            const candidateKeys = [normalizedAttributeKey, normalizedLabel, normalizedAbbr]
              .filter(Boolean);

            for (const candidateKey of candidateKeys) {
              const resolvedKey = attributeLookup.get(candidateKey) || null;
              if (!resolvedKey) {
                continue;
              }
              const incoming = incomingAttributes.get(candidateKey);
              if (incoming) {
                matchedEntry = incoming;
                matchedAttributeKeys.add(candidateKey);
                break;
              }
            }

            const rawValue = matchedEntry ? Number(matchedEntry.value) : NaN;
            const isValid = Number.isFinite(rawValue)
              && rawValue >= attributeMinValue;
            const nextValue = isValid ? rawValue : attributeDefaultValue;
            const floorValue = getAttributeFloorValue(attributeKey);
            const minAllowed = Number.isFinite(floorValue)
              ? Math.max(attributeMinValue, floorValue)
              : attributeMinValue;
            const clampedValue = Math.max(nextValue, minAllowed);
            const effectiveMax = Math.max(maxAttributeValue, Math.floor(minAllowed), Math.floor(clampedValue));

            state.attributes.values.set(attributeKey, clampedValue);

            const input = state.attributes.inputElements.get(attributeKey);
            if (input) {
              input.min = String(minAllowed);
              input.max = String(effectiveMax);
              input.value = String(clampedValue);
              input.dataset.lastValue = String(clampedValue);
            }
            const modifier = state.attributes.modifierElements.get(attributeKey);
            if (modifier) {
              modifier.textContent = formatAttributeModifier(clampedValue);
            }

            if (matchedEntry && isValid) {
              summary.attributes.applied.push(attributeKey);
            } else {
              summary.attributes.defaulted.push(attributeKey);
            }
          }

          for (const [normalizedKey, entry] of incomingAttributes.entries()) {
            if (!matchedAttributeKeys.has(normalizedKey)) {
              summary.attributes.ignored.push(entry.key);
            }
          }
        }

        if (enableSkills) {
          const matchedSkillKeys = new Set();
          const nextSkillValues = new Map();

          for (const skillName of state.skills.names) {
            const normalizedSkillName = normalizeVariableKey(skillName);
            const incoming = incomingSkills.get(normalizedSkillName);
            if (incoming) {
              matchedSkillKeys.add(normalizedSkillName);
            }
            const rawValue = incoming ? Number(incoming.value) : NaN;
            const floorValue = getSkillFloorValue(skillName);
            const minAllowed = Number.isFinite(floorValue)
              ? Math.max(1, floorValue)
              : 1;
            const isValid = Number.isFinite(rawValue)
              && rawValue >= 1;
            const nextValue = isValid ? Math.max(rawValue, minAllowed) : minAllowed;
            nextSkillValues.set(skillName, nextValue);
            if (incoming && isValid) {
              summary.skills.applied.push(skillName);
            } else {
              summary.skills.defaulted.push(skillName);
            }
          }

          for (const [normalizedKey, entry] of incomingSkills.entries()) {
            if (!matchedSkillKeys.has(normalizedKey)) {
              summary.skills.ignored.push(entry.key);
            }
          }

          buildSkillGrid(state.skills.names, nextSkillValues);
          setPointsWarning(skillPointsWarning, '');
        }
      } finally {
        suspendPoolUpdates = false;
      }
      updateAttributePoolDisplay(levelValue);
      updateSkillPoolDisplay(levelValue);
      return summary;
    };

    return {
      ready,
      getAttributeValues,
      getSkillValues,
      getPools,
      refreshPools,
      hasSkills,
      hasAttributes,
      getUnspentSkillPoints,
      applyLoadedValues
    };
  };

  window.AttributeSkillAllocator = {
    init
  };
})();
