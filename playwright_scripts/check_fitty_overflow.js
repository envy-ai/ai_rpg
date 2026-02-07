const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const url = 'http://127.0.0.1:7777';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const selectors = ['.entity-name', '.party-name', '#chatPlayerName'];
    const elements = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const tracked = Array.from(new Set(elements));

    const visible = tracked.filter((element) => {
      const style = window.getComputedStyle(element);
      if (!style || style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const overflows = visible
      .map((element) => {
        const text = (element.textContent || '').trim();
        const clientWidth = Math.ceil(element.clientWidth);
        const scrollWidth = Math.ceil(element.scrollWidth);
        const fontSize = window.getComputedStyle(element).fontSize;
        return {
          text,
          className: element.className,
          clientWidth,
          scrollWidth,
          overflowPx: scrollWidth - clientWidth,
          fontSize
        };
      })
      .filter((entry) => entry.overflowPx > 1);

    return {
      totalTracked: tracked.length,
      visibleTracked: visible.length,
      overflowCount: overflows.length,
      overflows: overflows.slice(0, 20)
    };
  });

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/fitty-overflow-check.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
})();
