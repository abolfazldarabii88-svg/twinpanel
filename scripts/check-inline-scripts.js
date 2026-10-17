'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

const files = ['index.html', 'telegram-native/index.html'];
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if (!scripts.length) throw new Error('No inline script found in ' + file);
  scripts.forEach((match, index) => {
    new vm.Script(match[1], { filename: file + ':inline-script-' + (index + 1) });
  });
  process.stdout.write('Inline JavaScript syntax OK: ' + file + ' (' + scripts.length + ' script(s))\n');
}
