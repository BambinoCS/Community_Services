const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const legacyMissing = new Set(); // All missing-file exceptions have been retired.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    ['.git', 'node_modules', 'test-results', 'teamdevupdates'].includes(e.name) ? [] :
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
let htmlCount = 0, jsCount = 0, knownMissing = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (/\.(js|cjs)$/.test(file)) { execFileSync(process.execPath, ['--check', file]); jsCount++; }
  if (!/\.(html|js)$/.test(file) || rel.startsWith('shared/tests/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(!/sb_secret_|SUPABASE_SECRET_KEY|service_role/.test(source), 'Private credential reference in browser code: ' + rel);
  if (!file.endsWith('.html')) continue;
  htmlCount++;
  const sources = [...source.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(sources).size, sources.length, 'Duplicate script: ' + rel);
  for (const m of source.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^(https?:|mailto:)/.test(m[1])) continue;
    assert.ok(!m[1].startsWith('/'), 'Domain-root URL breaks project Pages: ' + rel);
    if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) {
      const key = rel + ':' + m[1];
      assert.ok(legacyMissing.has(key), 'New broken reference: ' + key);
      knownMissing.push(key);
    }
  }
  if (/^(community-user|verified-assistant|admin)\/frontend\//.test(rel) || ['developer.html', 'profile.html', 'chat.html'].includes(rel)) {
    assert.match(source, /id="protected-content" hidden/);
    assert.match(source, /data-auth-area=/);
    assert.equal(sources.filter(s => s.endsWith('/auth-guard.js')).length, 1);
  }
}
console.log(`PASS: node --check for ${jsCount} JS/CJS files; ${htmlCount} HTML pages checked.`);
console.log('PASS: guarded role pages, no duplicated script loads, no new broken links/scripts, project-relative paths, frontend private-key scan.');
console.log(`KNOWN BASELINE: ${knownMissing.length} pre-existing missing business script references (not authentication):`);
knownMissing.forEach(item => console.log('  ' + item));
