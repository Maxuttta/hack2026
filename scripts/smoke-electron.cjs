const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

(async () => {
  const executablePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Java Blueprints.exe');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'java-blueprints-smoke-'));
  const app = await _electron.launch({ executablePath, args: [`--profile-dir=${profile}`], timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-command="optimize-example"]');
    await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'desktop-smoke.png'), fullPage: true });
    const bridge = await page.evaluate(() => typeof window.blueprintsDesktop?.invoke);
    if (bridge !== 'function') throw new Error('Desktop IPC bridge unavailable');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-command="load-demo"]').click();
    await page.locator('[data-command="analyze"]').click();
    await page.waitForFunction(() => document.querySelector('#dockContent')?.textContent?.includes('O(n²)'), null, { timeout: 30000 });
    await page.locator('[data-dock="structure"]').click();
    await page.waitForFunction(() => document.querySelector('#dockContent')?.textContent?.includes('DemoMonolith'), null, { timeout: 5000 });
    await page.locator('[data-command="optimize-example"]').click();
    await page.waitForFunction(() => buffers['DemoMonolith.java']?.includes('Parser.readItems(System.in)') || document.querySelector('#dockContent')?.textContent?.includes('not applied'), null, { timeout: 60000 });
    const optimized = await page.evaluate(() => buffers['DemoMonolith.java'].includes('Parser.readItems(System.in)') && 'Parser.java' in buffers && 'Analyzer.java' in buffers);
    if (!optimized) {
      const state = await page.evaluate(() => ({ dock: document.querySelector('#dockContent')?.textContent?.slice(0, 1000), lines: buffers['DemoMonolith.java']?.split('\n').length, active, message: document.querySelector('#message')?.textContent }));
      throw new Error(`Example transformation did not apply: ${JSON.stringify(state)}`);
    }
    await page.waitForFunction(() => document.querySelector('#dockContent')?.textContent?.includes('Passed: 8 / 8'), null, { timeout: 60000 }).catch(async error => {
      const state = await page.evaluate(() => ({ dock: document.querySelector('#dockContent')?.textContent, message: document.querySelector('#message')?.textContent, active, files: Object.keys(buffers) }));
      throw new Error(`${error.message}\n${JSON.stringify(state)}`);
    });
    const summary = (await page.locator('#dockContent').textContent()).replace(/\s+/g, ' ').trim();
    await page.locator('[data-file="Analyzer.java"]').click();
    await page.evaluate(() => {
      code.value = code.value.replace('":"', '"-"');
      code.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#autocheckLabel')?.textContent?.includes('Mismatch'), null, { timeout: 60000 });
    const regression = await page.locator('#autocheckLabel').textContent();
    await page.locator('[data-command="probe"]').click();
    await page.waitForFunction(() => document.querySelector('.probe-card')?.textContent?.includes('Counterexample found'), null, { timeout: 60000 });
    const counterexample = (await page.locator('.probe-card').textContent()).replace(/\s+/g, ' ').slice(0, 140);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ bridge, optimized, summary: summary.slice(0, 350), regression, counterexample, errors }, null, 2));
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
