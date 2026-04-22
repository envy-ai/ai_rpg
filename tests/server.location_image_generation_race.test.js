const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadGenerateLocationImageHarness() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateLocationImage(location, options = {}) {');
    const end = source.indexOf('\nasync function generateLocationWeatherVariant(location, options = {}) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate generateLocationImage in server.js');
    }

    const functionSource = source.slice(start, end);
    let promptCalls = 0;
    let nextJobNumber = 1;
    let releasePrompt = null;
    const promptGate = new Promise(resolve => {
        releasePrompt = resolve;
    });
    const subscriberAdds = [];
    const scheduledTimers = [];

    const context = {
        console,
        Math,
        Boolean,
        Number,
        String,
        setTimeout: (callback, delay) => {
            scheduledTimers.push({ callback, delay });
            return scheduledTimers.length;
        },
        config: {
            imagegen: {
                enabled: true,
                location_settings: {
                    image: { width: 768, height: 512 },
                    sampling: { steps: 12 }
                },
                default_settings: {
                    image: { width: 1024, height: 1024 }
                }
            }
        },
        comfyUIClient: {},
        currentPlayer: { currentLocation: 'location-1' },
        pendingLocationImages: new Map(),
        locationImageGenerationPromises: new Map(),
        imageJobs: new Map(),
        jobQueue: [],
        JOB_STATUS: { QUEUED: 'queued' },
        hasExistingImage: () => false,
        clearLocationImageVariants: () => {},
        renderLocationImagePrompt: location => ({
            systemPrompt: `system:${location.id}`,
            generationPrompt: `prompt:${location.id}`,
            renderedTemplate: '<prompt />'
        }),
        generateImagePromptFromTemplate: async () => {
            promptCalls += 1;
            await promptGate;
            return { prompt: 'final generated location prompt' };
        },
        renderLocationFinalImagePrompt: (location, prompt) => `${prompt}\n\nTime: noon\nWeather: clear\nLocation ID: ${location.id}`,
        generateImageId: () => `job-${nextJobNumber++}`,
        buildNegativePrompt: value => value,
        resolveMegapixels: value => value || null,
        createImageJob: (jobId, payload) => {
            const job = {
                id: jobId,
                status: 'queued',
                payload,
                subscribers: new Set()
            };
            if (payload.clientId) {
                job.subscribers.add(payload.clientId);
            }
            context.imageJobs.set(jobId, job);
            return job;
        },
        processJobQueue: () => {},
        getJobSnapshot: jobId => {
            const job = context.imageJobs.get(jobId);
            return job
                ? { jobId, status: job.status, subscribers: Array.from(job.subscribers) }
                : null;
        },
        addJobSubscriber: (job, clientId) => {
            if (job && clientId) {
                job.subscribers.add(clientId);
                subscriberAdds.push({ jobId: job.id, clientId });
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.generateLocationImage = generateLocationImage;`,
        context
    );

    return {
        context,
        generateLocationImage: context.generateLocationImage,
        releasePrompt,
        getPromptCalls: () => promptCalls,
        subscriberAdds
    };
}

test('concurrent location image requests share the pre-job prompt generation', async () => {
    const {
        context,
        generateLocationImage,
        releasePrompt,
        getPromptCalls,
        subscriberAdds
    } = loadGenerateLocationImageHarness();
    const location = {
        id: 'location-1',
        imageId: null
    };

    const firstRequest = generateLocationImage(location, { clientId: 'client-a' });
    await Promise.resolve();
    const secondRequest = generateLocationImage(location, { clientId: 'client-b' });
    await Promise.resolve();

    const callsDuringRace = getPromptCalls();
    releasePrompt();
    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

    assert.equal(callsDuringRace, 1);
    assert.equal(getPromptCalls(), 1);
    assert.equal(context.jobQueue.length, 1);
    assert.equal(firstResult.jobId, 'job-1');
    assert.equal(secondResult.jobId, 'job-1');
    assert.equal(context.pendingLocationImages.get(location.id), 'job-1');

    const job = context.imageJobs.get('job-1');
    assert.ok(job);
    assert.equal(job.payload.prompt, 'final generated location prompt\n\nTime: noon\nWeather: clear\nLocation ID: location-1');
    assert.equal(job.subscribers.has('client-a'), true);
    assert.equal(job.subscribers.has('client-b'), true);
    assert.deepEqual(subscriberAdds, [{ jobId: 'job-1', clientId: 'client-b' }]);
});
