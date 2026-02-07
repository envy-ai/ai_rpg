#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT_DIR, 'tmp', 'playwright_settings_capture');

const BASE_URL = (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:7777').replace(/\/+$/, '');
const SETTINGS_PATH = process.env.PLAYWRIGHT_SETTINGS_PATH || '/settings';
const TARGET_URL = `${BASE_URL}${SETTINGS_PATH}`;

const DESKTOP_SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'settings-desktop.png');
const MOBILE_SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'settings-mobile.png');
const RESULT_PATH = path.join(ARTIFACT_DIR, 'result.json');

function ensureDirectory() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function capturePage(page, screenshotPath) {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: screenshotPath, fullPage: true });
}

async function verifySettingsLayout(page) {
    const checks = await page.evaluate(() => {
        const workspace = document.querySelector('.settings-workspace');
        const oldGrid = document.querySelector('.settings-grid');
        const libraryPanel = document.querySelector('.settings-library-panel');
        const editorPanel = document.querySelector('.settings-editor-panel');
        const s = (el) => (el ? window.getComputedStyle(el) : null);

        return {
            hasWorkspace: Boolean(workspace),
            hasOldGrid: Boolean(oldGrid),
            libraryOverflowY: s(libraryPanel)?.overflowY || null,
            editorOverflowY: s(editorPanel)?.overflowY || null,
        };
    });

    if (!checks.hasWorkspace) {
        throw new Error(
            'Expected .settings-workspace on /settings page, but it was not found.',
        );
    }
    if (checks.hasOldGrid) {
        throw new Error(
            'Detected legacy .settings-grid layout on /settings page; expected redesigned layout.',
        );
    }

    return checks;
}

async function main() {
    ensureDirectory();

    const browser = await chromium.launch({ headless: true });
    let desktopPage = null;
    let mobilePage = null;
    const pageErrors = [];
    const attachPageErrorListener = (page, label) => {
        page.on('pageerror', (error) => {
            pageErrors.push(`${label}: ${error.message}`);
        });
    };

    try {
        desktopPage = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
        attachPageErrorListener(desktopPage, 'desktop');
        await capturePage(desktopPage, DESKTOP_SCREENSHOT_PATH);
        const checks = await verifySettingsLayout(desktopPage);

        mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
        attachPageErrorListener(mobilePage, 'mobile');
        await capturePage(mobilePage, MOBILE_SCREENSHOT_PATH);

        if (pageErrors.length) {
            throw new Error(`Browser page errors detected: ${JSON.stringify(pageErrors)}`);
        }

        const result = {
            success: true,
            targetUrl: TARGET_URL,
            desktopScreenshotPath: DESKTOP_SCREENSHOT_PATH,
            mobileScreenshotPath: MOBILE_SCREENSHOT_PATH,
            checks,
            capturedAt: new Date().toISOString(),
        };
        fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

        console.log('Settings page capture complete.');
        console.log(`Target URL: ${TARGET_URL}`);
        console.log(`Desktop screenshot: ${DESKTOP_SCREENSHOT_PATH}`);
        console.log(`Mobile screenshot: ${MOBILE_SCREENSHOT_PATH}`);
        console.log(`Result JSON: ${RESULT_PATH}`);
        console.log(`Layout checks: ${JSON.stringify(checks)}`);
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error(`Settings page capture failed: ${error.message}`);
    process.exit(1);
});
