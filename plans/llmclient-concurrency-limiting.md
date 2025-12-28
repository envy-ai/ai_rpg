# LLMClient Concurrency Limiting Implementation Plan

**Date:** 2025-12-26  
**File:** LLMClient.js  
**Purpose:** Add concurrency limiting to prevent overwhelming the AI API with concurrent requests

---

## Current State Analysis

The [`LLMClient.js`](LLMClient.js:1) class currently handles requests **sequentially** with retry logic. Each call to [`chatCompletion()`](LLMClient.js:392) waits for the previous request to complete before starting the next one.

### Current Flow

```javascript
// Current sequential behavior
await LLMClient.chatCompletion(...);  // Request 1 completes
await LLMClient.chatCompletion(...);  // Request 2 starts after Request 1
await LLMClient.chatCompletion(...);  // Request 3 starts after Request 2
```

### Identified Limitations

1. **No concurrent request control** - Multiple callers cannot issue parallel requests safely
2. **No request queue management** - No way to limit concurrent requests globally
3. **Potential API rate limit issues** - If multiple parts of the code call `chatCompletion()` simultaneously, they could hit rate limits

---

## Proposed Solution: Semaphore Pattern

Implement a **semaphore** (also known as a "concurrency limiter") that:

1. Limits the number of concurrent requests to a configured maximum
2. Queues requests when the limit is reached
3. Releases the semaphore when a request completes

---

## Implementation Plan

### Phase 1: Add Semaphore Class

Create a simple semaphore class at the top of [`LLMClient.js`](LLMClient.js:1):

```javascript
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.current--;

    if (this.queue.length > 0 && this.current < this.maxConcurrent) {
      const next = this.queue.shift();
      this.current++;
      next();
    }
  }
}
```

### Phase 2: Add Configuration Support

Add a new config option to [`config.default.yaml`](config.default.yaml):

```yaml
ai:
  # ... existing config ...
  max_concurrent_requests: 3 # Maximum concurrent LLM requests (default: 3)
```

Add to [`LLMClient.ensureAiConfig()`](LLMClient.js:200):

```javascript
static ensureAiConfig() {
    const globalConfig = Globals?.config;
    if (!globalConfig || typeof globalConfig !== 'object') {
        throw new Error('Globals.config is not set; AI configuration unavailable.');
    }
    const aiConfig = globalConfig.ai;
    if (!aiConfig || typeof aiConfig !== 'object') {
        throw new Error('Globals.config.ai is not set; AI configuration unavailable.');
    }
    return aiConfig;
}

static getMaxConcurrent() {
    const config = LLMClient.ensureAiConfig();
    const maxConcurrent = Number(config.max_concurrent_requests);
    return Number.isInteger(maxConcurrent) && maxConcurrent > 0
        ? maxConcurrent
        : 1;  // Default to 1 (sequential) if not configured
}
```

### Phase 3: Create Semaphore Instance

Add a static semaphore instance to the [`LLMClient`](LLMClient.js:8) class:

```javascript
class LLMClient {
  static #semaphore = null;

  static #ensureSemaphore() {
    if (!LLMClient.#semaphore) {
      const maxConcurrent = LLMClient.getMaxConcurrent();
      LLMClient.#semaphore = new Semaphore(maxConcurrent);
      console.log(
        `🔒 LLMClient semaphore initialized with maxConcurrent=${maxConcurrent}`
      );
    }
    return LLMClient.#semaphore;
  }

  // ... existing code ...
}
```

### Phase 4: Update chatCompletion Method

Wrap the request logic in [`chatCompletion()`](LLMClient.js:392) to use the semaphore:

```javascript
static async chatCompletion({
    messages,
    maxTokens,
    temperature,
    model,
    apiKey,
    endpoint,
    timeoutMs,
    timeoutScale = 1,
    metadataLabel = '',
    metadata,
    retryAttempts = null,
    headers = {},
    additionalPayload = {},
    onResponse = null,
    validateXML = true,
    requiredTags = [],
    waitAfterError = 10,
    dumpReasoningToConsole = false,
    debug = false,
    frequencyPenalty = null,
    presencePenalty = null,
    seed = Math.random(),
    stream = undefined,
    runInBackground = false,
    maxConcurrent = null  // NEW: Optional override
} = {}) {
    // ... existing parameter validation ...

    const semaphore = LLMClient.#ensureSemaphore();

    // Acquire semaphore before making request
    await semaphore.acquire();

    try {
        // ... existing request logic ...
        // Make axios call, handle response, etc.
    } finally {
        // Always release semaphore, even on error
        semaphore.release();
    }
}
```

### Phase 5: Add Optional maxConcurrent Override

Allow callers to override the global concurrency limit for specific requests:

```javascript
static async chatCompletion({ ..., maxConcurrent = null } = {}) {
    // ... existing code ...

    const globalMax = LLMClient.getMaxConcurrent();
    const effectiveMax = maxConcurrent !== null && Number.isInteger(maxConcurrent) && maxConcurrent > 0
        ? maxConcurrent
        : globalMax;

    // Create a temporary semaphore with the effective max
    const semaphore = new Semaphore(effectiveMax);

    await semaphore.acquire();
    try {
        // ... request logic ...
    } finally {
        semaphore.release();
    }
}
```

---

## Benefits

1. **Rate Limit Protection** - Prevents hitting API rate limits by limiting concurrent requests
2. **Better Resource Management** - Limits memory/CPU usage from too many concurrent connections
3. **Configurable** - Can be adjusted via config file or per-request override
4. **Backward Compatible** - Default behavior (sequential) preserved if config not set
5. **Fair Queueing** - FIFO queue ensures requests are handled in order

---

## Testing Plan

### Unit Tests

Create tests for the semaphore behavior:

```javascript
// tests/semaphore.test.js
describe("Semaphore", () => {
  it("should allow concurrent requests up to max", async () => {
    const semaphore = new Semaphore(2);
    const results = [];

    const promises = [1, 2, 3].map(async (i) => {
      await semaphore.acquire();
      await new Promise((resolve) => setTimeout(resolve, 10));
      semaphore.release();
      results.push(i);
    });

    await Promise.all(promises);
    expect(results).toEqual([0, 1, 2]); // Third request waits for first to complete
  });

  it("should queue requests beyond max", async () => {
    const semaphore = new Semaphore(2);
    const results = [];

    const promises = [1, 2, 3].map(async (i) => {
      await semaphore.acquire();
      await new Promise((resolve) => setTimeout(resolve, 10));
      semaphore.release();
      results.push(i);
    });

    await Promise.all(promises);
    expect(results).toEqual([0, 1, 2]); // Third request waits for first to complete
  });
});
```

### Integration Test

Test concurrent LLMClient calls:

```javascript
// Test that multiple chatCompletion calls respect the limit
const promises = [
  LLMClient.chatCompletion({ messages: [{ role: "user", content: "Test 1" }] }),
  LLMClient.chatCompletion({ messages: [{ role: "user", content: "Test 2" }] }),
  LLMClient.chatCompletion({ messages: [{ role: "user", content: "Test 3" }] }),
  LLMClient.chatCompletion({ messages: [{ role: "user", content: "Test 4" }] }),
];

await Promise.all(promises); // With maxConcurrent=2, should process 2 at a time
```

---

## Migration Notes

### Breaking Changes

None - This is a pure addition that doesn't change existing behavior.

### Configuration Changes

Add `ai.max_concurrent_requests` to [`config.default.yaml`](config.default.yaml) with default value `1` (sequential behavior preserved).

### Deprecations

None.

---

## Alternative Approaches Considered

### Option 1: p-limit Library

**Pros:** Well-tested, feature-rich
**Cons:** Additional dependency, may be overkill for simple use case

### Option 2: Async Queue

**Pros:** Simple, built-in Promise-based
**Cons:** Doesn't handle concurrent limit, just serializes

### Option 3: Semaphore (CHOSEN)

**Pros:** Lightweight, no dependencies, precise control over concurrency
**Cons:** Requires manual queue management

---

## Implementation Order

1. ✅ Create [`Semaphore`](LLMClient.js) class
2. ✅ Add [`getMaxConcurrent()`](LLMClient.js) static method
3. ✅ Add [`#ensureSemaphore()`](LLMClient.js) static method
4. ✅ Update [`chatCompletion()`](LLMClient.js:392) to use semaphore
5. ✅ Add config option to [`config.default.yaml`](config.default.yaml)
6. ✅ Write unit tests
7. ✅ Update documentation

---

## Notes

- The semaphore pattern is a classic concurrency control pattern used in many Node.js libraries
- Consider adding metrics to track queue depth and wait times
- For production, consider adding a circuit breaker pattern to fail fast when overloaded
