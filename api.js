module.exports = function registerApiRoutes(scope) {
    if (!scope || typeof scope !== 'object' || !scope.app || typeof scope.app.use !== 'function') {
        throw new Error('registerApiRoutes requires a scope object containing an Express app');
    }

    if (!scope[Symbol.unscopables]) {
        Object.defineProperty(scope, Symbol.unscopables, {
            value: {},
            configurable: true
        });
    }

    with (scope) {
        // Log all API requests with received/finished timestamps
        app.use((req, res, next) => {
            if (!req.path || !req.path.startsWith('/api')) {
                return next();
            }

            const routeLabel = req.path;
            millisecond_timestamp = Date.now();
            console.log(`⬅️ ${routeLabel} request received at ${new Date().toISOString()}`);

            res.on('finish', () => {
                const duration = (Date.now() - millisecond_timestamp) / 1000;
                console.log(`✅ ${routeLabel} request finished at ${new Date().toISOString()} (Duration: ${duration}s)`);
            });

            next();
        });

        function parseAttackCheckResponse(responseText) {
            if (!responseText || typeof responseText !== 'string') {
                return null;
            }

            const trimmed = responseText.trim();
            if (!trimmed) {
                return null;
            }

            const matchAllAttacks = [...trimmed.matchAll(/<attack>([\s\S]*?)<\/attack>/gi)];
            if (!matchAllAttacks.length) {
                const normalized = trimmed.toLowerCase();
                if (normalized === 'n/a') {
                    return { attacks: [], hasAttack: false };
                }
                return null;
            }

            const extractTag = (block, tag) => {
                const tagRegex = new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i');
                const tagMatch = block.match(tagRegex);
                return tagMatch ? tagMatch[1].trim() : null;
            };

            const normalizeValue = (value) => {
                if (value === null || value === undefined) {
                    return null;
                }
                const text = String(value).trim();
                if (!text || text.toLowerCase() === 'n/a') {
                    return null;
                }
                return text;
            };

            const extractNestedTag = (block, parentTag, childTag) => {
                const parentRegex = new RegExp(`<${parentTag}>([\\s\\S]*?)<\\/${parentTag}>`, 'i');
                const parentMatch = block.match(parentRegex);
                if (!parentMatch) {
                    return null;
                }
                return extractTag(parentMatch[1], childTag);
            };

            const attacks = [];
            for (const [, rawBlock] of matchAllAttacks) {
                const attacker = normalizeValue(extractTag(rawBlock, 'attacker'));
                const defender = normalizeValue(extractTag(rawBlock, 'defender'));
                const ability = normalizeValue(extractTag(rawBlock, 'ability'));
                const weapon = normalizeValue(extractTag(rawBlock, 'weapon'));

                const attackSkill = normalizeValue(extractNestedTag(rawBlock, 'attackerInfo', 'attackSkill'));
                const damageAttribute = normalizeValue(extractNestedTag(rawBlock, 'attackerInfo', 'damageAttribute'));
                const defenseSkillLegacy = normalizeValue(extractNestedTag(rawBlock, 'defenderInfo', 'defenseSkill'));
                const evadeSkill = normalizeValue(extractNestedTag(rawBlock, 'defenderInfo', 'evadeSkill')) || defenseSkillLegacy;
                const deflectSkill = normalizeValue(extractNestedTag(rawBlock, 'defenderInfo', 'deflectSkill'));
                const toughnessAttribute = normalizeValue(extractNestedTag(rawBlock, 'defenderInfo', 'toughnessAttribute'));

                const hasNestedInfo = attackSkill || damageAttribute || evadeSkill || deflectSkill || toughnessAttribute;

                if (!attacker && !defender && !ability && !weapon && !hasNestedInfo) {
                    continue;
                }

                const attackEntry = { attacker, defender, ability, weapon };

                if (attackSkill || damageAttribute) {
                    attackEntry.attackerInfo = {
                        attackSkill: attackSkill || null,
                        damageAttribute: damageAttribute || null
                    };
                }

                if (evadeSkill || deflectSkill || toughnessAttribute || defenseSkillLegacy) {
                    const defenderInfo = {};
                    if (evadeSkill) {
                        defenderInfo.evadeSkill = evadeSkill;
                    }
                    if (defenseSkillLegacy && !evadeSkill) {
                        defenderInfo.defenseSkill = defenseSkillLegacy;
                    }
                    if (deflectSkill) {
                        defenderInfo.deflectSkill = deflectSkill;
                    }
                    if (toughnessAttribute) {
                        defenderInfo.toughnessAttribute = toughnessAttribute;
                    }
                    attackEntry.defenderInfo = defenderInfo;
                }

                attacks.push(attackEntry);
            }

            if (!attacks.length) {
                return { attacks: [], hasAttack: false };
            }

            return {
                attacks,
                hasAttack: true
            };
        }

        function logAttackCheck({ systemPrompt, generationPrompt, responseText }) {
            try {
                const logDir = path.join(__dirname, 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const logPath = path.join(logDir, `attack_check_${timestamp}.log`);
                const parts = [
                    '=== ATTACK CHECK SYSTEM PROMPT ===',
                    systemPrompt || '(none)',
                    '',
                    '=== ATTACK CHECK GENERATION PROMPT ===',
                    generationPrompt || '(none)',
                    '',
                    '=== ATTACK CHECK RESPONSE ===',
                    responseText || '(no response)',
                    ''
                ];
                fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
            } catch (error) {
                console.warn('Failed to log attack check:', error.message);
            }
        }

        async function runAttackCheckPrompt({ actionText, locationOverride }) {
            if (!actionText || !actionText.trim()) {
                return null;
            }

            if (!currentPlayer) {
                return null;
            }

            try {
                const baseContext = buildBasePromptContext({ locationOverride: locationOverride || null });
                const renderedTemplate = promptEnv.render('base-context.xml.njk', {
                    ...baseContext,
                    promptType: 'attack-check',
                    actionText
                });

                const parsedTemplate = parseXMLTemplate(renderedTemplate);
                if (!parsedTemplate.systemPrompt || !parsedTemplate.generationPrompt) {
                    console.warn('Attack template missing prompts, skipping attack analysis.');
                    return null;
                }

                const messages = [
                    { role: 'system', content: parsedTemplate.systemPrompt },
                    { role: 'user', content: parsedTemplate.generationPrompt }
                ];

                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: config.ai.model,
                    messages,
                    max_tokens: parsedTemplate.maxTokens || config.ai.maxTokens || 200,
                    temperature: typeof parsedTemplate.temperature === 'number' ? parsedTemplate.temperature : 0.3
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 45000
                });

                const attackResponse = response.data?.choices?.[0]?.message?.content || '';

                logAttackCheck({
                    systemPrompt: parsedTemplate.systemPrompt,
                    generationPrompt: parsedTemplate.generationPrompt,
                    responseText: attackResponse
                });

                if (!attackResponse.trim()) {
                    return null;
                }

                const safeResponse = Events.escapeHtml(attackResponse.trim());
                return {
                    raw: attackResponse,
                    html: safeResponse.replace(/\n/g, '<br>'),
                    structured: parseAttackCheckResponse(attackResponse)
                };
            } catch (error) {
                console.warn('Attack check failed:', error.message);
                return null;
            }
        }

        const RARITY_DAMAGE_RATINGS = {
            junk: 0.75,
            common: 1,
            fine: 1.25,
            superior: 1.5,
            masterwork: 2,
            rare: 2.5,
            epic: 3,
            legendary: 4
        };

        const BAREHANDED_KEYWORDS = new Set(['barehanded', 'bare hands', 'unarmed', 'fists']);

        const sanitizeNamedValue = (value) => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            const lowered = trimmed.toLowerCase();
            if (lowered === 'n/a' || lowered === 'none') {
                return null;
            }
            return trimmed;
        };

        const resolveSkillDefinition = (skillName) => {
            const sanitized = sanitizeNamedValue(skillName);
            if (!sanitized || !skills || typeof skills.entries !== 'function') {
                return null;
            }
            const direct = skills.get(sanitized) || skills.get(sanitized.toLowerCase());
            if (direct) {
                return direct;
            }
            const normalized = sanitized.toLowerCase();
            for (const [name, definition] of skills.entries()) {
                if (typeof name === 'string' && name.toLowerCase() === normalized) {
                    return definition;
                }
            }
            return null;
        };

        const resolveActorSkillInfo = (actor, skillName) => {
            const sanitized = sanitizeNamedValue(skillName);
            if (!actor || !sanitized) {
                return { key: null, value: 0 };
            }

            if (typeof actor.getSkillValue === 'function') {
                const directValue = actor.getSkillValue(sanitized);
                if (Number.isFinite(directValue)) {
                    return { key: sanitized, value: directValue };
                }
            }

            if (typeof actor.getSkills === 'function') {
                try {
                    const skillMap = actor.getSkills();
                    if (skillMap && typeof skillMap.entries === 'function') {
                        const normalized = sanitized.toLowerCase();
                        for (const [name, value] of skillMap.entries()) {
                            if (typeof name === 'string' && name.toLowerCase() === normalized && Number.isFinite(value)) {
                                return { key: name, value };
                            }
                        }
                    }
                } catch (_) {
                    // ignore inventory/skill access issues for non-player actors
                }
            }

            return { key: sanitized, value: 0 };
        };

        const resolveActorAttributeKey = (actor, attributeName) => {
            const sanitized = sanitizeNamedValue(attributeName);
            if (!actor || !sanitized || typeof actor.getAttributeNames !== 'function') {
                return null;
            }
            const normalized = sanitized.toLowerCase();
            try {
                for (const name of actor.getAttributeNames()) {
                    if (typeof name === 'string' && name.toLowerCase() === normalized) {
                        return name;
                    }
                }
            } catch (_) {
                // Defensive: actor may not expose attribute list
            }
            return null;
        };

        const resolveActorAttributeInfo = (actor, attributeName) => {
            const sanitized = sanitizeNamedValue(attributeName);
            if (!actor || !sanitized) {
                return { key: null, modifier: 0 };
            }
            const key = resolveActorAttributeKey(actor, sanitized) || sanitized;
            if (typeof actor.getAttributeModifier === 'function') {
                try {
                    const modifier = actor.getAttributeModifier(key);
                    return {
                        key,
                        modifier: Number.isFinite(modifier) ? modifier : 0
                    };
                } catch (_) {
                    return { key, modifier: 0 };
                }
            }
            return { key, modifier: 0 };
        };

        const resolveWeaponThing = (attacker, weaponName) => {
            const sanitized = sanitizeNamedValue(weaponName);
            const normalized = sanitized ? sanitized.toLowerCase() : '';
            if (sanitized && Thing && typeof Thing.getByName === 'function') {
                const byName = Thing.getByName(sanitized);
                if (byName) {
                    return byName;
                }
            }

            if (attacker && typeof attacker.getInventoryItems === 'function' && sanitized) {
                try {
                    const items = attacker.getInventoryItems();
                    if (Array.isArray(items)) {
                        for (const item of items) {
                            if (item && typeof item.name === 'string' && item.name.trim().toLowerCase() === normalized) {
                                return item;
                            }
                        }
                    }
                } catch (_) {
                    // ignore inventory access issues
                }
            }

            if (attacker && typeof attacker.getEquippedItemIdForType === 'function') {
                try {
                    const equippedId = attacker.getEquippedItemIdForType('weapon');
                    if (equippedId) {
                        const byId = Thing.getById(equippedId);
                        if (byId) {
                            return byId;
                        }
                    }
                } catch (_) {
                    // ignore equip lookup issues
                }
            }

            return null;
        };

        const resolveWeaponData = (attacker, weaponName) => {
            const fallbackName = sanitizeNamedValue(weaponName) || 'Barehanded';
            const normalizedName = fallbackName.toLowerCase();
            const weaponThing = resolveWeaponThing(attacker, fallbackName);

            let weaponLevel = Number.isFinite(weaponThing?.level) ? weaponThing.level : null;
            if (!Number.isFinite(weaponLevel)) {
                weaponLevel = Number.isFinite(attacker?.level) ? attacker.level : 1;
            }
            weaponLevel = Math.max(1, weaponLevel || 1);

            const rarity = sanitizeNamedValue(weaponThing?.rarity);
            let rating = rarity ? RARITY_DAMAGE_RATINGS[rarity.toLowerCase()] : null;
            if (!rating) {
                if (BAREHANDED_KEYWORDS.has(normalizedName)) {
                    rating = 0.5;
                } else {
                    rating = RARITY_DAMAGE_RATINGS.common;
                }
            }

            const baseDamage = 10 + weaponLevel * rating;

            return {
                thingId: weaponThing?.id || null,
                name: weaponThing?.name || fallbackName,
                level: weaponLevel,
                rarity: rarity || null,
                rating,
                baseDamage
            };
        };

        const computeAttackOutcome = ({ attackEntry, attacker, defender, weaponName }) => {
            if (!attackEntry || !attacker) {
                return null;
            }

            const attackerInfo = attackEntry.attackerInfo || {};
            const defenderInfo = attackEntry.defenderInfo || {};

            const attackSkillName = sanitizeNamedValue(attackerInfo.attackSkill);
            const damageAttributeName = sanitizeNamedValue(attackerInfo.damageAttribute);
            const attackSkillInfo = resolveActorSkillInfo(attacker, attackSkillName);
            const attackSkillValue = Number.isFinite(attackSkillInfo.value) ? attackSkillInfo.value : 0;

            let attackAttributeName = null;
            const skillDefinition = attackSkillInfo.key ? resolveSkillDefinition(attackSkillInfo.key) : null;
            if (skillDefinition && typeof skillDefinition.attribute === 'string' && skillDefinition.attribute.trim()) {
                attackAttributeName = skillDefinition.attribute;
            }
            if (!attackAttributeName && typeof attackerInfo.attackAttribute === 'string') {
                const sanitized = sanitizeNamedValue(attackerInfo.attackAttribute);
                if (sanitized) {
                    attackAttributeName = sanitized;
                }
            }
            if (!attackAttributeName && damageAttributeName) {
                attackAttributeName = damageAttributeName;
            }

            const attackAttributeInfo = resolveActorAttributeInfo(attacker, attackAttributeName);
            const damageAttributeInfo = damageAttributeName
                ? resolveActorAttributeInfo(attacker, damageAttributeName)
                : attackAttributeInfo;

            const rollResult = diceModule && typeof diceModule.rollDice === 'function'
                ? diceModule.rollDice('1d20')
                : { total: Math.floor(Math.random() * 20) + 1, detail: '1d20 (fallback)' };
            const dieRoll = Number.isFinite(rollResult.total) ? rollResult.total : Math.floor(Math.random() * 20) + 1;

            const defenseCandidates = [];
            const addDefenseCandidate = (name, source) => {
                const sanitized = sanitizeNamedValue(name);
                if (sanitized) {
                    defenseCandidates.push({ name: sanitized, source });
                }
            };
            addDefenseCandidate(defenderInfo.evadeSkill, 'evade');
            addDefenseCandidate(defenderInfo.deflectSkill, 'deflect');
            addDefenseCandidate(defenderInfo.defenseSkill, 'defense');

            if (!defenseCandidates.length && defender) {
                addDefenseCandidate('Evade', 'fallback');
                addDefenseCandidate('Deflect', 'fallback');
            }

            let bestDefense = { name: null, value: 0, source: null };
            if (defender) {
                for (const candidate of defenseCandidates) {
                    const info = resolveActorSkillInfo(defender, candidate.name);
                    const value = Number.isFinite(info.value) ? info.value : 0;
                    if (value > bestDefense.value) {
                        bestDefense = {
                            name: info.key || candidate.name,
                            value,
                            source: candidate.source
                        };
                    }
                }
            }

            const defenderLevel = Number.isFinite(defender?.level) ? defender.level : 0;
            const hitDifficulty = 10 + defenderLevel + (Number.isFinite(bestDefense.value) ? bestDefense.value : 0);

            const hitRollTotal = dieRoll + attackSkillValue + attackAttributeInfo.modifier;
            const hitDegreeRaw = (hitRollTotal - hitDifficulty) / 5;
            const hitDegree = Number.isFinite(hitDegreeRaw) ? Math.round(hitDegreeRaw * 100) / 100 : 0;
            const hit = hitRollTotal >= hitDifficulty;

            const weaponData = resolveWeaponData(attacker, weaponName);

            let attackDamage = 0;
            let rawDamage = 0;
            if (hit && hitDegreeRaw >= 0) {
                rawDamage = 1 + Math.round(
                    weaponData.baseDamage * (0.5 + hitDegreeRaw) + damageAttributeInfo.modifier
                );
                attackDamage = rawDamage > 0 ? rawDamage : 0;
            }

            const targetHealth = Number.isFinite(defender?.health) ? defender.health : null;
            const targetMaxHealth = Number.isFinite(defender?.maxHealth) ? defender.maxHealth : null;
            const rawRemainingHealth = targetHealth !== null ? targetHealth - attackDamage : null;
            const remainingHealth = rawRemainingHealth !== null ? Math.max(0, rawRemainingHealth) : null;
            const defeated = rawRemainingHealth !== null && attackDamage > 0 && rawRemainingHealth <= 0;
            const killed = defeated && Number.isFinite(targetMaxHealth)
                ? attackDamage >= targetHealth + targetMaxHealth
                : false;

            const toughnessAttributeName = sanitizeNamedValue(defenderInfo.toughnessAttribute);
            const toughnessInfo = toughnessAttributeName && defender
                ? resolveActorAttributeInfo(defender, toughnessAttributeName)
                : { key: toughnessAttributeName || null, modifier: 0 };

            return {
                hit,
                hitRoll: {
                    die: dieRoll,
                    total: hitRollTotal,
                    detail: rollResult.detail || null,
                    attackSkill: {
                        name: attackSkillInfo.key,
                        value: attackSkillValue
                    },
                    attackAttribute: {
                        name: attackAttributeInfo.key,
                        modifier: attackAttributeInfo.modifier
                    }
                },
                difficulty: {
                    value: hitDifficulty,
                    base: 10,
                    defenderLevel,
                    defenseSkill: bestDefense.name ? {
                        name: bestDefense.name,
                        value: bestDefense.value,
                        source: bestDefense.source
                    } : null
                },
                hitDegree,
                damage: {
                    total: attackDamage,
                    raw: rawDamage,
                    baseWeaponDamage: weaponData.baseDamage,
                    weaponLevel: weaponData.level,
                    weaponRating: weaponData.rating,
                    weaponName: weaponData.name,
                    weaponRarity: weaponData.rarity,
                    damageAttribute: {
                        name: damageAttributeInfo.key,
                        modifier: damageAttributeInfo.modifier
                    }
                },
                target: {
                    name: sanitizeNamedValue(attackEntry.defender) || null,
                    startingHealth: targetHealth,
                    remainingHealth,
                    rawRemainingHealth,
                    maxHealth: targetMaxHealth,
                    defeated,
                    killed,
                    toughness: {
                        name: toughnessInfo.key,
                        modifier: toughnessInfo.modifier
                    }
                }
            };
        };

        function buildAttackContextForPlausibility({ attackCheckInfo, player, location }) {
            if (!attackCheckInfo || !attackCheckInfo.structured) {
                return null;
            }

            const structured = attackCheckInfo.structured;
            const attacks = Array.isArray(structured.attacks) ? structured.attacks : [];
            if (!attacks.length) {
                return null;
            }

            const normalize = (value) => typeof value === 'string' ? value.trim().toLowerCase() : null;
            const playerName = normalize(player?.name);

            const playerAttack = attacks.find(entry => {
                if (!entry || typeof entry.attacker !== 'string') {
                    return false;
                }
                const attackerName = normalize(entry.attacker);
                if (!attackerName) {
                    return false;
                }
                if (attackerName === 'player' || attackerName === 'the player' || attackerName === 'you') {
                    return true;
                }
                return playerName && attackerName === playerName;
            });

            if (!playerAttack) {
                return null;
            }

            const targetName = typeof playerAttack.defender === 'string' ? playerAttack.defender.trim() : '';
            const targetActor = targetName ? findActorByName(targetName) : null;

            const collectStatusEffects = (actor) => {
                if (!actor || typeof actor.getStatusEffects !== 'function') {
                    return [];
                }
                return actor.getStatusEffects()
                    .map(effect => {
                        if (!effect) {
                            return null;
                        }
                        if (typeof effect === 'string') {
                            return effect.trim() || null;
                        }
                        if (typeof effect.description === 'string' && effect.description.trim()) {
                            return effect.description.trim();
                        }
                        if (typeof effect.name === 'string' && effect.name.trim()) {
                            return effect.name.trim();
                        }
                        return null;
                    })
                    .filter(Boolean);
            };

            const collectGearNames = (actor) => {
                if (!actor || typeof actor.getGear !== 'function') {
                    return [];
                }
                const gear = actor.getGear();
                if (!gear || typeof gear !== 'object') {
                    return [];
                }
                const names = [];
                for (const slotInfo of Object.values(gear)) {
                    if (!slotInfo || !slotInfo.itemId || typeof slotInfo.itemId !== 'string') {
                        continue;
                    }
                    const thing = Thing.getById(slotInfo.itemId);
                    if (thing && thing.name) {
                        names.push(thing.name);
                    } else {
                        names.push(slotInfo.itemId);
                    }
                }
                return names;
            };

            const attackerWeapon = (() => {
                if (typeof playerAttack.weapon === 'string') {
                    const trimmed = playerAttack.weapon.trim();
                    if (trimmed && trimmed.toLowerCase() !== 'n/a') {
                        return trimmed;
                    }
                }
                if (player && typeof player.getEquippedItemIdForType === 'function') {
                    const weaponId = player.getEquippedItemIdForType('weapon');
                    if (weaponId) {
                        const item = Thing.getById(weaponId);
                        if (item && item.name) {
                            return item.name;
                        }
                        return weaponId;
                    }
                }
                return 'Barehanded';
            })();

            const attackerAbility = (() => {
                if (typeof playerAttack.ability === 'string') {
                    const trimmed = playerAttack.ability.trim();
                    if (trimmed && trimmed.toLowerCase() !== 'n/a') {
                        return trimmed;
                    }
                }
                return 'N/A';
            })();

            const attackerStatus = collectStatusEffects(player);
            const targetStatus = collectStatusEffects(targetActor);
            const targetGear = collectGearNames(targetActor);

            const computedOutcome = computeAttackOutcome({
                attackEntry: playerAttack,
                attacker: player,
                defender: targetActor,
                weaponName: attackerWeapon
            });

            if (computedOutcome) {
                playerAttack.outcome = computedOutcome;
                attackCheckInfo.computedOutcome = computedOutcome;
            }

            const targetContext = {
                name: targetName || null,
                level: typeof targetActor?.level === 'number' ? targetActor.level : 'unknown',
                gear: targetGear,
                statusEffects: targetStatus
            };

            if (Number.isFinite(targetActor?.health)) {
                targetContext.health = targetActor.health;
            }
            if (Number.isFinite(targetActor?.maxHealth)) {
                targetContext.maxHealth = targetActor.maxHealth;
            }
            if (computedOutcome?.target) {
                if (computedOutcome.target.remainingHealth !== null && computedOutcome.target.remainingHealth !== undefined) {
                    targetContext.remainingHealth = computedOutcome.target.remainingHealth;
                }
                if (computedOutcome.target.rawRemainingHealth !== null && computedOutcome.target.rawRemainingHealth !== undefined) {
                    targetContext.rawRemainingHealth = computedOutcome.target.rawRemainingHealth;
                }
                if (typeof computedOutcome.target.defeated === 'boolean') {
                    targetContext.defeated = computedOutcome.target.defeated;
                }
                if (typeof computedOutcome.target.killed === 'boolean') {
                    targetContext.killed = computedOutcome.target.killed;
                }
                if (computedOutcome.target.toughness) {
                    targetContext.toughness = computedOutcome.target.toughness;
                }
            }

            const attackerContext = {
                level: typeof player?.level === 'number' ? player.level : 'unknown',
                weapon: attackerWeapon,
                ability: attackerAbility,
                statusEffects: attackerStatus
            };

            if (computedOutcome?.damage) {
                attackerContext.weaponInfo = {
                    name: computedOutcome.damage.weaponName,
                    rating: computedOutcome.damage.weaponRating,
                    level: computedOutcome.damage.weaponLevel,
                    baseDamage: computedOutcome.damage.baseWeaponDamage,
                    rarity: computedOutcome.damage.weaponRarity || null
                };
            }

            return {
                isAttack: true,
                attacker: attackerContext,
                target: targetContext,
                attackEntry: playerAttack,
                outcome: computedOutcome || null
            };
        }

        // Chat API endpoint
        app.post('/api/chat', async (req, res) => {
            try {
                const { messages } = req.body;

                if (!messages) {
                    return res.status(400).json({ error: 'Missing messages parameter' });
                }

                // Store user message in history (last message from the request)
                const userMessage = messages[messages.length - 1];
                if (userMessage && userMessage.role === 'user') {
                    chatHistory.push({
                        role: 'user',
                        content: userMessage.content,
                        timestamp: new Date().toISOString()
                    });
                }

                let location = null;
                let plausibilityInfo = null;
                let attackCheckInfo = null;
                let attackContextForPlausibility = null;
                let actionResolution = null;

                const originalUserContent = typeof userMessage?.content === 'string' ? userMessage.content : '';
                const firstVisibleIndex = typeof originalUserContent === 'string' ? originalUserContent.search(/\S/) : -1;
                const trimmedVisibleContent = firstVisibleIndex > -1
                    ? originalUserContent.slice(firstVisibleIndex)
                    : '';
                const isForcedEventAction = firstVisibleIndex > -1 && trimmedVisibleContent.startsWith('!!');
                const forcedEventText = isForcedEventAction
                    ? trimmedVisibleContent.slice(2).replace(/^\s+/, '')
                    : null;
                const isCreativeModeAction = !isForcedEventAction
                    && firstVisibleIndex > -1
                    && trimmedVisibleContent.startsWith('!');
                const creativeActionText = isCreativeModeAction
                    ? trimmedVisibleContent.slice(1).replace(/^\s+/, '')
                    : null;

                const sanitizedUserContent = isForcedEventAction
                    ? (forcedEventText || '')
                    : (isCreativeModeAction ? (creativeActionText || '') : originalUserContent);

                let finalMessages = messages;
                if (userMessage && sanitizedUserContent !== undefined && sanitizedUserContent !== userMessage.content) {
                    finalMessages = messages.map(msg => {
                        if (msg === userMessage) {
                            return { ...msg, content: sanitizedUserContent };
                        }
                        return msg;
                    });
                }

                const baseDebugInfo = {
                    usedForcedEventAction: Boolean(isForcedEventAction)
                };
                let debugInfo = null;

                // Add the location with the id of currentPlayer.curentLocation to the player context if available
                if (currentPlayer && currentPlayer.currentLocation) {
                    location = Location.get(currentPlayer.currentLocation);
                }

                if (currentPlayer && userMessage && userMessage.role === 'user') {
                    try {
                        const tickResult = tickStatusEffectsForAction({ player: currentPlayer, location });
                        if (tickResult) {
                            location = tickResult.location || location;
                        }
                    } catch (tickError) {
                        console.warn('Failed to update status effects before action:', tickError.message);
                    }

                    if (!isCreativeModeAction && !isForcedEventAction) {
                        try {
                            const attackActionText = typeof sanitizedUserContent === 'string'
                                ? sanitizedUserContent
                                : (userMessage?.content || '');
                            attackCheckInfo = await runAttackCheckPrompt({
                                actionText: attackActionText,
                                locationOverride: location || null
                            });
                            attackContextForPlausibility = buildAttackContextForPlausibility({
                                attackCheckInfo,
                                player: currentPlayer,
                                location
                            });
                        } catch (attackError) {
                            console.warn('Failed to execute attack check:', attackError.message);
                        }

                        try {
                            plausibilityInfo = await runPlausibilityCheck({
                                actionText: userMessage.content,
                                locationId: currentPlayer.currentLocation || null,
                                attackContext: attackContextForPlausibility
                            });
                            if (plausibilityInfo?.structured) {
                                actionResolution = resolveActionOutcome({
                                    plausibility: plausibilityInfo.structured,
                                    player: currentPlayer
                                });
                            }
                        } catch (plausibilityError) {
                            console.warn('Failed to execute plausibility check:', plausibilityError.message);
                        }
                    }
                }

                const attackDebugData = {
                    attackCheck: attackCheckInfo,
                    attackContext: attackContextForPlausibility
                };

                const plausibilityType = (plausibilityInfo?.structured?.type || '').trim().toLowerCase();
                if (!isForcedEventAction && !isCreativeModeAction && plausibilityType === 'rejected') {
                    const rejectionReasonRaw = plausibilityInfo?.structured?.reason || 'Action rejected.';
                    const rejectionReason = typeof rejectionReasonRaw === 'string' && rejectionReasonRaw.trim().length
                        ? rejectionReasonRaw.trim()
                        : 'Action rejected.';

                    const responseData = {
                        response: rejectionReason
                    };

                    if (attackCheckInfo) {
                        responseData.attackCheck = attackCheckInfo;
                    }

                    if (plausibilityInfo?.html) {
                        responseData.plausibility = plausibilityInfo.html;
                    }

                    const rejectionDebug = {
                        ...(debugInfo || baseDebugInfo),
                        ...attackDebugData,
                        usedPlayerTemplate: false,
                        usedCreativeTemplate: false,
                        plausibilityType: 'Rejected',
                        rejectionReason
                    };

                    responseData.debug = rejectionDebug;

                    chatHistory.push({
                        role: 'assistant',
                        content: rejectionReason,
                        timestamp: new Date().toISOString()
                    });

                    res.json(responseData);
                    return;
                }

                // If we have a current player, use the player action template for the system message
                if (isForcedEventAction && !debugInfo) {
                    debugInfo = {
                        ...baseDebugInfo,
                        usedPlayerTemplate: false,
                        usedCreativeTemplate: false,
                        forcedEventText,
                        reason: 'Forced event action bypassed plausibility and templating.'
                    };
                }

                if (!isForcedEventAction && currentPlayer && userMessage && userMessage.role === 'user') {
                    try {
                        const baseContext = buildBasePromptContext({ locationOverride: location });
                        const templateName = 'base-context.xml.njk';

                        const promptVariables = {
                            ...baseContext,
                            promptType: isCreativeModeAction ? 'creative-mode-action' : 'player-action',
                            actionText: isCreativeModeAction ? (creativeActionText || '') : sanitizedUserContent
                        };

                        if (!isCreativeModeAction) {
                            promptVariables.success_or_failure = actionResolution?.label || 'success';
                        }

                        const renderedPrompt = promptEnv.render(templateName, promptVariables);

                        const promptData = parseXMLTemplate(renderedPrompt);

                        if (!promptData.systemPrompt) {
                            throw new Error('Action template missing system prompt.');
                        }

                        const systemMessage = {
                            role: 'system',
                            content: String(promptData.systemPrompt).trim()
                        };

                        // Replace any existing system message or add new one
                        const nonSystemMessages = messages
                            .filter(msg => msg.role !== 'system')
                            .map(msg => {
                                if (isCreativeModeAction && msg === userMessage) {
                                    return { ...msg, content: creativeActionText || '' };
                                }
                                return msg;
                            });

                        finalMessages = [systemMessage, ...nonSystemMessages];

                        // Append promptData.generationPrompt to finalMessages
                        if (promptData.generationPrompt) {
                            finalMessages.push({
                                role: 'user',
                                content: promptData.generationPrompt
                            });
                        }

                        // Store debug information
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: !isCreativeModeAction,
                            usedCreativeTemplate: isCreativeModeAction,
                            playerName: currentPlayer.name,
                            playerDescription: currentPlayer.description,
                            systemMessage: systemMessage.content,
                            generationPrompt: promptData.generationPrompt || null,
                            rawTemplate: renderedPrompt
                        };

                        if (isCreativeModeAction) {
                            debugInfo.creativeActionText = creativeActionText || '';
                        }
                        if (!isCreativeModeAction) {
                            debugInfo.actionOutcomeLabel = actionResolution?.label || 'success';
                        }

                        if (isCreativeModeAction) {
                            console.log('Using creative mode action template for:', currentPlayer.name);
                        } else {
                            console.log('Using player action template for:', currentPlayer.name);
                        }
                    } catch (templateError) {
                        console.error('Error rendering player action template:', templateError);
                        // Fall back to original messages if template fails
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: isCreativeModeAction,
                            error: templateError.message
                        };
                    }
                } else {
                    if (debugInfo) {
                        const existingDebugInfo = debugInfo;
                        debugInfo = {
                            ...existingDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: false,
                            reason: existingDebugInfo.reason || (currentPlayer ? 'No user message detected' : 'No current player set')
                        };
                    } else {
                        debugInfo = {
                            ...baseDebugInfo,
                            usedPlayerTemplate: false,
                            usedCreativeTemplate: false,
                            reason: currentPlayer ? 'No user message detected' : 'No current player set'
                        };
                    }
                }

                if (debugInfo) {
                    debugInfo = { ...debugInfo, ...attackDebugData };
                }

                let forcedEventResult = null;
                if (isForcedEventAction && forcedEventText && forcedEventText.trim()) {
                    try {
                        forcedEventResult = await Events.runEventChecks({ textToCheck: forcedEventText });
                        if (forcedEventResult && debugInfo) {
                            debugInfo.forcedEventStructured = forcedEventResult.structured || null;
                        }
                    } catch (forcedEventError) {
                        console.warn('Failed to run forced event checks:', forcedEventError.message);
                    }
                }

                if (isForcedEventAction) {
                    const responseData = {
                        response: `[Forced] ${forcedEventText || 'Event processed.'}`
                    };

                    if (forcedEventResult) {
                        if (forcedEventResult.html) {
                            responseData.eventChecks = forcedEventResult.html;
                        }
                        if (forcedEventResult.structured) {
                            responseData.events = forcedEventResult.structured;
                        }
                    }

                    if (debugInfo) {
                        responseData.debug = {
                            ...debugInfo,
                            actionResolution: null,
                            plausibilityStructured: null,
                            eventStructured: forcedEventResult?.structured || null
                        };
                    }

                    res.json(responseData);
                    return;
                }

                // Use configuration from config.yaml
                const endpoint = config.ai.endpoint;
                const apiKey = config.ai.apiKey;
                const model = config.ai.model;

                // Prepare the request to the OpenAI-compatible API
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: model,
                    messages: finalMessages,
                    max_tokens: config.ai.maxTokens || 1000,
                    temperature: config.ai.temperature || 0.7
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000 // 60 second timeout
                });

                if (response.data && response.data.choices && response.data.choices.length > 0) {
                    const aiResponse = response.data.choices[0].message.content;

                    // Store AI response in history
                    chatHistory.push({
                        role: 'assistant',
                        content: aiResponse,
                        timestamp: new Date().toISOString()
                    });

                    // Include debug information in response for development
                    const responseData = {
                        response: aiResponse
                    };

                    // Add debug info if available
                    if (debugInfo) {
                        debugInfo.actionResolution = actionResolution;
                        debugInfo.plausibilityStructured = plausibilityInfo?.structured || null;
                        responseData.debug = debugInfo;
                    }

                    if (actionResolution) {
                        responseData.actionResolution = actionResolution;
                    }

                    if (attackCheckInfo) {
                        responseData.attackCheck = attackCheckInfo;
                    }

                    let eventResult = null;
                    if (isForcedEventAction) {
                        eventResult = forcedEventResult;
                    } else {
                        try {
                            eventResult = await Events.runEventChecks({ textToCheck: aiResponse });
                        } catch (eventError) {
                            console.warn('Failed to run event checks:', eventError.message);
                        }
                    }

                    if (eventResult) {
                        if (eventResult.html) {
                            responseData.eventChecks = eventResult.html;
                        }
                        if (eventResult.structured) {
                            responseData.events = eventResult.structured;
                            if (debugInfo) {
                                debugInfo.eventStructured = eventResult.structured;
                            }
                            if (currentPlayer && currentPlayer.currentLocation) {
                                try {
                                    location = Location.get(currentPlayer.currentLocation) || location;
                                } catch (_) {
                                    // ignore lookup failures here
                                }
                            }
                        }
                    }

                    if (plausibilityInfo && plausibilityInfo.html) {
                        responseData.plausibility = plausibilityInfo.html;
                    }

                    res.json(responseData);
                } else {
                    res.status(500).json({ error: 'Invalid response from AI API' });
                }

            } catch (error) {
                console.error('Chat API error:', error);

                if (error.response) {
                    // API returned an error
                    const statusCode = error.response.status;
                    const errorMessage = error.response.data?.error?.message || 'API request failed';
                    res.status(statusCode).json({ error: `API Error (${statusCode}): ${errorMessage}` });
                } else if (error.code === 'ECONNABORTED') {
                    // Timeout
                    res.status(408).json({ error: 'Request timeout - AI API took too long to respond' });
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    // Connection issues
                    res.status(503).json({ error: 'Cannot connect to AI API - check your endpoint URL' });
                } else {
                    // Other errors
                    res.status(500).json({ error: `Request failed: ${error.message}` });
                }
            }
        });

        // Chat history API endpoint
        app.get('/api/chat/history', (req, res) => {
            res.json({
                history: chatHistory,
                count: chatHistory.length
            });
        });

        // Clear chat history API endpoint (for testing/reset)
        app.delete('/api/chat/history', (req, res) => {
            chatHistory = [];
            res.json({
                message: 'Chat history cleared',
                count: chatHistory.length
            });
        });

        // Player management API endpoints

        // Create a new player
        app.post('/api/player', async (req, res) => {
            try {
                const { name, attributes, level } = req.body;

                const player = new Player({
                    name: name || 'New Player',
                    attributes: attributes || {},
                    level: level || 1
                });

                players.set(player.id, player);
                currentPlayer = player;

                try {
                    const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
                    const region = location ? findRegionByLocationId(location.id) : null;
                    await generateInventoryForCharacter({
                        character: player,
                        characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                        region,
                        location
                    });
                } catch (inventoryError) {
                    console.warn('Failed to generate player inventory:', inventoryError);
                }

                res.json({
                    success: true,
                    player: player.getStatus(),
                    message: 'Player created successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get current player status
        app.get('/api/player', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            res.json({
                success: true,
                player: currentPlayer.getStatus()
            });
        });

        app.get('/api/player/party', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const memberIds = currentPlayer.getPartyMembers();
                const members = memberIds
                    .map(id => players.get(id))
                    .filter(Boolean)
                    .map(member => member.getStatus());

                res.json({
                    success: true,
                    members,
                    count: members.length
                });
            } catch (error) {
                console.error('Error retrieving party members:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/player/party', (req, res) => {
            try {
                const { ownerId, memberId } = req.body || {};

                if (!ownerId || typeof ownerId !== 'string') {
                    return res.status(400).json({ success: false, error: 'ownerId is required' });
                }
                if (!memberId || typeof memberId !== 'string') {
                    return res.status(400).json({ success: false, error: 'memberId is required' });
                }

                const owner = players.get(ownerId);
                const member = players.get(memberId);

                if (!owner) {
                    return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
                }
                if (!member) {
                    return res.status(404).json({ success: false, error: `Member player '${memberId}' not found` });
                }

                const added = owner.addPartyMember(memberId);
                if (!added) {
                    return res.json({
                        success: true,
                        message: 'Player already in party',
                        members: owner.getPartyMembers()
                    });
                }

                try {
                    // Image generation is now client-driven; ensure placeholders render on the frontend.
                    // We don't need to generate party inventory item images, as they aren't visible anywhere.
                    /*
                    const inventoryItems = typeof member?.getInventoryItems === 'function' ? member.getInventoryItems() : [];
                    for (const item of inventoryItems) {
                        if (!shouldGenerateThingImage(item)) {
                            continue;
                        }
                        generateThingImage(item).catch(itemError => {
                            console.warn('Failed to generate image for party item:', itemError.message);
                        });
                    }
                    */
                } catch (partyImageError) {
                    console.warn('Failed to schedule party imagery updates:', partyImageError.message);
                }

                res.json({
                    success: true,
                    message: `Added ${member.name} to ${owner.name}'s party`,
                    members: owner.getPartyMembers()
                });
            } catch (error) {
                console.error('Error adding party member:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.delete('/api/player/party', (req, res) => {
            try {
                const { ownerId, memberId } = req.body || {};

                if (!ownerId || typeof ownerId !== 'string') {
                    return res.status(400).json({ success: false, error: 'ownerId is required' });
                }
                if (!memberId || typeof memberId !== 'string') {
                    return res.status(400).json({ success: false, error: 'memberId is required' });
                }

                const owner = players.get(ownerId);

                if (!owner) {
                    return res.status(404).json({ success: false, error: `Owner player '${ownerId}' not found` });
                }

                const removed = owner.removePartyMember(memberId);
                if (!removed) {
                    return res.status(404).json({ success: false, error: `Player '${memberId}' was not in the party` });
                }

                res.json({
                    success: true,
                    message: `Removed player '${memberId}' from ${owner.name}'s party`,
                    members: owner.getPartyMembers()
                });
            } catch (error) {
                console.error('Error removing party member:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Update player attributes
        app.put('/api/player/attributes', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { attributes } = req.body;

                for (const [attrName, value] of Object.entries(attributes || {})) {
                    currentPlayer.setAttribute(attrName, value);
                }

                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    message: 'Attributes updated successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Modify player health
        app.put('/api/player/health', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { amount, reason } = req.body;

                if (typeof amount !== 'number') {
                    throw new Error('Health amount must be a number');
                }

                const result = currentPlayer.modifyHealth(amount, reason || '');

                res.json({
                    success: true,
                    healthChange: result,
                    player: currentPlayer.getStatus(),
                    message: `Health ${amount > 0 ? 'increased' : 'decreased'} by ${Math.abs(amount)}`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Level up player
        app.post('/api/player/levelup', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const oldLevel = currentPlayer.level;
                currentPlayer.levelUp();

                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    message: `Player leveled up from ${oldLevel} to ${currentPlayer.level}!`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all players (for future multi-player support)
        app.get('/api/players', (req, res) => {
            const playerList = Array.from(players.values()).map(player => player.getStatus());

            res.json({
                success: true,
                players: playerList,
                count: playerList.length,
                currentPlayer: currentPlayer ? currentPlayer.id : null
            });
        });

        // Set current player
        app.post('/api/player/set-current', (req, res) => {
            try {
                const { playerId } = req.body;

                if (!playerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Player ID is required'
                    });
                }

                const player = players.get(playerId);
                if (!player) {
                    return res.status(404).json({
                        success: false,
                        error: `Player with ID '${playerId}' not found`
                    });
                }

                currentPlayer = player;

                res.json({
                    success: true,
                    currentPlayer: currentPlayer.getStatus(),
                    message: `Current player set to: ${currentPlayer.name}`
                });
            } catch (error) {
                console.error('Error setting current player:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get attribute definitions
        app.get('/api/attributes', (req, res) => {
            if (!currentPlayer) {
                // Create a temporary player to get definitions
                const tempPlayer = new Player();
                res.json({
                    success: true,
                    attributes: tempPlayer.attributeDefinitions,
                    generationMethods: tempPlayer.getGenerationMethods(),
                    systemConfig: tempPlayer.systemConfig
                });
            } else {
                res.json({
                    success: true,
                    attributes: currentPlayer.attributeDefinitions,
                    generationMethods: currentPlayer.getGenerationMethods(),
                    systemConfig: currentPlayer.systemConfig
                });
            }
        });

        // Generate new attributes for current player
        app.post('/api/player/generate-attributes', (req, res) => {
            if (!currentPlayer) {
                return res.status(404).json({
                    success: false,
                    error: 'No current player found'
                });
            }

            try {
                const { method } = req.body;
                const availableMethods = Object.keys(currentPlayer.getGenerationMethods());

                if (method && !availableMethods.includes(method)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid generation method. Available: ${availableMethods.join(', ')}`
                    });
                }

                const diceModule = require('./nunjucks_dice.js');
                const newAttributes = currentPlayer.generateAttributes(method || 'standard', diceModule);

                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    generatedAttributes: newAttributes,
                    method: method || 'standard',
                    message: `Attributes generated using ${method || 'standard'} method`
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/player/equip', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { slotName, itemId } = req.body || {};
                const resolvedSlotName = typeof slotName === 'string' ? slotName.trim() : '';

                if (!resolvedSlotName) {
                    return res.status(400).json({
                        success: false,
                        error: 'Slot name is required'
                    });
                }

                const gearSnapshot = currentPlayer.getGear();
                if (!gearSnapshot || !Object.prototype.hasOwnProperty.call(gearSnapshot, resolvedSlotName)) {
                    return res.status(400).json({
                        success: false,
                        error: `Unknown equipment slot '${resolvedSlotName}'`
                    });
                }

                let actionSucceeded = false;

                if (itemId) {
                    const inventoryItems = currentPlayer.getInventoryItems();
                    const targetItem = inventoryItems.find(item => item?.id === itemId);

                    if (!targetItem) {
                        return res.status(404).json({
                            success: false,
                            error: 'Item not found in inventory'
                        });
                    }

                    actionSucceeded = currentPlayer.equipItemInSlot(targetItem, resolvedSlotName);

                    if (!actionSucceeded) {
                        return res.status(400).json({
                            success: false,
                            error: 'Failed to equip item in the requested slot'
                        });
                    }
                } else {
                    const gearEntry = gearSnapshot[resolvedSlotName];
                    if (!gearEntry?.itemId) {
                        actionSucceeded = true; // Already empty
                    } else {
                        actionSucceeded = currentPlayer.unequipSlot(resolvedSlotName);
                    }
                }

                if (!actionSucceeded) {
                    return res.status(400).json({
                        success: false,
                        error: 'No changes were applied to equipment'
                    });
                }

                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    message: 'Equipment updated successfully'
                });
            } catch (error) {
                console.error('Error equipping item:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Player Stats Configuration Routes

        // Get player stats page
        app.get('/player-stats', (req, res) => {
            res.render('player-stats.njk', {
                title: 'Player Stats Configuration',
                player: currentPlayer ? currentPlayer.getStatus() : null,
                currentPage: 'player-stats',
                availableSkills: Array.from(skills.values()).map(skill => skill.toJSON())
            });
        });

        // Debug page - shows current player information
        app.get('/debug', (req, res) => {
            // Collect all players data
            const allPlayersData = {};
            for (const [playerId, player] of players) {
                allPlayersData[playerId] = player.toJSON();
            }

            // Load locations from defs/locations.yaml if it exists
            let locationsData = {};
            try {
                const locationsPath = path.join(__dirname, 'defs', 'locations.yaml');
                if (fs.existsSync(locationsPath)) {
                    const locationsFile = fs.readFileSync(locationsPath, 'utf8');
                    if (locationsFile.trim()) {
                        locationsData = yaml.load(locationsFile) || {};
                    }
                }
            } catch (error) {
                console.error('Error loading locations data:', error.message);
                locationsData = { error: 'Failed to load locations data' };
            }

            // Convert game world Maps to objects for display
            const gameWorldData = {
                locations: Object.fromEntries(
                    Array.from(gameLocations.entries()).map(([id, location]) => [id, location.toJSON()])
                ),
                locationExits: Object.fromEntries(
                    Array.from(gameLocationExits.entries()).map(([id, exit]) => [id, exit.toJSON()])
                ),
                regions: Object.fromEntries(
                    Array.from(regions.entries()).map(([id, region]) => [id, region.toJSON()])
                )
            };

            const debugData = {
                title: 'Debug: Player Information',
                player: currentPlayer ? currentPlayer.getStatus() : null,
                playerStatus: currentPlayer ? currentPlayer.getStatus() : null,
                playerJson: currentPlayer ? currentPlayer.toJSON() : null,
                totalPlayers: players.size,
                currentPlayerId: currentPlayer ? currentPlayer.toJSON().id : null,
                allPlayers: allPlayersData,
                allLocations: locationsData, // YAML-loaded locations for reference
                allSettings: SettingInfo.getAll().map(setting => setting.toJSON()),
                currentSetting: currentSetting,
                gameWorld: gameWorldData, // In-memory game world data
                gameWorldCounts: {
                    locations: gameLocations.size,
                    locationExits: gameLocationExits.size,
                    regions: regions.size
                },
                currentPage: 'debug'
            };

            res.render('debug.njk', debugData);
        });

        // Update player stats
        app.post('/api/player/update-stats', (req, res) => {
            try {
                const { name, description, level, health, maxHealth, attributes, skills: skillValues, unspentSkillPoints } = req.body;

                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found. Please create a player first.'
                    });
                }

                // Track if description changed for image regeneration
                const originalDescription = currentPlayer.description;
                const originalName = currentPlayer.name;
                let descriptionChanged = false;
                let nameChanged = false;

                // Update basic information
                if (name && name.trim()) {
                    const trimmedName = name.trim();
                    if (trimmedName !== originalName) {
                        nameChanged = true;
                    }
                    currentPlayer.setName(trimmedName);
                }

                if (description !== undefined) {
                    const newDescription = description.trim();
                    if (originalDescription !== newDescription) {
                        descriptionChanged = true;
                    }
                    currentPlayer.setDescription(newDescription);
                }

                if (level && !isNaN(level) && level >= 1 && level <= 20) {
                    currentPlayer.setLevel(parseInt(level));
                }

                if (health !== undefined && !isNaN(health) && health >= 0) {
                    currentPlayer.setHealth(parseInt(health));
                }

                if (maxHealth && !isNaN(maxHealth) && maxHealth >= 1) {
                    currentPlayer.setMaxHealth(parseInt(maxHealth));
                }

                // Update attributes
                if (attributes && typeof attributes === 'object') {
                    for (const [attrName, value] of Object.entries(attributes)) {
                        if (!isNaN(value) && value >= 3 && value <= 18) {
                            currentPlayer.setAttribute(attrName, parseInt(value));
                        }
                    }
                }

                if (skillValues && typeof skillValues === 'object') {
                    for (const [skillName, value] of Object.entries(skillValues)) {
                        if (!isNaN(value)) {
                            currentPlayer.setSkillValue(skillName, parseInt(value));
                        }
                    }
                }

                if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                    currentPlayer.setUnspentSkillPoints(parseInt(unspentSkillPoints));
                }

                if (typeof currentPlayer.syncSkillsWithAvailable === 'function') {
                    currentPlayer.syncSkillsWithAvailable();
                }

                // Trigger image regeneration if description changed
                if (descriptionChanged || nameChanged) {
                    currentPlayer.imageId = null;
                }

                const imageNeedsUpdate = descriptionChanged || nameChanged;
                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    message: 'Player stats updated successfully',
                    imageNeedsUpdate
                });

            } catch (error) {
                console.error('Error updating player stats:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Create new player from stats form
        app.post('/api/player/create-from-stats', async (req, res) => {
            try {
                const { name, description, level, health, maxHealth, attributes, skills: skillValues, unspentSkillPoints } = req.body;

                // Validate required fields
                if (!name || !name.trim()) {
                    return res.status(400).json({
                        success: false,
                        error: 'Player name is required'
                    });
                }

                // Create player data object
                const playerData = {
                    name: name.trim(),
                    description: description ? description.trim() : '',
                    level: level && !isNaN(level) ? Math.max(1, Math.min(20, parseInt(level))) : 1,
                    health: health && !isNaN(health) ? Math.max(1, parseInt(health)) : 25,
                    maxHealth: maxHealth && !isNaN(maxHealth) ? Math.max(1, parseInt(maxHealth)) : 25,
                    attributes: {}
                };

                // Process attributes
                if (attributes && typeof attributes === 'object') {
                    for (const [attrName, value] of Object.entries(attributes)) {
                        if (!isNaN(value)) {
                            playerData.attributes[attrName] = Math.max(3, Math.min(18, parseInt(value)));
                        }
                    }
                }

                if (skillValues && typeof skillValues === 'object') {
                    playerData.skills = {};
                    for (const [skillName, value] of Object.entries(skillValues)) {
                        if (!isNaN(value)) {
                            playerData.skills[skillName] = Math.max(0, parseInt(value));
                        }
                    }
                }

                if (unspentSkillPoints !== undefined && !isNaN(unspentSkillPoints)) {
                    playerData.unspentSkillPoints = Math.max(0, parseInt(unspentSkillPoints));
                }

                // Create the player
                const player = new Player(playerData);
                players.set(player.id, player);
                currentPlayer = player;

                if (typeof player.syncSkillsWithAvailable === 'function') {
                    player.syncSkillsWithAvailable();
                }

                try {
                    const location = player.currentLocation ? gameLocations.get(player.currentLocation) : null;
                    const region = location ? findRegionByLocationId(location.id) : null;
                    await generateInventoryForCharacter({
                        character: player,
                        characterDescriptor: { role: 'adventurer', class: player.class, race: player.race },
                        region,
                        location
                    });
                } catch (inventoryError) {
                    console.warn('Failed to generate player inventory (stats):', inventoryError);
                }

                res.json({
                    success: true,
                    player: player.getStatus(),
                    message: 'Player created successfully from stats'
                });

            } catch (error) {
                console.error('Error creating player from stats:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/api/player/skills/:skillName/increase', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { skillName } = req.params;
                const amountRaw = req.body?.amount;
                const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : 1;

                const newRank = currentPlayer.increaseSkill(skillName, amount);

                res.json({
                    success: true,
                    player: currentPlayer.getStatus(),
                    skill: {
                        name: skillName,
                        rank: newRank
                    },
                    amount
                });
            } catch (error) {
                console.error('Error increasing skill:', error);
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate player portrait manually
        app.post('/api/players/:id/portrait', async (req, res) => {
            try {
                const playerId = req.params.id;

                // Find the player by ID
                const player = players.get(playerId);
                if (!player) {
                    return res.status(404).json({
                        success: false,
                        error: `Player with ID '${playerId}' not found`
                    });
                }

                // Check if image generation is enabled
                if (!config.imagegen || !config.imagegen.enabled) {
                    return res.status(503).json({
                        success: false,
                        error: 'Image generation is not enabled'
                    });
                }

                if (!comfyUIClient) {
                    return res.status(503).json({
                        success: false,
                        error: 'ComfyUI client not initialized or unavailable'
                    });
                }

                // Generate the portrait
                const imageResult = await generatePlayerImage(player, { force: true });

                if (imageResult.success) {
                    return res.json({
                        success: true,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        },
                        imageGeneration: imageResult,
                        message: `Portrait regeneration initiated for ${player.name}`
                    });
                }

                if (imageResult.existingJob) {
                    return res.status(202).json({
                        success: false,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        },
                        imageGeneration: imageResult,
                        message: 'Portrait job already in progress'
                    });
                }

                if (imageResult.skipped) {
                    return res.status(409).json({
                        success: false,
                        error: 'Portrait generation is only available for companions in your party or at your current location.',
                        reason: imageResult.reason,
                        player: {
                            id: player.id,
                            name: player.name,
                            imageId: player.imageId
                        }
                    });
                }

                res.status(500).json({
                    success: false,
                    error: imageResult.message || 'Failed to queue portrait generation'
                });

            } catch (error) {
                console.error('Error generating player portrait:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== PLAYER AND LOCATION QUERY ENDPOINTS ====================

        // Get location by ID
        app.get('/api/locations/:id', async (req, res) => {
            try {
                const locationId = req.params.id;
                const location = Location.get(locationId);

                if (!location) {
                    return res.status(404).json({
                        success: false,
                        error: `Location with ID '${locationId}' not found`
                    });
                }

                if (location.isStub) {
                    try {
                        await scheduleStubExpansion(location);
                    } catch (expansionError) {
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand location: ${expansionError.message}`
                        });
                    }
                }

                if (currentPlayer && currentPlayer.currentLocation === location.id) {
                    try {
                        queueLocationThingImages(location);
                    } catch (itemQueueError) {
                        console.warn('Failed to queue thing images after fetching location:', itemQueueError.message);
                    }
                }

                const locationData = location.toJSON();
                locationData.pendingImageJobId = pendingLocationImages.get(location.id) || null;
                if (locationData.exits) {
                    for (const [dir, exit] of Object.entries(locationData.exits)) {
                        if (!exit) continue;
                        const destLocation = gameLocations.get(exit.destination);
                        if (destLocation) {
                            exit.destinationName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || exit.destination;
                        }
                    }
                }

                locationData.npcs = buildNpcProfiles(location);
                locationData.things = buildThingProfiles(location);

                res.json({
                    success: true,
                    location: locationData
                });
            } catch (error) {
                console.error('Error fetching location:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Move player to a connected location
        app.post('/api/player/move', async (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const { destinationId, direction } = req.body || {};
                if (!destinationId && !direction) {
                    return res.status(400).json({
                        success: false,
                        error: 'Destination ID or direction is required'
                    });
                }

                const currentLocationId = currentPlayer.currentLocation;
                const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;
                if (!currentLocation) {
                    return res.status(400).json({
                        success: false,
                        error: 'Current location not found in game world'
                    });
                }

                const directions = currentLocation.getAvailableDirections();
                let matchedExit = null;
                let matchedDirection = null;
                for (const dir of directions) {
                    const exit = currentLocation.getExit(dir);
                    if (!exit) continue;
                    if (destinationId && exit.destination === destinationId) {
                        matchedExit = exit;
                        matchedDirection = dir;
                        break;
                    }
                    if (!destinationId && direction && dir === direction) {
                        matchedExit = exit;
                        matchedDirection = dir;
                        break;
                    }
                }

                if (!matchedExit) {
                    return res.status(404).json({
                        success: false,
                        error: 'Exit not found from current location'
                    });
                }

                let destinationLocation = gameLocations.get(matchedExit.destination);
                if (!destinationLocation) {
                    return res.status(404).json({
                        success: false,
                        error: 'Destination location not found'
                    });
                }

                if (destinationLocation.isStub) {
                    try {
                        await scheduleStubExpansion(destinationLocation);
                        destinationLocation = gameLocations.get(destinationLocation.id);
                    } catch (expansionError) {
                        return res.status(500).json({
                            success: false,
                            error: `Failed to expand destination location: ${expansionError.message}`
                        });
                    }
                }

                currentPlayer.setLocation(destinationLocation.id);

                if (typeof currentPlayer.getPartyMembers === 'function') {
                    const partyMemberIds = currentPlayer.getPartyMembers();
                    if (Array.isArray(partyMemberIds) || partyMemberIds instanceof Set) {
                        const memberIds = Array.isArray(partyMemberIds)
                            ? partyMemberIds
                            : Array.from(partyMemberIds);

                        for (const memberId of memberIds) {
                            const member = players.get(memberId);
                            if (!member) {
                                continue;
                            }

                            const previousLocationId = member.currentLocation;
                            if (previousLocationId && gameLocations.has(previousLocationId)) {
                                const previousLocation = gameLocations.get(previousLocationId);
                                if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                                    previousLocation.removeNpcId(member.id);
                                }
                            }

                            try {
                                member.setLocation(destinationLocation.id);
                            } catch (memberError) {
                                console.warn(`Failed to update location for party member ${member.name || member.id}:`, memberError.message);
                                continue;
                            }

                            if (member.isNPC && typeof destinationLocation.removeNpcId === 'function') {
                                destinationLocation.removeNpcId(member.id);
                            }
                        }
                    }
                }

                queueNpcAssetsForLocation(destinationLocation);
                try {
                    queueLocationThingImages(destinationLocation);
                } catch (thingQueueError) {
                    console.warn('Failed to queue thing images after moving:', thingQueueError.message);
                }

                const locationData = destinationLocation.toJSON();
                locationData.pendingImageJobId = pendingLocationImages.get(destinationLocation.id) || null;
                if (locationData.exits) {
                    for (const [dirKey, exit] of Object.entries(locationData.exits)) {
                        if (!exit) continue;
                        const destLocation = gameLocations.get(exit.destination);
                        if (destLocation) {
                            exit.destinationName = destLocation.name || destLocation.stubMetadata?.blueprintDescription || exit.destination;
                        }
                    }
                }
                locationData.npcs = buildNpcProfiles(destinationLocation);

                res.json({
                    success: true,
                    location: locationData,
                    message: `Moved to ${locationData.name || locationData.id}`,
                    direction: matchedDirection
                });
            } catch (error) {
                console.error('Error moving player:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.get('/api/map/region', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(404).json({
                        success: false,
                        error: 'No current player found'
                    });
                }

                const currentLocationId = currentPlayer.currentLocation;
                const currentLocation = currentLocationId ? gameLocations.get(currentLocationId) : null;
                if (!currentLocation) {
                    return res.status(404).json({
                        success: false,
                        error: 'Current location not found'
                    });
                }

                let region = null;
                const regionId = currentLocation.stubMetadata?.regionId;
                if (regionId && regions.has(regionId)) {
                    region = regions.get(regionId);
                } else {
                    region = Array.from(regions.values()).find(r => r.locationIds.includes(currentLocationId)) || null;
                }

                let locations = [];
                if (region) {
                    locations = region.locationIds
                        .map(id => gameLocations.get(id))
                        .filter(Boolean);
                } else {
                    locations = Array.from(gameLocations.values());
                }

                const payload = {
                    currentLocationId,
                    locations: locations.map(loc => {
                        const locationPayload = {
                            id: loc.id,
                            name: loc.name || loc.id,
                            isStub: Boolean(loc.isStub),
                            visited: Boolean(loc.visited),
                            exits: Array.from(loc.getAvailableDirections()).map(direction => {
                                const exit = loc.getExit(direction);
                                return {
                                    id: exit?.id || `${loc.id}_${direction}`,
                                    destination: exit?.destination,
                                    bidirectional: exit?.bidirectional !== false
                                };
                            })
                        };

                        if (loc.imageId) {
                            const metadata = generatedImages.get(loc.imageId);
                            const firstImage = metadata?.images?.[0];
                            locationPayload.image = firstImage
                                ? { id: loc.imageId, url: firstImage.url }
                                : { id: loc.imageId, url: null };
                        }

                        return locationPayload;
                    })
                };

                res.json({ success: true, region: payload });
            } catch (error) {
                console.error('Error building map data:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== LOCATION GENERATION FUNCTIONALITY ====================

        // Generate a new region using AI
        app.post('/api/regions/generate', async (req, res) => {
            try {
                const { regionName, regionDescription, regionNotes } = req.body || {};
                const activeSetting = getActiveSettingSnapshot();

                const options = {
                    setting: describeSettingForPrompt(activeSetting),
                    regionName: regionName && regionName.trim() ? regionName.trim() : null,
                    regionDescription: regionDescription || null,
                    regionNotes: regionNotes || null
                };

                const result = await generateRegionFromPrompt(options);

                res.json({
                    success: true,
                    region: result.region.toJSON(),
                    createdLocationIds: result.region.locationIds,
                    createdLocations: result.createdLocations.map(loc => loc.toJSON()),
                    entranceLocationId: result.region.entranceLocationId || result.entranceLocationId,
                    message: `Region "${result.region.name}" generated with ${result.region.locationIds.length} stub locations.`
                });
            } catch (error) {
                console.error('Error generating region:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate a new location using AI
        app.post('/api/locations/generate', async (req, res) => {
            try {
                const body = req.body || {};
                const activeSetting = getActiveSettingSnapshot();
                const derivedLocationStyle = resolveLocationStyle(body.locationStyle, activeSetting);
                const settingDescription = describeSettingForPrompt(activeSetting);
                const shortDescription = buildLocationShortDescription(derivedLocationStyle, activeSetting);
                const locationPurpose = buildLocationPurpose(derivedLocationStyle, activeSetting);
                const playerLevel = getSuggestedPlayerLevel(activeSetting);

                const options = {
                    setting: settingDescription,
                    theme: derivedLocationStyle,
                    locationTheme: derivedLocationStyle,
                    locationStyle: derivedLocationStyle,
                    shortDescription,
                    locationPurpose,
                    playerLevel,
                    settingInfoId: activeSetting?.id || null
                };

                console.log('🏗️  Starting location generation with options derived from current setting:', options);

                // Generate the location
                const result = await generateLocationFromPrompt(options);

                const locationData = result.location.toJSON();
                locationData.pendingImageJobId = pendingLocationImages.get(result.location.id) || null;
                locationData.npcs = buildNpcProfiles(result.location);
                locationData.things = buildThingProfiles(result.location);

                res.json({
                    success: true,
                    location: locationData,
                    locationId: result.location.id,
                    locationName: result.location.name,
                    gameWorldStats: {
                        totalLocations: gameLocations.size,
                        totalLocationExits: gameLocationExits.size,
                        totalThings: things.size
                    },
                    generationInfo: {
                        aiResponse: result.aiResponse,
                        options: result.generationOptions,
                        activeSetting,
                        requestedLocationStyle: derivedLocationStyle,
                        newStubs: result.newStubs || []
                    },
                    message: `Location "${result.location.name || result.location.id}" generated successfully`
                });

            } catch (error) {
                console.error('Error in location generation API:', error);

                // Provide more specific error messages
                let errorMessage = error.message;
                let statusCode = 500;

                if (error.code === 'ECONNABORTED') {
                    errorMessage = 'Request timeout - AI API took too long to respond';
                    statusCode = 408;
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    errorMessage = 'Cannot connect to AI API - check your endpoint URL';
                    statusCode = 503;
                } else if (error.response) {
                    const apiStatusCode = error.response.status;
                    const apiErrorMessage = error.response.data?.error?.message || 'API request failed';
                    errorMessage = `AI API Error (${apiStatusCode}): ${apiErrorMessage}`;
                    statusCode = apiStatusCode;
                }

                res.status(statusCode).json({
                    success: false,
                    error: errorMessage,
                    details: error.message
                });
            }
        });

        // ==================== THING MANAGEMENT API ENDPOINTS ====================

        // Create a new thing
        app.post('/api/things', async (req, res) => {
            try {
                const { name, description, thingType, imageId, rarity, itemTypeDetail, metadata } = req.body;

                const thing = new Thing({
                    name,
                    description,
                    thingType,
                    imageId,
                    rarity,
                    itemTypeDetail,
                    metadata
                });

                things.set(thing.id, thing);

                const imageEligible = shouldGenerateThingImage(thing);
                if (!imageEligible) {
                    console.log(`🎒 Skipping automatic image generation for ${thing.name} (${thing.id}) - not in player inventory`);
                } else {
                    thing.imageId = null;
                }

                res.json({
                    success: true,
                    thing: thing.toJSON(),
                    message: 'Thing created successfully',
                    imageNeedsGeneration: Boolean(imageEligible)
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all things (with optional type filtering)
        app.get('/api/things', (req, res) => {
            try {
                const { type } = req.query;
                let result = Array.from(things.values()).map(thing => thing.toJSON());

                if (type) {
                    if (!Thing.validTypes.includes(type)) {
                        return res.status(400).json({
                            success: false,
                            error: `Invalid type. Must be one of: ${Thing.validTypes.join(', ')}`
                        });
                    }
                    result = result.filter(thing => thing.thingType === type);
                }

                res.json({
                    success: true,
                    things: result,
                    count: result.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get a specific thing by ID
        app.get('/api/things/:id', (req, res) => {
            try {
                const { id } = req.params;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                res.json({
                    success: true,
                    thing: thing.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Update a thing
        app.put('/api/things/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const { name, description, thingType, imageId, rarity, itemTypeDetail, metadata } = req.body;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                // Update properties if provided
                let shouldRegenerateImage = false;
                if (name !== undefined) {
                    thing.name = name;
                    shouldRegenerateImage = true;
                }
                if (description !== undefined) {
                    thing.description = description;
                    shouldRegenerateImage = true;
                }
                if (thingType !== undefined) {
                    thing.thingType = thingType;
                    shouldRegenerateImage = true;
                }
                if (rarity !== undefined) {
                    thing.rarity = rarity;
                    shouldRegenerateImage = true;
                }
                if (itemTypeDetail !== undefined) {
                    thing.itemTypeDetail = itemTypeDetail;
                    shouldRegenerateImage = true;
                }
                if (metadata !== undefined) {
                    thing.metadata = metadata;
                    shouldRegenerateImage = true;
                }
                if (imageId !== undefined) thing.imageId = imageId;

                // Trigger image regeneration if visual properties changed (only when relevant)
                let imageNeedsUpdate = false;
                if (shouldRegenerateImage && imageId === undefined) {
                    if (shouldGenerateThingImage(thing)) {
                        thing.imageId = null;
                        imageNeedsUpdate = true;
                    } else {
                        console.log(`🎒 Skipping ${thing.thingType} image regeneration for ${thing.name} - not in player inventory`);
                    }
                }

                res.json({
                    success: true,
                    thing: thing.toJSON(),
                    message: 'Thing updated successfully',
                    imageNeedsUpdate
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a thing
        app.delete('/api/things/:id', (req, res) => {
            try {
                const { id } = req.params;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                // Remove from storage and Thing's static indexes
                things.delete(id);
                thing.delete();

                res.json({
                    success: true,
                    message: 'Thing deleted successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all scenery things
        app.get('/api/things/scenery', (req, res) => {
            try {
                const sceneryThings = Array.from(things.values())
                    .filter(thing => thing.isScenery())
                    .map(thing => thing.toJSON());

                res.json({
                    success: true,
                    things: sceneryThings,
                    count: sceneryThings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get all item things
        app.get('/api/things/items', (req, res) => {
            try {
                const itemThings = Array.from(things.values())
                    .filter(thing => thing.isItem())
                    .map(thing => thing.toJSON());

                res.json({
                    success: true,
                    things: itemThings,
                    count: itemThings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate image for a specific thing
        app.post('/api/things/:id/image', async (req, res) => {
            try {
                const { id } = req.params;
                const thing = things.get(id);

                if (!thing) {
                    return res.status(404).json({
                        success: false,
                        error: 'Thing not found'
                    });
                }

                if (!shouldGenerateThingImage(thing)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Item images can only be generated for gear in your inventory.',
                        thing: thing.toJSON()
                    });
                }

                const imageResult = await generateThingImage(thing, { force: true });

                if (imageResult.success) {
                    return res.json({
                        success: true,
                        thing: thing.toJSON(),
                        imageGeneration: imageResult,
                        message: `${thing.thingType} image generation initiated for ${thing.name}`
                    });
                }

                if (imageResult.existingJob) {
                    return res.status(202).json({
                        success: false,
                        thing: thing.toJSON(),
                        imageGeneration: imageResult,
                        message: 'Image job already in progress'
                    });
                }

                if (imageResult.skipped) {
                    return res.status(409).json({
                        success: false,
                        error: 'Image generation is not available or disabled',
                        reason: imageResult.reason,
                        thing: thing.toJSON()
                    });
                }

                res.status(500).json({
                    success: false,
                    error: imageResult.message || 'Failed to queue image generation',
                    thing: thing.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== SETTINGS API ENDPOINTS ====================

        // Get all settings
        app.get('/api/settings', (req, res) => {
            try {
                const allSettings = SettingInfo.getAll().map(setting => setting.toJSON());

                res.json({
                    success: true,
                    settings: allSettings,
                    count: allSettings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Create a new setting
        app.post('/api/settings', (req, res) => {
            try {
                const settingData = req.body;

                // Validate required fields
                if (!settingData.name || typeof settingData.name !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'Setting name is required and must be a string'
                    });
                }

                // Check if setting with same name already exists
                if (SettingInfo.getByName(settingData.name)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Setting with this name already exists'
                    });
                }

                const newSetting = new SettingInfo(settingData);

                res.status(201).json({
                    success: true,
                    setting: newSetting.toJSON(),
                    message: 'Setting created successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get a specific setting by ID
        app.get('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                res.json({
                    success: true,
                    setting: setting.toJSON()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Update a setting
        app.put('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const updates = req.body;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                // Check if name conflict with another setting
                if (updates.name && updates.name !== setting.name) {
                    const existingSetting = SettingInfo.getByName(updates.name);
                    if (existingSetting && existingSetting.id !== id) {
                        return res.status(409).json({
                            success: false,
                            error: 'Setting with this name already exists'
                        });
                    }
                }

                setting.update(updates);

                res.json({
                    success: true,
                    setting: setting.toJSON(),
                    message: 'Setting updated successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a setting
        app.delete('/api/settings/:id', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                const deleted = SettingInfo.delete(id);

                if (deleted) {
                    res.json({
                        success: true,
                        message: 'Setting deleted successfully'
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to delete setting'
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Clone a setting
        app.post('/api/settings/:id/clone', (req, res) => {
            try {
                const { id } = req.params;
                const { newName } = req.body;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                // Check if new name already exists
                if (newName && SettingInfo.getByName(newName)) {
                    return res.status(409).json({
                        success: false,
                        error: 'Setting with this name already exists'
                    });
                }

                const clonedSetting = setting.clone(newName);

                res.status(201).json({
                    success: true,
                    setting: clonedSetting.toJSON(),
                    message: 'Setting cloned successfully'
                });
            } catch (error) {
                res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Save all settings to files
        app.post('/api/settings/save', (req, res) => {
            try {
                const result = SettingInfo.saveAll();

                res.json({
                    success: true,
                    result,
                    message: `Saved ${result.count} settings to ${result.directory}`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Load all settings from files
        app.post('/api/settings/load', (req, res) => {
            try {
                const result = SettingInfo.loadAll();

                res.json({
                    success: true,
                    result,
                    message: `Loaded ${result.count} settings from ${result.directory}`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // List saved setting files
        app.get('/api/settings/saved', (req, res) => {
            try {
                const savedSettings = SettingInfo.listSavedSettings();

                res.json({
                    success: true,
                    savedSettings,
                    count: savedSettings.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Save individual setting to file
        app.post('/api/settings/:id/save', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                const filepath = setting.save();

                res.json({
                    success: true,
                    filepath,
                    message: 'Setting saved to file successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Apply setting as current game setting
        app.post('/api/settings/:id/apply', (req, res) => {
            try {
                const { id } = req.params;
                const setting = SettingInfo.getById(id);

                if (!setting) {
                    return res.status(404).json({
                        success: false,
                        error: 'Setting not found'
                    });
                }

                // Apply globally so other routes/templates can access it
                currentSetting = setting;
                try {
                    const settingJSON = typeof setting.toJSON === 'function' ? setting.toJSON() : setting;
                    if (app && app.locals) {
                        app.locals.currentSetting = settingJSON;
                        // Also expose prompt variables for convenience in views
                        app.locals.promptVariables = typeof setting.getPromptVariables === 'function' ? setting.getPromptVariables() : undefined;
                    }
                    if (typeof viewsEnv?.addGlobal === 'function') {
                        viewsEnv.addGlobal('currentSetting', settingJSON);
                        viewsEnv.addGlobal('promptVariables', app.locals.promptVariables);
                    }
                    // Optional: expose on global for non-module consumers
                    global.currentSetting = setting;
                } catch (_) {
                    // Best-effort; do not block on template/global propagation
                }

                res.json({
                    success: true,
                    setting: setting.toJSON(),
                    message: `Applied setting: ${setting.name}`,
                    promptVariables: setting.getPromptVariables()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get current applied setting
        app.get('/api/settings/current', (req, res) => {
            try {
                if (!currentSetting) {
                    return res.json({
                        success: true,
                        setting: null,
                        message: 'No setting currently applied'
                    });
                }

                res.json({
                    success: true,
                    setting: currentSetting.toJSON(),
                    promptVariables: currentSetting.getPromptVariables()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Clear current setting (revert to config defaults)
        app.delete('/api/settings/current', (req, res) => {
            try {
                const previousSetting = currentSetting;
                currentSetting = null;
                // Clear globals so templates/consumers reflect reset
                try {
                    if (app && app.locals) {
                        app.locals.currentSetting = null;
                        app.locals.promptVariables = undefined;
                    }
                    if (typeof viewsEnv?.addGlobal === 'function') {
                        viewsEnv.addGlobal('currentSetting', null);
                        viewsEnv.addGlobal('promptVariables', undefined);
                    }
                    global.currentSetting = null;
                } catch (_) {
                    // Non-fatal cleanup
                }

                res.json({
                    success: true,
                    message: 'Current setting cleared - reverted to configuration defaults',
                    previousSetting: previousSetting ? previousSetting.toJSON() : null
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ==================== NEW GAME FUNCTIONALITY ====================

        // Create a new game with fresh player and starting location
        app.post('/api/new-game', async (req, res) => {
            try {
                const { playerName, playerDescription, startingLocation, numSkills: numSkillsInput, existingSkills: existingSkillsInput } = req.body || {};
                const activeSetting = getActiveSettingSnapshot();
                const newGameDefaults = buildNewGameDefaults(activeSetting);
                const settingDescription = describeSettingForPrompt(activeSetting);
                const rawPlayerName = typeof playerName === 'string' ? playerName.trim() : '';
                const rawPlayerDescription = typeof playerDescription === 'string' ? playerDescription.trim() : '';
                const requestedStartingLocation = typeof startingLocation === 'string' ? startingLocation.trim() : '';
                const resolvedPlayerName = rawPlayerName || newGameDefaults.playerName || 'Adventurer';
                const resolvedPlayerDescription = rawPlayerDescription || newGameDefaults.playerDescription || 'A brave soul embarking on a new adventure.';
                const resolvedStartingLocation = requestedStartingLocation || newGameDefaults.startingLocation;
                const startingPlayerLevel = activeSetting?.playerStartingLevel || 1;
                const startingLocationStyle = resolveLocationStyle(activeSetting?.startingLocationType || resolvedStartingLocation, activeSetting);
                const parsedSkillCount = Number.parseInt(numSkillsInput, 10);
                const fallbackSkillCount = Math.max(1, Math.min(100, newGameDefaults.numSkills || 20));
                const numSkills = Number.isFinite(parsedSkillCount)
                    ? Math.max(1, Math.min(100, parsedSkillCount))
                    : fallbackSkillCount;

                // Clear existing game state
                players.clear();
                gameLocations.clear();
                gameLocationExits.clear();
                regions.clear();
                Region.clear();
                stubExpansionPromises.clear();
                chatHistory.length = 0;
                skills.clear();
                Player.setAvailableSkills(new Map());

                console.log('🎮 Starting new game...');

                const rawExistingSkills = typeof existingSkillsInput === 'undefined'
                    ? newGameDefaults.existingSkills
                    : existingSkillsInput;

                const existingSkillNames = Array.isArray(rawExistingSkills)
                    ? rawExistingSkills
                    : (typeof rawExistingSkills === 'string'
                        ? rawExistingSkills.split(/\r?\n/)
                        : []);

                const normalizedExistingSkills = existingSkillNames
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean);

                let detailedExistingSkills = [];
                if (normalizedExistingSkills.length) {
                    try {
                        detailedExistingSkills = await generateSkillsByNames({
                            skillNames: normalizedExistingSkills,
                            settingDescription
                        });
                    } catch (detailedError) {
                        console.warn('Failed to generate detailed skills by name:', detailedError.message);
                        detailedExistingSkills = [];
                    }
                }

                let generatedSkills = [];
                try {
                    generatedSkills = await generateSkillsList({
                        count: numSkills,
                        settingDescription,
                        existingSkills: normalizedExistingSkills
                    });
                } catch (skillError) {
                    console.warn('Failed to generate skills from prompt:', skillError.message);
                    generatedSkills = [];
                }

                const combinedSkills = new Map();

                const addSkillToCombined = (skill) => {
                    if (!skill || !skill.name) {
                        return;
                    }
                    const key = skill.name.trim().toLowerCase();
                    if (!key || combinedSkills.has(key)) {
                        return;
                    }
                    combinedSkills.set(key, skill);
                };

                if (Array.isArray(detailedExistingSkills) && detailedExistingSkills.length) {
                    detailedExistingSkills.forEach(addSkillToCombined);
                }

                for (const name of normalizedExistingSkills) {
                    if (!name) continue;
                    const key = name.toLowerCase();
                    if (!combinedSkills.has(key)) {
                        combinedSkills.set(key, new Skill({
                            name,
                            description: '',
                            attribute: ''
                        }));
                    }
                }

                for (const skill of generatedSkills) {
                    if (!skill || !skill.name) continue;
                    const key = skill.name.trim().toLowerCase();
                    if (!combinedSkills.has(key)) {
                        combinedSkills.set(key, skill);
                    }
                }

                skills.clear();
                if (combinedSkills.size > 0) {
                    for (const skill of combinedSkills.values()) {
                        skills.set(skill.name, skill);
                    }
                    Player.setAvailableSkills(skills);
                    for (const player of players.values()) {
                        if (typeof player.syncSkillsWithAvailable === 'function') {
                            player.syncSkillsWithAvailable();
                        }
                    }
                } else {
                    Player.setAvailableSkills(new Map());
                }

                // Create new player
                const newPlayer = new Player({
                    name: resolvedPlayerName,
                    description: resolvedPlayerDescription,
                    level: startingPlayerLevel,
                    health: 25,
                    maxHealth: 25,
                    attributes: {
                        strength: 10,
                        dexterity: 10,
                        constitution: 10,
                        intelligence: 10,
                        wisdom: 10,
                        charisma: 10
                    }
                });
                if (typeof newPlayer.syncSkillsWithAvailable === 'function') {
                    newPlayer.syncSkillsWithAvailable();
                }

                // Generate an initial region and choose its entrance as the starting location
                console.log('🗺️ Generating starting region...');
                const defaultRegionName = activeSetting?.name
                    ? `${activeSetting.name} Frontier`
                    : resolvedStartingLocation
                        ? `${resolvedStartingLocation} Region`
                        : 'Starting Region';

                const regionOptions = {
                    setting: settingDescription,
                    regionName: resolvedStartingLocation ? `${resolvedStartingLocation} Frontier` : defaultRegionName,
                    regionNotes: startingLocationStyle || null
                };

                const regionResult = await generateRegionFromPrompt(regionOptions);
                const region = regionResult.region;

                let entranceLocationId = region.entranceLocationId || regionResult.entranceLocationId;
                if (!entranceLocationId && region.locationIds.length > 0) {
                    entranceLocationId = region.locationIds[0];
                }

                if (!entranceLocationId) {
                    throw new Error('No entrance location generated for starting region');
                }

                let entranceLocation = gameLocations.get(entranceLocationId);
                if (!entranceLocation) {
                    throw new Error('Entrance location not found in game world');
                }

                if (entranceLocation.isStub) {
                    try {
                        const expansion = await generateLocationFromPrompt({
                            stubLocation: entranceLocation,
                            createStubs: false
                        });
                        if (expansion?.location) {
                            entranceLocation = expansion.location;
                            entranceLocationId = entranceLocation.id;
                            region.entranceLocationId = entranceLocationId;
                        }
                    } catch (expansionError) {
                        console.warn('Failed to expand entrance stub:', expansionError.message);
                    }
                }

                if (entranceLocation.baseLevel && entranceLocation.baseLevel > 3) {
                    entranceLocation.baseLevel = Math.min(3, Math.max(1, entranceLocation.baseLevel));
                } else if (!entranceLocation.baseLevel) {
                    entranceLocation.baseLevel = 1;
                }

                gameLocations.set(entranceLocation.id, entranceLocation);
                console.log(`🏠 Starting at region entrance: ${entranceLocation.name} (Level ${entranceLocation.baseLevel})`);

                // Place player in starting location
                newPlayer.setLocation(entranceLocation.id);

                // Store new player and set as current
                players.set(newPlayer.id, newPlayer);
                currentPlayer = newPlayer;

                queueNpcAssetsForLocation(entranceLocation);

                try {
                    await generateInventoryForCharacter({
                        character: newPlayer,
                        characterDescriptor: { role: 'adventurer', class: newPlayer.class, race: newPlayer.race },
                        region,
                        location: entranceLocation
                    });
                } catch (inventoryError) {
                    console.warn('Failed to generate inventory for new-game player:', inventoryError);
                }

                console.log(`🧙‍♂️ Created new player: ${newPlayer.name} at ${entranceLocation.name}`);

                const startingLocationData = entranceLocation.toJSON();
                startingLocationData.pendingImageJobId = pendingLocationImages.get(entranceLocation.id) || null;
                startingLocationData.npcs = buildNpcProfiles(entranceLocation);

                res.json({
                    success: true,
                    message: 'New game started successfully',
                    player: newPlayer.toJSON(),
                    startingLocation: startingLocationData,
                    region: region.toJSON(),
                    skills: generatedSkills.map(skill => skill.toJSON()),
                    gameState: {
                        totalPlayers: players.size,
                        totalLocations: gameLocations.size,
                        currentLocation: entranceLocation.name,
                        regionEntranceId: entranceLocation.id
                    }
                });

            } catch (error) {
                console.error('Error creating new game:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to create new game',
                    details: error.message
                });
            }
        });

        // ==================== SAVE/LOAD FUNCTIONALITY ====================

        // Save current game state
        app.post('/api/save', (req, res) => {
            try {
                if (!currentPlayer) {
                    return res.status(400).json({
                        success: false,
                        error: 'No current player to save'
                    });
                }

                // Create save directory name with timestamp and player name
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const playerName = currentPlayer.name.replace(/[^a-zA-Z0-9]/g, '_');
                const saveName = `${timestamp}_${playerName}`;
                const saveDir = path.join(__dirname, 'saves', saveName);

                // Create save directory
                if (!fs.existsSync(saveDir)) {
                    fs.mkdirSync(saveDir, { recursive: true });
                }

                // Save game world data (locations and exits)
                const gameWorldData = {
                    locations: Object.fromEntries(
                        Array.from(gameLocations.entries()).map(([id, location]) => [id, location.toJSON()])
                    ),
                    locationExits: Object.fromEntries(
                        Array.from(gameLocationExits.entries()).map(([id, exit]) => [id, exit.toJSON()])
                    ),
                    regions: Object.fromEntries(
                        Array.from(regions.entries()).map(([id, region]) => [id, region.toJSON()])
                    )
                };
                fs.writeFileSync(
                    path.join(saveDir, 'gameWorld.json'),
                    JSON.stringify(gameWorldData, null, 2)
                );

                // Save chat history
                fs.writeFileSync(
                    path.join(saveDir, 'chatHistory.json'),
                    JSON.stringify(chatHistory, null, 2)
                );

                // Save generated images metadata
                const imagesData = Object.fromEntries(generatedImages);
                fs.writeFileSync(
                    path.join(saveDir, 'images.json'),
                    JSON.stringify(imagesData, null, 2)
                );

                // Save world things (items and scenery)
                const thingsData = Object.fromEntries(
                    Array.from(things.entries()).map(([id, thing]) => [id, thing.toJSON()])
                );
                fs.writeFileSync(
                    path.join(saveDir, 'things.json'),
                    JSON.stringify(thingsData, null, 2)
                );

                // Save all players data
                const allPlayersData = Object.fromEntries(
                    Array.from(players.entries()).map(([id, player]) => [id, player.toJSON()])
                );
                fs.writeFileSync(
                    path.join(saveDir, 'allPlayers.json'),
                    JSON.stringify(allPlayersData, null, 2)
                );

                // Save generated skill definitions
                const skillsData = Array.from(skills.values()).map(skill => skill.toJSON());
                fs.writeFileSync(
                    path.join(saveDir, 'skills.json'),
                    JSON.stringify(skillsData, null, 2)
                );

                // Save metadata about the save
                const metadata = {
                    saveName: saveName,
                    timestamp: new Date().toISOString(),
                    playerName: currentPlayer.name,
                    playerId: currentPlayer.toJSON().id,
                    playerLevel: currentPlayer.level,
                    gameVersion: '1.0.0',
                    chatHistoryLength: chatHistory.length,
                    totalPlayers: players.size,
                    totalThings: things.size,
                    totalLocations: gameLocations.size,
                    totalLocationExits: gameLocationExits.size,
                    totalRegions: regions.size,
                    totalGeneratedImages: generatedImages.size,
                    totalSkills: skills.size,
                    currentSettingId: currentSetting?.id || null,
                    currentSettingName: currentSetting?.name || null
                };

                if (currentSetting && typeof currentSetting.toJSON === 'function') {
                    const settingPath = path.join(saveDir, 'setting.json');
                    const settingData = currentSetting.toJSON();
                    fs.writeFileSync(settingPath, JSON.stringify(settingData, null, 2));
                }

                fs.writeFileSync(
                    path.join(saveDir, 'metadata.json'),
                    JSON.stringify(metadata, null, 2)
                );

                res.json({
                    success: true,
                    saveName: saveName,
                    saveDir: saveDir,
                    metadata: metadata,
                    message: `Game saved successfully as: ${saveName}`
                });

            } catch (error) {
                console.error('Error saving game:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Load game state from a save
        app.post('/api/load', (req, res) => {
            try {
                const { saveName } = req.body;

                if (!saveName) {
                    return res.status(400).json({
                        success: false,
                        error: 'Save name is required'
                    });
                }

                const saveDir = path.join(__dirname, 'saves', saveName);

                // Check if save directory exists
                if (!fs.existsSync(saveDir)) {
                    return res.status(404).json({
                        success: false,
                        error: `Save '${saveName}' not found`
                    });
                }

                // Load metadata
                const metadataPath = path.join(saveDir, 'metadata.json');
                let metadata = {};
                if (fs.existsSync(metadataPath)) {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                }

                // Reset in-memory image job state before loading new data
                jobQueue.length = 0;
                imageJobs.clear();
                pendingLocationImages.clear();
                generatedImages.clear();
                npcGenerationPromises.clear();
                isProcessingJob = false;

                const skillsPath = path.join(saveDir, 'skills.json');
                skills.clear();
                if (fs.existsSync(skillsPath)) {
                    try {
                        const skillsData = JSON.parse(fs.readFileSync(skillsPath, 'utf8')) || [];
                        for (const skillEntry of skillsData) {
                            try {
                                const skill = Skill.fromJSON(skillEntry);
                                skills.set(skill.name, skill);
                            } catch (skillError) {
                                console.warn('Skipping invalid skill entry:', skillError.message);
                            }
                        }
                    } catch (skillLoadError) {
                        console.warn('Failed to load skills from save:', skillLoadError.message);
                    }
                }
                Player.setAvailableSkills(skills);

                // Load world things before players so inventories can resolve
                const thingsPath = path.join(saveDir, 'things.json');
                things.clear();
                if (typeof Thing.clear === 'function') {
                    Thing.clear();
                }
                if (fs.existsSync(thingsPath)) {
                    try {
                        const thingsData = JSON.parse(fs.readFileSync(thingsPath, 'utf8')) || {};
                        for (const [id, payload] of Object.entries(thingsData)) {
                            try {
                                const thing = Thing.fromJSON(payload);
                                things.set(id, thing);
                            } catch (thingError) {
                                console.warn('Skipping invalid thing entry:', thingError.message);
                            }
                        }
                    } catch (thingLoadError) {
                        console.warn('Failed to load things from save:', thingLoadError.message);
                    }
                }

                // Load all players first
                const allPlayersPath = path.join(saveDir, 'allPlayers.json');
                if (fs.existsSync(allPlayersPath)) {
                    players.clear();
                    const allPlayersData = JSON.parse(fs.readFileSync(allPlayersPath, 'utf8')) || {};
                    for (const [id, playerData] of Object.entries(allPlayersData)) {
                        const player = Player.fromJSON(playerData);
                        if (typeof player.syncSkillsWithAvailable === 'function') {
                            player.syncSkillsWithAvailable();
                        }
                        players.set(id, player);
                    }
                }

                // Set current player from metadata
                if (metadata.playerId && players.has(metadata.playerId)) {
                    currentPlayer = players.get(metadata.playerId);
                } else {
                    currentPlayer = null;
                }

                // Restore setting
                const settingFilePath = path.join(saveDir, 'setting.json');
                if (fs.existsSync(settingFilePath)) {
                    try {
                        const settingData = JSON.parse(fs.readFileSync(settingFilePath, 'utf8'));
                        if (settingData && typeof settingData === 'object') {
                            if (settingData.id) {
                                SettingInfo.delete(settingData.id);
                            }
                            const loadedSetting = SettingInfo.fromJSON ? SettingInfo.fromJSON(settingData) : new SettingInfo(settingData);
                            currentSetting = loadedSetting;
                        }
                    } catch (settingError) {
                        console.warn('Failed to restore setting from save:', settingError.message);
                        currentSetting = null;
                    }
                } else {
                    currentSetting = null;
                }

                // Load game world data
                const gameWorldPath = path.join(saveDir, 'gameWorld.json');
                if (fs.existsSync(gameWorldPath)) {
                    const gameWorldData = JSON.parse(fs.readFileSync(gameWorldPath, 'utf8'));

                    // Clear existing game world
                    gameLocations.clear();
                    gameLocationExits.clear();
                    regions.clear();
                    Region.clear();

                    // Recreate Location instances
                    for (const [id, locationData] of Object.entries(gameWorldData.locations || {})) {
                        const location = new Location({
                            description: locationData.description ?? null,
                            baseLevel: locationData.baseLevel ?? null,
                            id: locationData.id,
                            name: locationData.name ?? null,
                            imageId: locationData.imageId ?? null,
                            isStub: locationData.isStub ?? false,
                            stubMetadata: locationData.stubMetadata ?? null,
                            hasGeneratedStubs: locationData.hasGeneratedStubs ?? false,
                            statusEffects: locationData.statusEffects || [],
                            npcIds: locationData.npcIds || [],
                            thingIds: locationData.thingIds || []
                        });

                        const exitsByDirection = locationData.exits || {};
                        for (const [direction, exitInfo] of Object.entries(exitsByDirection)) {
                            if (!exitInfo || !exitInfo.destination) {
                                continue;
                            }

                            const exitId = exitInfo.id || undefined;
                            let exit = exitId ? gameLocationExits.get(exitId) : null;

                            if (!exit) {
                                exit = new LocationExit({
                                    description: exitInfo.description || `Path to ${exitInfo.destination}`,
                                    destination: exitInfo.destination,
                                    bidirectional: exitInfo.bidirectional !== false,
                                    id: exitId
                                });
                                gameLocationExits.set(exit.id, exit);
                            }

                            location.addExit(direction, exit);
                        }

                        gameLocations.set(id, location);
                    }

                    // Recreate LocationExit instances not already attached
                    for (const [id, exitData] of Object.entries(gameWorldData.locationExits || {})) {
                        if (gameLocationExits.has(id)) {
                            continue;
                        }
                        const exit = new LocationExit({
                            description: exitData.description,
                            destination: exitData.destination,
                            bidirectional: exitData.bidirectional,
                            id: exitData.id
                        });
                        gameLocationExits.set(id, exit);
                    }

                    for (const [id, regionData] of Object.entries(gameWorldData.regions || {})) {
                        try {
                            const region = Region.fromJSON(regionData);
                            regions.set(id, region);
                        } catch (regionError) {
                            console.warn(`Failed to load region ${id}:`, regionError.message);
                        }
                    }
                }

                // Load chat history
                const chatHistoryPath = path.join(saveDir, 'chatHistory.json');
                if (fs.existsSync(chatHistoryPath)) {
                    chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf8')) || [];
                }

                // Load generated images
                const imagesPath = path.join(saveDir, 'images.json');
                if (fs.existsSync(imagesPath)) {
                    generatedImages.clear();
                    const imagesData = JSON.parse(fs.readFileSync(imagesPath, 'utf8')) || {};
                    for (const [id, imageData] of Object.entries(imagesData)) {
                        generatedImages.set(id, imageData);
                    }
                }

                // Clean up stale image references
                const KNOWN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
                const hasImage = (imageId) => {
                    console.log(`Checking existing image for ID: ${imageId}`);
                    if (!imageId) {
                        console.warn('No image ID provided');
                        return false;
                    }
                    if (generatedImages.has(imageId)) {
                        console.log(`Found existing image in cache for ID: ${imageId}`);
                        return true;
                    }
                    console.log(`No existing image found for ID: ${imageId}`);
                    const imagesDir = path.join(__dirname, 'public', 'generated-images');
                    return KNOWN_EXTENSIONS.some(ext => fs.existsSync(path.join(imagesDir, `${imageId}${ext}`)));
                };

                for (const thing of things.values()) {
                    console.log(`Checking existing image for thing ${thing.name}: ${thing.imageId}`);
                    if (thing && thing.imageId && !hasImage(thing.imageId)) {
                        thing.imageId = null;
                    }
                }

                for (const player of players.values()) {
                    console.log(`Checking existing image for player ${player.name}: ${player.imageId}`);
                    if (!player) {
                        continue;
                    }
                    if (player.imageId && !hasImage(player.imageId)) {
                        player.imageId = null;
                    }
                    if (typeof player.getInventoryItems === 'function') {
                        const inventoryItems = player.getInventoryItems();
                        for (const item of inventoryItems) {
                            if (item && item.imageId && !hasImage(item.imageId)) {
                                item.imageId = null;
                            }
                        }
                    }
                }

                const ensureInventoryImages = (character) => {
                    if (!character || typeof character.getInventoryItems !== 'function') {
                        return;
                    }
                    const items = character.getInventoryItems();
                    if (!Array.isArray(items)) {
                        return;
                    }
                    for (const item of items) {
                        if (!item) {
                            continue;
                        }
                        if (!item.imageId || !hasImage(item.imageId)) {
                            item.imageId = null;
                        }
                    }
                };

                if (currentPlayer) {
                    if (!currentPlayer.imageId || !hasImage(currentPlayer.imageId)) {
                        currentPlayer.imageId = null;
                    }
                    ensureInventoryImages(currentPlayer);
                }

                const currentLocationId = currentPlayer?.currentLocation || null;
                if (currentLocationId && gameLocations.has(currentLocationId)) {
                    const location = gameLocations.get(currentLocationId);
                    try {
                        queueNpcAssetsForLocation(location);
                    } catch (npcQueueError) {
                        console.warn('Failed to queue NPC assets after load:', npcQueueError.message);
                    }
                    try {
                        queueLocationThingImages(location);
                    } catch (thingQueueError) {
                        console.warn('Failed to queue location thing images after load:', thingQueueError.message);
                    }

                    const npcIds = Array.isArray(location.npcIds) ? location.npcIds : [];
                    for (const npcId of npcIds) {
                        const npc = players.get(npcId);
                        if (!npc) {
                            continue;
                        }
                        if (!npc.imageId || !hasImage(npc.imageId)) {
                            npc.imageId = null;
                        }
                        ensureInventoryImages(npc);
                    }
                }

                res.json({
                    success: true,
                    saveName: saveName,
                    metadata: metadata,
                    loadedData: {
                        currentPlayer: currentPlayer ? currentPlayer.getStatus() : null,
                        totalPlayers: players.size,
                        totalThings: things.size,
                        totalLocations: gameLocations.size,
                        totalLocationExits: gameLocationExits.size,
                        chatHistoryLength: chatHistory.length,
                        totalGeneratedImages: generatedImages.size,
                        currentSetting: currentSetting && typeof currentSetting.toJSON === 'function'
                            ? currentSetting.toJSON()
                            : null
                    },
                    message: `Game loaded successfully from: ${saveName}`
                });

            } catch (error) {
                console.error('Error loading game:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // List available saves
        app.get('/api/saves', (req, res) => {
            try {
                const savesDir = path.join(__dirname, 'saves');

                if (!fs.existsSync(savesDir)) {
                    return res.json({
                        success: true,
                        saves: [],
                        message: 'No saves directory found'
                    });
                }

                const saveDirectories = fs.readdirSync(savesDir)
                    .filter(item => {
                        const itemPath = path.join(savesDir, item);
                        return fs.statSync(itemPath).isDirectory();
                    });

                const saves = saveDirectories.map(saveName => {
                    const saveDir = path.join(savesDir, saveName);
                    const metadataPath = path.join(saveDir, 'metadata.json');

                    let metadata = {
                        saveName: saveName,
                        timestamp: 'Unknown',
                        playerName: 'Unknown',
                        playerLevel: 'Unknown'
                    };

                    if (fs.existsSync(metadataPath)) {
                        try {
                            const metadataContent = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                            metadata = { ...metadata, ...metadataContent };
                        } catch (error) {
                            console.error(`Error reading metadata for save ${saveName}:`, error);
                        }
                    }

                    return metadata;
                }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by newest first

                res.json({
                    success: true,
                    saves: saves,
                    count: saves.length,
                    message: `Found ${saves.length} save(s)`
                });

            } catch (error) {
                console.error('Error listing saves:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a save
        app.delete('/api/save/:saveName', (req, res) => {
            try {
                const { saveName } = req.params;
                const saveDir = path.join(__dirname, 'saves', saveName);

                if (!fs.existsSync(saveDir)) {
                    return res.status(404).json({
                        success: false,
                        error: `Save '${saveName}' not found`
                    });
                }

                // Remove the save directory and all its contents
                fs.rmSync(saveDir, { recursive: true, force: true });

                res.json({
                    success: true,
                    saveName: saveName,
                    message: `Save '${saveName}' deleted successfully`
                });

            } catch (error) {
                console.error('Error deleting save:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Additional API endpoint for JSON response
        app.get('/api/hello', (req, res) => {
            res.json({
                message: 'Hello World!',
                timestamp: new Date().toISOString(),
                port: PORT
            });
        });

        // API endpoint to test configuration without saving
        app.post('/api/test-config', async (req, res) => {
            try {
                const { endpoint, apiKey, model } = req.body;

                if (!endpoint || !apiKey || !model) {
                    return res.status(400).json({ error: 'Missing required parameters' });
                }

                // Test the configuration by making a simple request
                const chatEndpoint = endpoint.endsWith('/') ?
                    endpoint + 'chat/completions' :
                    endpoint + '/chat/completions';

                const requestData = {
                    model: model,
                    messages: [{ role: 'user', content: 'Hello, this is a test.' }],
                    max_tokens: 50,
                    temperature: 0.7
                };

                const response = await axios.post(chatEndpoint, requestData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout for test
                });

                if (response.data && response.data.choices && response.data.choices.length > 0) {
                    res.json({ success: true, message: 'Configuration test successful' });
                } else {
                    res.status(500).json({ error: 'Invalid response from AI API' });
                }

            } catch (error) {
                console.error('Config test error:', error);

                if (error.response) {
                    const statusCode = error.response.status;
                    const errorMessage = error.response.data?.error?.message || 'API request failed';
                    res.status(statusCode).json({ error: `API Error (${statusCode}): ${errorMessage}` });
                } else if (error.code === 'ECONNABORTED') {
                    res.status(408).json({ error: 'Request timeout' });
                } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                    res.status(503).json({ error: 'Cannot connect to API endpoint' });
                } else {
                    res.status(500).json({ error: `Test failed: ${error.message}` });
                }
            }
        });

        // Image generation functionality
        app.post('/api/images/request', async (req, res) => {
            try {
                const { entityType, entityId, force = false } = req.body || {};

                const normalizedType = typeof entityType === 'string'
                    ? entityType.trim().toLowerCase()
                    : '';

                if (!normalizedType || !entityId || typeof entityId !== 'string') {
                    return res.status(400).json({
                        success: false,
                        error: 'entityType and entityId are required'
                    });
                }

                let entity = null;
                let generator = null;
                let resolvedType = normalizedType;

                switch (normalizedType) {
                    case 'player':
                    case 'npc': {
                        entity = players.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Player with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generatePlayerImage(entity, options);
                        resolvedType = entity.isNPC ? 'npc' : 'player';
                        break;
                    }

                    case 'location': {
                        entity = gameLocations.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Location with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateLocationImage(entity, options);
                        break;
                    }

                    case 'exit':
                    case 'location-exit':
                    case 'location_exit': {
                        entity = gameLocationExits.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Location exit with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateLocationExitImage(entity, options);
                        resolvedType = 'location-exit';
                        break;
                    }

                    case 'thing':
                    case 'item':
                    case 'scenery': {
                        entity = things.get(entityId);
                        if (!entity) {
                            return res.status(404).json({
                                success: false,
                                error: `Thing with ID '${entityId}' not found`
                            });
                        }
                        generator = (options) => generateThingImage(entity, options);
                        resolvedType = entity.thingType || normalizedType;
                        break;
                    }

                    default:
                        return res.status(400).json({
                            success: false,
                            error: `Unsupported entityType '${entityType}'`
                        });
                }

                if (typeof generator !== 'function') {
                    return res.status(500).json({
                        success: false,
                        error: 'Image generator not available for requested entity type'
                    });
                }

                const generationResult = await generator({ force: Boolean(force) });

                if (!generationResult) {
                    return res.status(500).json({
                        success: false,
                        error: 'Image generation did not return a result'
                    });
                }

                const {
                    success: generationSuccess = false,
                    jobId = null,
                    job: jobSnapshot = null,
                    imageId = null,
                    skipped = false,
                    reason = null,
                    existingJob = false,
                    message = null
                } = generationResult;

                const responsePayload = {
                    success: Boolean(generationSuccess),
                    entityType: resolvedType,
                    entityId,
                    skipped: Boolean(skipped),
                    reason,
                    message,
                    existingJob: Boolean(existingJob)
                };

                if (jobId) {
                    responsePayload.jobId = jobId;
                    responsePayload.job = jobSnapshot || getJobSnapshot(jobId);
                }

                if (imageId) {
                    responsePayload.imageId = imageId;
                }

                if (!generationSuccess && skipped) {
                    return res.status(202).json(responsePayload);
                }

                if (!generationSuccess && !existingJob) {
                    return res.status(409).json(responsePayload);
                }

                return res.json(responsePayload);

            } catch (error) {
                console.error('Image request error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // API endpoint for async image generation
        app.post('/api/generate-image', async (req, res) => {
            try {
                // Check if image generation is enabled
                if (!config.imagegen || !config.imagegen.enabled) {
                    return res.status(503).json({
                        success: false,
                        error: 'Image generation is not enabled'
                    });
                }

                if (!comfyUIClient) {
                    return res.status(503).json({
                        success: false,
                        error: 'ComfyUI client not initialized or unavailable'
                    });
                }

                const { prompt, width, height, seed, negative_prompt, async: isAsync } = req.body;

                // Enhanced parameter validation
                if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Prompt is required and must be a non-empty string'
                    });
                }

                if (prompt.trim().length > 1000) {
                    return res.status(400).json({
                        success: false,
                        error: 'Prompt must be less than 1000 characters'
                    });
                }

                // Validate dimensions
                const validatedWidth = width ? parseInt(width) : config.imagegen.default_settings.image.width || 1024;
                const validatedHeight = height ? parseInt(height) : config.imagegen.default_settings.image.height || 1024;

                if (validatedWidth < 64 || validatedWidth > 4096 || validatedHeight < 64 || validatedHeight > 4096) {
                    return res.status(400).json({
                        success: false,
                        error: 'Image dimensions must be between 64 and 4096 pixels'
                    });
                }

                // Validate seed
                const validatedSeed = seed !== undefined ? parseInt(seed) : Math.floor(Math.random() * 1000000);
                if (validatedSeed < 0 || validatedSeed > 1000000) {
                    return res.status(400).json({
                        success: false,
                        error: 'Seed must be between 0 and 1000000'
                    });
                }

                const jobId = generateImageId();
                const payload = {
                    prompt: prompt.trim(),
                    width: validatedWidth,
                    height: validatedHeight,
                    seed: validatedSeed,
                    negative_prompt: negative_prompt || 'blurry, low quality, distorted'
                };

                // Create and queue the job
                const job = createImageJob(jobId, payload);
                jobQueue.push(jobId);

                // Start processing if not already running
                setTimeout(() => processJobQueue(), 0);

                // Return job ID for async tracking, or wait for completion if sync
                if (isAsync !== false) {
                    return res.json({
                        success: true,
                        jobId: jobId,
                        status: job.status,
                        message: 'Image generation job queued. Use /api/jobs/:jobId to track progress.',
                        estimatedTime: '30-90 seconds'
                    });
                } else {
                    // Legacy sync mode - wait for completion
                    return new Promise((resolve) => {
                        const checkJob = () => {
                            const currentJob = imageJobs.get(jobId);

                            if (currentJob.status === JOB_STATUS.COMPLETED) {
                                resolve(res.json({
                                    success: true,
                                    imageId: currentJob.result.imageId,
                                    images: currentJob.result.images,
                                    metadata: currentJob.result.metadata,
                                    processingTime: new Date(currentJob.completedAt) - new Date(currentJob.createdAt)
                                }));
                            } else if (currentJob.status === JOB_STATUS.FAILED || currentJob.status === JOB_STATUS.TIMEOUT) {
                                resolve(res.status(500).json({
                                    success: false,
                                    error: currentJob.error || 'Image generation failed'
                                }));
                            } else {
                                setTimeout(checkJob, 1000);
                            }
                        };

                        checkJob();
                    });
                }

            } catch (error) {
                console.error('Image generation request error:', error.message);
                return res.status(500).json({
                    success: false,
                    error: `Request failed: ${error.message}`
                });
            }
        });

        // API endpoint for job status tracking
        app.get('/api/jobs/:jobId', (req, res) => {
            const jobId = req.params.jobId;
            const job = imageJobs.get(jobId);

            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found'
                });
            }

            const response = {
                success: true,
                job: {
                    id: job.id,
                    status: job.status,
                    progress: job.progress,
                    message: job.message,
                    createdAt: job.createdAt,
                    startedAt: job.startedAt,
                    completedAt: job.completedAt
                }
            };

            // Include result if completed
            if (job.status === JOB_STATUS.COMPLETED && job.result) {
                response.result = {
                    imageId: job.result.imageId,
                    images: job.result.images,
                    metadata: job.result.metadata
                };
            }

            // Include error if failed
            if (job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
                response.error = job.error;
            }

            res.json(response);
        });

        // API endpoint to cancel a job
        app.delete('/api/jobs/:jobId', (req, res) => {
            const jobId = req.params.jobId;
            const job = imageJobs.get(jobId);

            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found'
                });
            }

            if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.TIMEOUT) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot cancel completed job'
                });
            }

            // Remove from queue if queued
            const queueIndex = jobQueue.indexOf(jobId);
            if (queueIndex > -1) {
                jobQueue.splice(queueIndex, 1);
            }

            // Mark as failed
            job.status = JOB_STATUS.FAILED;
            job.error = 'Job cancelled by user';
            job.completedAt = new Date().toISOString();

            res.json({
                success: true,
                message: 'Job cancelled successfully'
            });
        });

        // API endpoint to list all jobs
        app.get('/api/jobs', (req, res) => {
            const jobs = Array.from(imageJobs.values()).map(job => ({
                id: job.id,
                status: job.status,
                progress: job.progress,
                message: job.message,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                prompt: job.payload.prompt.substring(0, 50) + (job.payload.prompt.length > 50 ? '...' : '')
            })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            res.json({
                success: true,
                jobs: jobs,
                queue: {
                    pending: jobQueue.length,
                    processing: isProcessingJob ? 1 : 0
                }
            });
        });

        // API endpoint to get image metadata
        app.get('/api/images/:imageId', (req, res) => {
            const imageId = req.params.imageId;
            const metadata = generatedImages.get(imageId);

            if (!metadata) {
                console.log('Image not found in metadata map:', imageId);
                return res.status(404).json({
                    success: false,
                    error: 'Image not found'
                });
            }

            console.log('Retrieved image metadata for:', imageId);
            console.log(metadata);
            res.json({
                success: true,
                metadata: metadata
            });
        });

        // API endpoint to list all generated images
        app.get('/api/images', (req, res) => {
            const allImages = Array.from(generatedImages.values());
            res.json({
                success: true,
                images: allImages,
                count: allImages.length
            });
        });

    }
};
