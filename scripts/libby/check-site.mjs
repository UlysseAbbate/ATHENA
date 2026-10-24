#!/usr/bin/env node
// Checks the whole site for the mistakes that have broken it before. Runs by itself on every commit (see
// .github/workflows/libby-check.yml) and can be run by hand:  node scripts/check-site.mjs
//
// It looks for: JavaScript that does not parse; imports that point at a file that is not there (the cause of the blank site);
// pages in pages.js whose file or function is missing; /api routes that save data but never check who is asking;
// two files with the same name in different folders (the cause of the pasted-into-the-wrong-file mix-ups);
// database tables used in the code but missing from supabase/schema.sql; garbled characters (text read in the wrong encoding);
// and a few files the site cannot work without.
// It prints a list of problems and exits with an error if there are any.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

// LIBBY lives inside the Athena repo: its pages in site/libby, its server routes in functions/api/libby, its helpers in lib/libby.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'site/libby', FNS = 'functions/api/libby';
const SKIP = new Set(['node_modules', '.git', '.wrangler', '.github']);
const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const files = [SITE, FNS, 'lib/libby', 'scripts/libby'].flatMap((d) => (exists(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []))
  .concat(exists(path.join(ROOT, 'functions/api/code-login.js')) ? [path.join(ROOT, 'functions/api/code-login.js')] : [])
  .filter((f) => !rel(f).startsWith(`${SITE}/vendor/`));   // third-party libraries are not ours to check
const js = files.filter((f) => /\.(m?js)$/.test(f));

/* ------------------------------------------------------------ 1. every JavaScript file parses */
for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${rel(f)} has a syntax error: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'see node --check'}`);
}
const py = files.filter((f) => f.endsWith('.py'));
if (py.length && spawnSync('python3', ['--version']).status === 0) {
  for (const f of py) {
    const r = spawnSync('python3', ['-c', `import ast,sys;ast.parse(open(sys.argv[1]).read())`, f], { encoding: 'utf8' });
    if (r.status !== 0) fail(`${rel(f)} (Python) has a syntax error`);
  }
}

/* ------------------------------------------------------------ 2. every relative import points at a real file */
const IMPORT_RES = [
  /(?:^|[\n;])\s*(?:import|export)\s[^;'"]*?from\s*['"](\.[^'"]+)['"]/g,
  /(?:^|[\n;])\s*import\s*['"](\.[^'"]+)['"]/g,
  /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
];
for (const f of js) {
  const src = read(f);
  for (const re of IMPORT_RES) {
    for (const m of src.matchAll(re)) {
      const target = path.resolve(path.dirname(f), m[1]);
      if (!exists(target) || !fs.statSync(target).isFile()) fail(`${rel(f)} imports '${m[1]}' but ${rel(target)} does not exist`);
    }
  }
}

/* ------------------------------------------------------------ 3. the page list (site/libby/js/pages.js) matches the files */
const pagesFile = path.join(ROOT, 'site/libby/js/pages.js');
if (!exists(pagesFile)) {
  fail('site/libby/js/pages.js (the list of pages) is missing');
} else {
  if (/\b(document|window|localStorage)\./.test(read(pagesFile))) fail('site/libby/js/pages.js uses the browser (document/window): the server loads this file too, so it must hold plain data only');
  const reg = await import(pathToFileURL(pagesFile).href);
  const { PAGES, MENU, GROUPS, RANK, ADVISER_LINKS } = reg;
  const ids = new Set();
  const viewsDir = path.join(ROOT, 'site/libby/js/views');
  for (const p of PAGES) {
    if (ids.has(p.id)) fail(`pages.js: the id "${p.id}" is used twice`);
    ids.add(p.id);
    if (!(p.match instanceof RegExp)) fail(`pages.js: page "${p.id}" has no match pattern`);
    if (p.level && !RANK[p.level]) fail(`pages.js: page "${p.id}" has an unknown level "${p.level}"`);
    if (p.group && !GROUPS[p.group]) fail(`pages.js: page "${p.id}" is in an unknown group "${p.group}"`);
    if (p.group && !p.tab) fail(`pages.js: page "${p.id}" is in a group but has no tab`);
    if (p.tabLabel && !p.href) fail(`pages.js: page "${p.id}" has a tabLabel but no href`);
    const file = path.join(viewsDir, p.view || '');
    if (!p.view || !exists(file)) { fail(`pages.js: page "${p.id}" needs site/libby/js/views/${p.view} but that file does not exist`); continue; }
    if (!new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${p.fn}\\b`).test(read(file))) fail(`pages.js: site/libby/js/views/${p.view} does not export "${p.fn}" (needed by page "${p.id}")`);
  }
  // every menu item, button and Advisers link must lead to a page
  const lands = (href) => PAGES.some((p) => p.match.test(String(href).replace(/^#/, '').split('?')[0]));
  for (const m of MENU) if (!lands(m.href)) fail(`pages.js: the menu item "${m.label}" (${m.href}) does not match any page`);
  for (const p of PAGES) if (p.href && !lands(p.href)) fail(`pages.js: "${p.id}" has href ${p.href} that matches no page`);
  for (const [, links] of ADVISER_LINKS) for (const [label, href] of links) if (!lands(href)) fail(`pages.js: the Advisers button "${label}" (${href}) matches no page`);
  // a view file no page uses
  const used = new Set(PAGES.map((p) => p.view));
  for (const f of files.filter((x) => x.startsWith(viewsDir) && x.endsWith('.js'))) if (!used.has(path.basename(f))) notes.push(`site/libby/js/views/${path.basename(f)} is not used by any page in pages.js`);
}

/* ------------------------------------------------------------ 4. /api routes that save things must check who is asking */
const ROUTE_ALLOW = new Set(['oq-suggest.js']); // gated by the front door
for (const f of js.filter((x) => rel(x).startsWith(`${FNS}/`))) {
  const src = read(f);
  if (/export\s+(?:async\s+)?function\s+onRequest(Post|Put|Delete|Patch)\b/.test(src) && !ROUTE_ALLOW.has(path.basename(f)) && !/passcodeProblem\s*\(/.test(src)) {
    fail(`${rel(f)} can change data but never calls passcodeProblem(), so nothing checks the person's level inside the route`);
  }
  if (!/export\s+(?:async\s+)?function\s+onRequest\w*/.test(src) && !/export\s+const\s+onRequest\w*/.test(src)) fail(`${rel(f)} is in functions/api/ but exports no onRequest... function`);
}
if (!exists(path.join(ROOT, `${FNS}/_middleware.js`))) fail(`${FNS}/_middleware.js (the sign-in front door) is missing: LIBBY's data would be open`);
const routesJson = path.join(ROOT, 'site/_routes.json');
if (!exists(routesJson)) fail('site/_routes.json is missing: the server routes might not run');
else if (!/"\/api\/\*"/.test(read(routesJson))) fail('site/_routes.json does not include "/api/*"');

/* ------------------------------------------------------------ 5. no two files share a name */
const ALLOW_SAME = new Set(['index.js', '_middleware.js']); // Cloudflare needs these names
const byName = new Map();
for (const f of js.filter((x) => /^(site\/libby|functions|lib)\//.test(rel(x)))) {
  const n = path.basename(f);
  if (ALLOW_SAME.has(n)) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(rel(f));
}
for (const [n, where] of byName) if (where.length > 1) fail(`two files are called ${n}: ${where.join(' and ')}. Give one of them a different name so they cannot be mixed up`);

/* ------------------------------------------------------------ 6. keep app.js plain ASCII */
const appJs = path.join(ROOT, 'site/libby/js/app.js');
if (exists(appJs) && /[^\x00-\x7f]/.test(read(appJs))) fail('site/libby/js/app.js contains a non-ASCII character (curly quote or dash): replace it with a plain one');

/* ------------------------------------------------------------ 7. database tables used in the code exist in schema.sql */
const migrationsDir = path.join(ROOT, 'supabase/migrations');
const schemaFile = migrationsDir;
if (!exists(migrationsDir)) {
  fail('supabase/migrations is missing');
} else {
  const schema = fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).map((n) => read(path.join(migrationsDir, n))).join('\n').toLowerCase();
  const tables = new Map();
  const note = (name, where) => { if (!tables.has(name)) tables.set(name, where); };
  const rpcs = new Map();
  for (const f of js) {
    const src = read(f);
    for (const m of src.matchAll(/\bsb(?:Select|Upsert)\(\s*env\s*,\s*['"`]([a-z_]+)['"`]/g)) note(m[1], rel(f));
    for (const m of src.matchAll(/\/rest\/v1\/([a-z_]+)(?![a-z_/])/g)) if (m[1] !== 'rpc') note(m[1], rel(f));
    for (const m of src.matchAll(/\bsbRpc\(\s*env\s*,\s*['"`]([a-z_]+)['"`]/g)) rpcs.set(m[1], rel(f));
  }
  for (const f of py) {
    for (const m of read(f).matchAll(/\bsb_(?:select|insert|delete)\(\s*["']([a-z_]+)["']/g)) note(m[1], rel(f));
  }
  for (const [t, where] of tables) if (!new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${t}\\b`).test(schema)) fail(`the table "${t}" is used in ${where} but supabase/migrations do not create it`);
  for (const [fn, where] of rpcs) if (!new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\b`).test(schema)) fail(`the database function "${fn}" is used in ${where} but supabase/migrations do not create it`);
}

/* ------------------------------------------------------------ 8. the page the browser loads first */
const indexHtml = path.join(ROOT, 'site/libby/index.html');
if (!exists(indexHtml)) fail('site/libby/index.html is missing');
else if (!/src="js\/app\.js"/.test(read(indexHtml))) fail('site/libby/index.html does not load js/app.js');

/* ------------------------------------------------------------ 9. no garbled characters */
// Text read in the wrong encoding turns a symbol into a run of odd letters (an arrow becomes "a" with a hat followed by a dash
// and a three-quarters sign). That is what happens if CSS or code with symbols in it is pasted through an editor that
// misreads UTF-8. Write symbols in CSS as escapes (for example \25B8) and in JavaScript as \u escapes so they cannot be garbled.
const GARBLED = /[\u00c2\u00c3\u00e2][\u00a0-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/;
for (const f of files.filter((x) => /\.(css|m?js|html|py)$/.test(x) && /^(site\/libby|functions|lib|scripts)\//.test(rel(x)))) {
  const lines = read(f).split('\n');
  const at = lines.findIndex((l) => GARBLED.test(l));
  if (at >= 0) fail(`${rel(f)} has garbled characters on line ${at + 1} (a symbol read in the wrong text encoding): ${JSON.stringify(lines[at].trim().slice(0, 70))}. Replace the symbol with an escape, for example \\25B8 in CSS`);
}

/* ------------------------------------------------------------ report */
console.log(`Checked ${js.length} JavaScript files, ${py.length} Python files and the page list.`);
for (const n of notes) console.log(`  note: ${n}`);
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found:\n`);
  problems.forEach((p, i) => console.log(` ${i + 1}. ${p}`));
  console.log('\nFix these before the change goes live.');
  process.exit(1);
}
console.log('No problems found.');
