const { _electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

(async () => {
  const executablePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Java Blueprints.exe');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'java-blueprints-large-'));
  const statements = Array.from({ length: 1000 }, (_, index) => `        sum += ${index};`);
  const source = ['public class LargeMonolith {', '    public static void main(String[] args) {',
    '        int sum = 0;', ...statements, '        System.out.println(sum);', '    }', '}'].join('\n');
  const files = { 'LargeMonolith.java': source };
  const app = await _electron.launch({ executablePath, args: [`--profile-dir=${profile}`], timeout: 60000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-command="analyze"]');
    await page.evaluate(({ name, source }) => {
      if (document.querySelector('[data-command="autocheck"]').classList.contains('enabled')) window.blueprintsWorkbench.command('autocheck');
      buffers[name] = source;
      window.blueprintsWorkbench.showDock('tests');
      document.querySelector('#mainClassInput').value = 'LargeMonolith';
      document.querySelector('#mainClassInput').dispatchEvent(new Event('input', { bubbles: true }));
      showFile(name);
    }, { name: 'LargeMonolith.java', source });
    await page.waitForFunction(() => document.querySelector('#astStatus')?.textContent?.includes('constructs'), null, { timeout: 60000 });
    const visualNodes = await page.locator('.flow > .graph-node').count();
    if (visualNodes < 1000) throw new Error(`Only ${visualNodes} graph nodes rendered for a 1000-statement Java file`);
    const result = await page.evaluate(async files => {
      const bridge = window.blueprintsDesktop;
      const analysis = await bridge.invoke('java:analyze', { files });
      const run = await bridge.invoke('java:run', { files, stdin: '', mainClass: 'LargeMonolith' });
      return { astNodes: analysis.graph?.length, syntaxErrors: analysis.syntaxErrors?.length, runCode: run.code, output: run.stdout?.trim() };
    }, files);
    if (result.astNodes < 1000 || result.syntaxErrors || result.runCode !== 0 || result.output !== '499500')
      throw new Error(`Large-file acceptance failed: ${JSON.stringify(result)}`);
    const rawEditor = page.locator('.ast-node .graph-field textarea').first();
    await rawEditor.fill('sum += 1;');
    await rawEditor.press('Tab');
    await page.waitForFunction(() => code.value.includes('sum += 1;'));
    const edited = await page.evaluate(() => ({ changed: code.value.includes('sum += 1;'), retained: code.value.includes('sum += 999;'), lines: code.value.split('\n').length }));
    if (!edited.changed || !edited.retained || edited.lines !== source.split('\n').length)
      throw new Error(`AST node editing damaged the Java file: ${JSON.stringify(edited)}`);
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => ({ restored: code.value.includes('sum += 0;'), undo: undoStack.length, redo: redoStack.length, first: code.value.match(/sum \+= \d+;/)?.[0] }));
    if (!undone.restored) throw new Error(`AST edit undo failed: ${JSON.stringify(undone)}`);
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => code.value.includes('sum += 1;'));
    await page.locator('[data-command="extract-method"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-command="extract-method"]').disabled, null, { timeout: 120000 });
    await page.locator('[data-command="extract-method"]').click();
    await page.waitForFunction(() => 'LargeMonolithExtracted.java' in buffers || document.querySelector('#dockContent')?.textContent?.includes('was not extracted'), null, { timeout: 120000 });
    const extraction = await page.evaluate(() => ({
      helper: 'LargeMonolithExtracted.java' in buffers,
      wrapper: buffers['LargeMonolith.java']?.includes('LargeMonolithExtracted.run(args)'),
      dock: document.querySelector('#dockContent')?.textContent?.slice(0, 450)
    }));
    if (!extraction.helper || !extraction.wrapper || !extraction.dock.includes('Passed: 8 / 8'))
      throw new Error(`Large-file method extraction failed: ${JSON.stringify(extraction)}`);
    console.log(JSON.stringify({ lines: source.split('\n').length, visualNodes, ...result, astEdit: edited, extraction }, null, 2));
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
