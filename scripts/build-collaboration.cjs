const esbuild = require('esbuild');
const path = require('node:path');
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'collaboration-client-entry.js')],
  outfile: path.join(__dirname, '..', 'collaboration-client.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome130'
});
