const { defineConfig, devices } = require('@playwright/test');

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT || '', 10) || 4173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1';

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], headless: true }
        },
        {
            name: 'chromium-headed',
            use: { ...devices['Desktop Chrome'], headless: false }
        }
    ],
    webServer: shouldStartWebServer
        ? {
            command: `npm run start -- --port ${port}`,
            url: baseURL,
            reuseExistingServer: true,
            timeout: 120000,
            stdout: 'pipe',
            stderr: 'pipe'
        }
        : undefined
});
