// LIBBY's stylesheet may not choose its own light colours: everything comes from the shared tokens (site/shared/tokens.css),
// so dark mode cannot be broken by a stray hex colour. A few fixed colours are allowed where the colour is the same in both themes
// (text on the always-yellow masthead and on yellow fills, white on the black bars). Run: node tests/libby-css.js
const fs = require("fs"), path = require("path");
const css = fs.readFileSync(path.join(__dirname, "../site/libby/styles.css"), "utf8");
const ALLOWED = new Set(["#111", "#fff", "#000"]);          // on yellow, on the black bars
const problems = [];
css.split("\n").forEach((line, i) => {
  if (/^\s*(\/\*|\*)/.test(line)) return;
  for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) if (!ALLOWED.has(m[0].toLowerCase())) problems.push(`line ${i + 1}: ${m[0]} is a fixed colour; use a token from tokens.css`);
  if (/\b(background|background-color)\s*:\s*(#fff|#ffffff|white)\b/i.test(line)) problems.push(`line ${i + 1}: a white background does not follow dark mode; use var(--card)`);
  if (/\bbackground(-color)?\s*:\s*(#111|#000)\b/i.test(line) && !/\.topnav|\.ghost|\.masthead/.test(line)) problems.push(`line ${i + 1}: a black background does not follow dark mode; use var(--bar-bg) or var(--btn-bg)`);
  for (const m of line.matchAll(/rgba?\([^)]*\)/g)) if (!/253,\s*187,\s*48/.test(m[0])) problems.push(`line ${i + 1}: ${m[0]} is a fixed colour`);
});
console.log(problems.length ? problems.slice(0, 30).join("\n") + `\n\n${problems.length} problem(s)` : "LIBBY stylesheet uses only shared tokens (plus the fixed yellow/black/white allowed).");
process.exit(problems.length ? 1 : 0);
