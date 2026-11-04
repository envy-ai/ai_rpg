const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
  const artifact = path.resolve('tmp/faction-prompt-flow/faction-prompt-flow.html');
  await page.goto('file://' + artifact);
  await page.waitForSelector('#diagram svg', { timeout: 60000 });
  const svg = await page.locator('#diagram').innerHTML();
  fs.writeFileSync('tmp/faction-prompt-flow/faction-prompt-flow.svg', svg);
  let html = fs.readFileSync(artifact, 'utf8');
  html = html.replace('<div id="diagram"></div>', '<div id="diagram">' + svg + '</div>')
   .replace(/<script type="module">[\s\S]*?<\/script>/, '')
   .replace('<p id="status">Rendering diagram…</p>', '');
  fs.writeFileSync(artifact, html);
  await page.goto('file://' + artifact);
  await page.locator('#fit').click();
  await page.screenshot({ path: 'tmp/faction-prompt-flow/preview.png' });
  if (await page.locator('#diagram svg').count() !== 1) throw new Error('Expected one standalone rendered diagram.');
  const count = await page.locator('#diagram .node').count();
  if (count !== 36) throw new Error('Expected all 36 flow nodes; got ' + count);
  console.log(JSON.stringify({ renderedNodes: count, svgViewBox: await page.locator('#diagram svg').getAttribute('viewBox'), offlineHtml: artifact }));
 } finally { await browser.close(); }
})().catch(e=>{ console.error(e);process.exitCode=1; });
