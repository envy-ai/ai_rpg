# API.js Redundancy Analysis

**Date:** 2025-12-26  
**File:** api.js  
**Lines:** ~9,351 (truncated at 9,351)

---

## Executive Summary

The [`api.js`](api.js) file contains significant code duplication across multiple categories. The most prominent redundancies are in logging functions, XML parsing patterns, input validation, and error response formatting. Consolidating these patterns could reduce the file size by an estimated 500-1,000 lines while improving maintainability.

---

## 1. Logging Function Redundancies (HIGH PRIORITY)

### Pattern: Nearly identical logging functions

| Function                                     | Lines       | Purpose                        |
| -------------------------------------------- | ----------- | ------------------------------ |
| [`logSummaryBatchPrompt()`](api.js:1177)     | 1177-1216   | Logs summary batch prompts     |
| [`logRandomEventPrompt()`](api.js:2455)      | 2455-2490   | Logs random event prompts      |
| [`logAttackCheck()`](api.js:3084)            | 3084-3108   | Logs attack check prompts      |
| [`logPlayerActionPrompt()`](api.js:3110)     | 3110-3136   | Logs player action prompts     |
| [`logNpcActionPrompt()`](api.js:3138)        | 3138-3163   | Logs NPC action prompts        |
| [`logAttackPrecheck()`](api.js:3296)         | 3296-3321   | Logs attack precheck prompts   |
| [`logDispositionCheck()`](api.js:3323)       | 3333-3347   | Logs disposition check prompts |
| [`logNextNpcListPrompt()`](api.js:4317)      | 4317-4341   | Logs next NPC list prompts     |
| [`logNpcMemoriesPrompt()`](api.js:4343)      | 4343-4377   | Logs NPC memories prompts      |
| [`logSettingAutofillPrompt()`](api.js:15621) | 15621-15655 | Logs setting autofill prompts  |

**Common Pattern:**

```javascript
function logXxxPrompt({ systemPrompt, generationPrompt, ... }) {
    try {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(logDir, `xxx_${timestamp}.log`);
        const parts = [
            '=== XXX SYSTEM PROMPT ===',
            systemPrompt || '(none)',
            '',
            '=== XXX GENERATION PROMPT ===',
            generationPrompt || '(none)',
            '',
            '=== XXX RESPONSE ===',
            responseText || '(no response)',
            ''
        ];
        fs.writeFileSync(logPath, parts.join('\n'), 'utf8');
    } catch (error) {
        console.warn('Failed to log xxx:', error.message);
    }
}
```

**Recommendation:** Create a unified logging utility function:

```javascript
function logPromptToFile({
  logType,
  systemPrompt,
  generationPrompt,
  responseText,
  extraData = {},
}) {
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDir, `${logType}_${timestamp}.log`);
  const parts = [
    `=== ${logType.toUpperCase()} SYSTEM PROMPT ===`,
    systemPrompt || "(none)",
    "",
    `=== ${logType.toUpperCase()} GENERATION PROMPT ===`,
    generationPrompt || "(none)",
    ...(extraData.entries || []),
    "",
    `=== ${logType.toUpperCase()} RESPONSE ===`,
    responseText || "(no response)",
    "",
  ];
  fs.writeFileSync(logPath, parts.join("\n"), "utf8");
}
```

**Estimated Savings:** ~150-200 lines

---

## 2. XML Parsing Redundancies (MEDIUM PRIORITY)

### Pattern: Similar XML parsing with Utils.parseXmlDocument(sanitizeForXml(...))

| Function                                         | Lines       | Purpose                       |
| ------------------------------------------------ | ----------- | ----------------------------- |
| [`parseAbilityEffects()`](api.js:312)            | 312-335     | Parses ability effects XML    |
| [`parseCraftingResultsResponse()`](api.js:337)   | 337-447     | Parses crafting results XML   |
| [`parseCraftingNarrativeResponse()`](api.js:513) | 513-537     | Parses crafting narrative XML |
| [`parseRandomEventResponse()`](api.js:2412)      | 2412-2453   | Parses random event XML       |
| [`parseAttackCheckResponse()`](api.js:2847)      | 2847-3082   | Parses attack check XML       |
| [`parseNpcQueueResponse()`](api.js:4229)         | 4229-4315   | Parses NPC queue XML          |
| [`parseNpcActionPlan()`](api.js:4424)            | 4424-4464   | Parses NPC action plan XML    |
| [`parseDispositionCheckResponse()`](api.js:4481) | 4481-4628   | Parses disposition check XML  |
| [`parseSettingXmlResponse()`](api.js:15520)      | 15520-15561 | Parses setting XML            |

**Common Pattern:**

```javascript
function parseXxxResponse(responseText) {
  if (!responseText || typeof responseText !== "string") {
    return null; // or [];
  }
  try {
    const doc = Utils.parseXmlDocument(
      sanitizeForXml(responseText),
      "text/xml"
    );
    const root = doc.getElementsByTagName("xxx")[0] || doc.documentElement;
    // ... extraction logic
  } catch (error) {
    console.warn("Failed to parse xxx:", error.message);
    return null; // or [];
  }
}
```

**Recommendation:** Create a generic XML parser wrapper:

```javascript
function parseXmlSafely(xmlContent, rootNodeName, parserFn) {
  if (!xmlContent || typeof xmlContent !== "string") {
    return null;
  }
  try {
    const doc = Utils.parseXmlDocument(sanitizeForXml(xmlContent), "text/xml");
    const root = rootNodeName
      ? doc.getElementsByTagName(rootNodeName)[0] || doc.documentElement
      : doc.documentElement;
    return parserFn(doc, root);
  } catch (error) {
    console.warn(`Failed to parse XML:`, error.message);
    return null;
  }
}
```

**Estimated Savings:** ~200-300 lines

---

## 3. Input Validation Redundancies (MEDIUM PRIORITY)

### Pattern: Repeated ID and string validation

**Found 30+ instances** of the pattern:

```javascript
if (!param || typeof param !== "string") {
  return res.status(400).json({ success: false, error: "X is required" });
}
```

**Locations:** Lines 8762-8767, 8821-8826, 9586-9588, 9608-9610, 9897-9899, 9907-9909, 10124-10126, 10163-10165, 10173-10175, 10198-10200, 11467-11469, 15212-15214, 15521-15523, 15765-15767, and more.

**Recommendation:** Create validation helper functions:

```javascript
function validateRequiredString(value, paramName, res) {
  if (!value || typeof value !== "string") {
    return res
      .status(400)
      .json({ success: false, error: `${paramName} is required` });
  }
  return value.trim();
}

function validateRequiredId(id, paramName, res) {
  const trimmed = validateRequiredString(id, paramName, res);
  if (trimmed && !trimmed.trim()) {
    return res
      .status(400)
      .json({ success: false, error: `${paramName} cannot be empty` });
  }
  return trimmed;
}
```

**Estimated Savings:** ~100-150 lines

---

## 4. Error Response Redundancies (MEDIUM PRIORITY)

### Pattern: Repeated 404 error responses for NPC ID

**Found 8+ instances** of:

```javascript
if (!currentPlayer) {
  return res.status(404).json({
    success: false,
    error: "No current player found",
  });
}
```

**Locations:** Lines 8582-8587, 8628-8633, 8729-8735, 8881-8886, 8912-8917, 8937-8942, 8965-8970, 9024-9029, 9237-9242, etc.

**Recommendation:** Create response helper:

```javascript
function sendPlayerNotFound(res) {
  return res.status(404).json({
    success: false,
    error: "No current player found",
  });
}
```

**Estimated Savings:** ~50-80 lines

---

## 5. NPC ID Validation Pattern (MEDIUM PRIORITY)

### Pattern: Repeated NPC ID validation across endpoints

**Found 10+ instances** of:

```javascript
const npcId = req.params.id;
if (!npcId || typeof npcId !== "string") {
  return res
    .status(400)
    .json({ success: false, error: "Character ID is required" });
}
```

**Locations:** Lines 9585-9588, 9607-9610, 9896-9899, 10022-10025, 10091-10094, 10123-10126, 10162-10165, 10217-10220, 10545-10548

**Recommendation:** Create middleware or helper function for NPC ID extraction:

```javascript
function extractNpcId(req, res) {
  const npcId = req.params.id;
  if (!npcId || typeof npcId !== "string") {
    res.status(400).json({ success: false, error: "Character ID is required" });
    return null;
  }
  return npcId.trim();
}
```

**Estimated Savings:** ~30-50 lines

---

## 6. XML Document Creation Pattern (LOW PRIORITY)

### Pattern: Repeated XML document parsing with error checking

**Found 8+ instances** of:

```javascript
const doc = Utils.parseXmlDocument(sanitizeForXml(content), "text/xml");
const parserError = doc.getElementsByTagName("parsererror")[0];
if (parserError) {
  // handle error
}
```

**Locations:** Lines 1149-1154, 1242-1246, 5134-5137, 2429-2432, 2864-2868, 4253-4257, 4441-4444, 4498-4501

**Recommendation:** Create a safe XML parser wrapper:

```javascript
function parseXmlWithErrorCheck(xmlContent, parserFn) {
  const doc = Utils.parseXmlDocument(sanitizeForXml(xmlContent), "text/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(parserError.textContent);
  }
  return parserFn(doc);
}
```

**Estimated Savings:** ~40-60 lines

---

## 7. Summary Recording Redundancies (LOW PRIORITY)

### Pattern: Similar summary entry recording functions

| Function                                    | Lines     | Purpose                      |
| ------------------------------------------- | --------- | ---------------------------- |
| [`recordEventSummaryEntry()`](api.js:2125)  | 2125-2179 | Records event summaries      |
| [`recordStatusSummaryEntry()`](api.js:2181) | 2181-2222 | Records status summaries     |
| [`recordPlausibilityEntry()`](api.js:2224)  | 2224-2257 | Records plausibility entries |
| [`recordSkillCheckEntry()`](api.js:2302)    | 2302-2329 | Records skill check entries  |
| [`recordAttackCheckEntry()`](api.js:2331)   | 2331-2371 | Records attack check entries |

These functions share similar patterns for:

- Location ID validation via [`requireLocationId()`](api.js:916)
- Entry creation with common fields (role, timestamp, parentId, locationId)
- Calling [`pushChatEntry()`](api.js:100)

**Recommendation:** Create a base summary recording function:

```javascript
function createSummaryEntry({
  type,
  content,
  locationId,
  parentId,
  timestamp,
  extraFields = {},
}) {
  const resolvedLocationId = requireLocationId(locationId, `${type} entry`);
  const entry = {
    role: "assistant",
    type,
    content,
    timestamp: timestamp || new Date().toISOString(),
    parentId: parentId || null,
    locationId: resolvedLocationId,
    ...extraFields,
  };
  return pushChatEntry(entry, collector, resolvedLocationId);
}
```

**Estimated Savings:** ~80-120 lines

---

## 8. Memory Processing Redundancies (LOW PRIORITY)

### Pattern: Similar memory generation for party members

| Function                                                | Lines     | Purpose                                        |
| ------------------------------------------------------- | --------- | ---------------------------------------------- |
| [`generateNpcMemoriesForLocationChange()`](api.js:5206) | 5206-5526 | Generates memories for NPCs when player moves  |
| [`processPartyMemoriesForCurrentTurn()`](api.js:5528)   | 5752      | Generates memories for party members each turn |

Both functions contain nearly identical logic for:

- Building filtered history entries
- Calling [`runNpcMemoriesPrompt()`](api.js:4980)
- Applying goal updates via [`applyGoalUpdatesToActor()`](api.js:4948)
- Applying disposition changes

**Recommendation:** Extract common memory processing logic into a shared function.

**Estimated Savings:** ~100-150 lines

---

## 9. Response Building Pattern (LOW PRIORITY)

### Pattern: Repeated success response building

**Found 5+ instances** of:

```javascript
res.json({
  success: true,
  player: serializeNpcForClient(currentPlayer),
  message: "X successful",
});
```

**Locations:** Lines 8567-8571, 8589-8593, 8620-8624, 9010-9014, 9053-9057, etc.

**Recommendation:** Create response helpers:

```javascript
function sendSuccess(res, data, message) {
  return res.json({
    success: true,
    ...data,
    message,
  });
}

function sendPlayerSuccess(res, message) {
  return sendSuccess(
    res,
    { player: serializeNpcForClient(currentPlayer) },
    message
  );
}
```

**Estimated Savings:** ~30-50 lines

---

## 10. Duplicate Code Blocks (LOW PRIORITY)

### Pattern: Identical code in multiple places

**Lines 6952-6958:** Duplicate `attackDamageApplication` assignment:

```javascript
if (attackDamageApplication) {
  responseData.attackDamage = attackDamageApplication;
}

if (attackDamageApplication) {
  // DUPLICATE
  responseData.attackDamage = attackDamageApplication;
}
```

**Recommendation:** Remove duplicate block.

**Estimated Savings:** ~6 lines

---

## Summary of Potential Savings

| Category              | Estimated Line Savings | Priority |
| --------------------- | ---------------------- | -------- |
| Logging Functions     | 150-200                | HIGH     |
| XML Parsing           | 200-300                | MEDIUM   |
| Input Validation      | 100-150                | MEDIUM   |
| Error Responses       | 50-80                  | MEDIUM   |
| NPC ID Validation     | 30-50                  | MEDIUM   |
| XML Document Creation | 40-60                  | LOW      |
| Summary Recording     | 80-120                 | LOW      |
| Memory Processing     | 100-150                | LOW      |
| Response Building     | 30-50                  | LOW      |
| Duplicate Code Blocks | 6                      | LOW      |
| **TOTAL**             | **686-1,160**          |          |

---

## Recommended Refactoring Plan

### Phase 1: High Priority (Logging)

1. Create `utils/prompt-logger.js` with unified `logPromptToFile()` function
2. Replace all 10 logging functions with calls to the unified function
3. Test that all logs are still generated correctly

### Phase 2: Medium Priority (Validation & Parsing)

1. Create `utils/validation.js` with validation helpers
2. Create `utils/xml-parser.js` with XML parsing wrappers
3. Replace validation patterns across endpoints
4. Replace XML parsing patterns across functions

### Phase 3: Low Priority (Response & Summary)

1. Create response helper functions
2. Consolidate summary recording functions
3. Extract common memory processing logic
4. Remove duplicate code blocks

### Phase 4: Testing

1. Run existing test suite
2. Add integration tests for new utility functions
3. Verify all API endpoints still function correctly

---

## Additional Observations

1. **Large Endpoint Function:** The `/api/chat` endpoint (lines 6295-8314) is extremely long (~2,000 lines) and handles too many responsibilities. Consider breaking it into smaller, focused endpoint handlers.

2. **Inconsistent Error Handling:** Some functions return `null`, others return empty arrays `[]`, others throw errors. Standardize error handling patterns.

3. **Magic Strings:** Repeated error messages like "Character ID is required" should be extracted to constants.

4. **Nested Callbacks:** The chat endpoint has deeply nested callbacks that could be flattened using async/await.

5. **Global State:** Heavy use of global variables (`currentPlayer`, `chatHistory`, etc.) makes testing difficult. Consider dependency injection.

---

## Conclusion

The [`api.js`](api.js) file contains substantial redundancy that can be systematically reduced through the creation of utility functions and helper modules. The most impactful refactoring would focus on:

1. **Unified logging** - saves ~150-200 lines
2. **XML parsing wrappers** - saves ~200-300 lines
3. **Validation helpers** - saves ~100-150 lines

Total potential reduction of **~500-650 lines** (5-7% of file size) with significantly improved maintainability and reduced bug surface area.
