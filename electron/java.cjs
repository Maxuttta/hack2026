const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const MAX_FILES = 200;
const MAX_SOURCE_SIZE = 2_000_000;
const MAX_OUTPUT = 1_000_000;
const TIMEOUT_MS = 20_000;

function tool(name) {
  const bundled = path.join(process.resourcesPath || path.join(__dirname, '..'), 'runtime', 'bin', `${name}.exe`);
  if (require('node:fs').existsSync(bundled)) return bundled;
  const jdk = process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', `${name}.exe`);
  return jdk && require('node:fs').existsSync(jdk) ? jdk : name;
}

function compiler() {
  const bundledJava = path.join(process.resourcesPath || path.join(__dirname, '..'), 'runtime', 'bin', 'java.exe');
  return require('node:fs').existsSync(bundledJava)
    ? { command: bundledJava, prefix: ['-Dfile.encoding=UTF-8', '-m', 'jdk.compiler/com.sun.tools.javac.Main'] }
    : { command: tool('javac'), prefix: [] };
}

function execute(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', done = false;
    let timedOut = false, truncated = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    const collect = (field, chunk) => {
      const next = chunk.toString('utf8');
      if (field === 'out') {
        if (stdout.length + next.length > MAX_OUTPUT) truncated = true;
        stdout = (stdout + next).slice(0, MAX_OUTPUT);
      } else {
        if (stderr.length + next.length > MAX_OUTPUT) truncated = true;
        stderr = (stderr + next).slice(0, MAX_OUTPUT);
      }
      if (truncated) child.kill('SIGKILL');
    };
    child.stdout.on('data', chunk => collect('out', chunk));
    child.stderr.on('data', chunk => collect('err', chunk));
    child.on('error', error => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: error.message }); } });
    child.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr, timedOut, truncated }); } });
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin || '');
  });
}

function safeName(name) {
  if (typeof name !== 'string' || !name.endsWith('.java') || name.includes('\0') || path.isAbsolute(name)) throw new Error('Invalid Java file name');
  const normalized = name.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Invalid Java file name');
  return normalized;
}

async function makeSources(files, root) {
  if (!files || typeof files !== 'object') throw new Error('No Java sources supplied');
  const entries = Object.entries(files);
  if (!entries.length || entries.length > MAX_FILES) throw new Error('The project must contain 1–200 Java files');
  const paths = [];
  for (const [name, source] of entries) {
    const relative = safeName(name);
    if (typeof source !== 'string' || source.length > MAX_SOURCE_SIZE) throw new Error(`Invalid size: ${relative}`);
    const target = path.join(root, 'src', relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, 'utf8');
    paths.push(target);
  }
  return paths;
}

function diagnostics(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/([^:\r\n]+\.java):(\d+):\s*(error|warning):\s*(.+)/);
    if (match) found.push({ file: path.basename(match[1]), line: Number(match[2]), severity: match[3], message: match[4] });
  }
  return found;
}

function analyzerClasses() {
  const packaged = path.join(process.resourcesPath || path.join(__dirname, '..'), 'analyzer');
  return require('node:fs').existsSync(path.join(packaged, 'JavaAnalyzer.class'))
    ? packaged : path.join(__dirname, '..', 'analyzer', 'bin');
}

async function parseSources(root, sources) {
  const result = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', analyzerClasses(), 'JavaAnalyzer', root, ...sources]);
  if (result.code !== 0 || result.timedOut || result.truncated) throw new Error(result.stderr || 'Could not parse Java code');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Analyzer returned an invalid result'); }
}

async function findMain(root, sources, preferred) {
  const entries = (await parseSources(root, sources)).mainClasses || [];
  const names = [...new Set(entries.map(entry => entry.className))];
  const requested = String(preferred || '').trim();
  if (requested) {
    const matches = names.filter(name => name === requested || name.split('.').at(-1) === requested);
    if (matches.length === 1) return { entry: matches[0] };
    return { error: matches.length ? 'Main class name is ambiguous. Enter its fully qualified name.'
      : `No public static void main(String[] args) found in ${requested}.` };
  }
  if (names.length === 1) return { entry: names[0] };
  return { error: names.length ? 'Multiple main classes found. Enter the fully qualified main class in the Tests panel.'
    : 'No public static void main(String[] args) found.' };
}

async function compileIn(root, files) {
  const sources = await makeSources(files, root);
  const classes = path.join(root, 'classes');
  await fs.mkdir(classes, { recursive: true });
  const javac = compiler();
  const result = await execute(javac.command, [...javac.prefix, '-encoding', 'UTF-8', '-d', classes, ...sources]);
  return { ...result, diagnostics: diagnostics(result.stderr), classes, sources };
}

async function withWorkspace(action) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'java-blueprints-'));
  try { return await action(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function compile(files) {
  return withWorkspace(async root => {
    const result = await compileIn(root, files);
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, diagnostics: result.diagnostics, timedOut: result.timedOut };
  });
}

async function run(files, mainClass, stdin = '') {
  return withWorkspace(async root => {
    const built = await compileIn(root, files);
    if (built.code !== 0) return { stage: 'compile', code: built.code, stdout: built.stdout,
      stderr: built.stderr, diagnostics: built.diagnostics, timedOut: built.timedOut, truncated: built.truncated };
    const selected = await findMain(path.join(root, 'src'), built.sources, mainClass);
    if (selected.error) return { stage: 'entry', code: -1, stderr: selected.error, stdout: '', diagnostics: [] };
    const result = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', built.classes, selected.entry], { stdin });
    return { stage: 'run', ...result, mainClass: selected.entry, diagnostics: [] };
  });
}

function behaviorDifference(before, after) {
  if (before.timedOut || after.timedOut) return 'Execution timed out; behavior could not be verified';
  if (before.truncated || after.truncated) return 'Output limit exceeded; behavior could not be verified';
  if (before.code !== after.code) return `Exit code: ${before.code} → ${after.code}`;
  for (const field of ['stdout', 'stderr']) {
    if (before[field] === after[field]) continue;
    const left = before[field].split(/\r?\n/), right = after[field].split(/\r?\n/);
    const line = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index)
      .find(index => left[index] !== right[index]);
    return `${field}, line ${(line ?? 0) + 1}`;
  }
  return null;
}

async function compare(baseline, current, cases, mainClass) {
  if (!Array.isArray(cases) || cases.length > 20) throw new Error('At most 20 test inputs are supported');
  return withWorkspace(async root => {
    const oldBuild = await compileIn(path.join(root, 'before'), baseline);
    const newBuild = await compileIn(path.join(root, 'after'), current);
    if (oldBuild.code || newBuild.code) return { compiled: false,
      baseline: { code: oldBuild.code, stderr: oldBuild.stderr, diagnostics: oldBuild.diagnostics },
      current: { code: newBuild.code, stderr: newBuild.stderr, diagnostics: newBuild.diagnostics } };
    const oldMain = await findMain(path.join(root, 'before', 'src'), oldBuild.sources, mainClass);
    const newMain = await findMain(path.join(root, 'after', 'src'), newBuild.sources, mainClass);
    if (oldMain.error || newMain.error) return { compiled: true, error: oldMain.error || newMain.error };
    const results = [];
    for (const input of cases) {
      if (typeof input !== 'string' || input.length > 50_000) throw new Error('Test input is too long');
      const before = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', oldBuild.classes, oldMain.entry], { stdin: input });
      const after = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', newBuild.classes, newMain.entry], { stdin: input });
      const difference = behaviorDifference(before, after);
      results.push({ input, before, after, pass: difference === null, difference });
    }
    return { compiled: true, results, passed: results.filter(x => x.pass).length, total: results.length };
  });
}

async function probe(baseline, current, seeds, mainClass) {
  if (!Array.isArray(seeds) || seeds.length > 20 || seeds.some(input => typeof input !== 'string' || input.length > 50_000))
    throw new Error('Invalid input scenarios');
  return withWorkspace(async root => {
    const oldBuild = await compileIn(path.join(root, 'before'), baseline);
    const newBuild = await compileIn(path.join(root, 'after'), current);
    if (oldBuild.code || newBuild.code) return { compiled: false,
      baseline: { code: oldBuild.code, stderr: oldBuild.stderr, diagnostics: oldBuild.diagnostics },
      current: { code: newBuild.code, stderr: newBuild.stderr, diagnostics: newBuild.diagnostics } };
    const oldMain = await findMain(path.join(root, 'before', 'src'), oldBuild.sources, mainClass);
    const newMain = await findMain(path.join(root, 'after', 'src'), newBuild.sources, mainClass);
    if (oldMain.error || newMain.error) return { error: oldMain.error || newMain.error };
    const candidates = new Set(['', '\n', '0\n', '1\n', '-1\n', 'a\n', 'a\na\n', 'a\nb\na\n']);
    for (const seed of seeds) {
      candidates.add(seed);
      const lines = seed.split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        candidates.add(lines[0] + '\n');
        candidates.add(lines.at(-1) + '\n');
        candidates.add([...lines].reverse().join('\n') + '\n');
        candidates.add(lines[0] + '\n' + lines[0] + '\n');
        if (lines.length > 1) candidates.add(lines.slice(0, -1).join('\n') + '\n');
      }
    }
    let checked = 0, unverified = 0, found = null;
    const started = Date.now();
    const runCase = async input => {
      const before = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', oldBuild.classes, oldMain.entry], { stdin: input });
      const after = await execute(tool('java'), ['-Dfile.encoding=UTF-8', '-cp', newBuild.classes, newMain.entry], { stdin: input });
      checked++;
      const inconclusive = !!(before.timedOut || after.timedOut || before.truncated || after.truncated);
      if (inconclusive) unverified++;
      return { input, before, after, inconclusive, difference: behaviorDifference(before, after) };
    };
    for (const input of candidates) {
      if (checked >= 20 || Date.now() - started > 45_000) break;
      const result = await runCase(input);
      if (result.difference && !result.inconclusive) { found = result; break; }
    }
    if (found) {
      let lines = found.input.split(/\r?\n/).filter(Boolean);
      for (let i = 0; i < lines.length && checked < 30 && Date.now() - started < 45_000;) {
        const candidate = [...lines.slice(0, i), ...lines.slice(i + 1)];
        const input = candidate.length ? candidate.join('\n') + '\n' : '';
        const result = await runCase(input);
        if (result.difference && !result.inconclusive) { lines = candidate; found = result; i = 0; }
        else i++;
      }
    }
    return { compiled: true, checked, unverified, counterexample: found };
  });
}

async function analyze(files) {
  return withWorkspace(async root => {
    const sources = await makeSources(files, root);
    return parseSources(path.join(root, 'src'), sources);
  });
}

module.exports = { compile, run, compare, probe, analyze, safeName };
