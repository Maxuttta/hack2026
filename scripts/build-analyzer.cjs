const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const java = path.join(root, 'runtime', 'bin', 'javac.exe');
const source = path.join(root, 'analyzer', 'JavaAnalyzer.java');
const output = path.join(root, 'analyzer', 'bin');
if (!fs.existsSync(java)) throw new Error('Bundled Java compiler is missing');
fs.mkdirSync(output, { recursive: true });
const result = spawnSync(java, ['-encoding', 'UTF-8', '-d', output, source], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
