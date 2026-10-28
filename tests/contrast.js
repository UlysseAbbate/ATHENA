// WCAG AA contrast check of the shared design tokens (site/shared/tokens.css), in light and dark.
// Reads the real stylesheet, so a colour change that breaks readability fails CI. Run: node tests/contrast.js
const fs = require("fs"), path = require("path");
const css = fs.readFileSync(path.join(__dirname, "../site/shared/tokens.css"), "utf8");

function tokens(block) { const t = {}; for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) t[m[1]] = m[2]; return t; }
const light = tokens(css.match(/:root\{[\s\S]*?\n\}/)[0]);
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\]\{[\s\S]*?\}/)[0]) };
// the device-preference block must define exactly what the explicit dark block does
const auto = { ...light, ...tokens(css.match(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{[\s\S]*?\}\}/)[0]) };

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

// [foreground token, background token, minimum ratio, what it is]
const PAIRS = [
  ["ink", "paper", 4.5, "body text"], ["ink", "card", 4.5, "text on a card"], ["muted", "paper", 4.5, "muted text"], ["muted", "card", 4.5, "muted text on a card"],
  ["masthead-fg", "masthead-bg", 4.5, "masthead text"], ["bar-fg", "bar-bg", 4.5, "section bar"], ["btn-fg", "btn-bg", 4.5, "button"],
  ["btn-hover-fg", "btn-hover-bg", 4.5, "button hovered"], ["ink", "yellow-pale", 4.5, "text on pale panel"], ["err", "err-bg", 4.5, "error text"],
  ["ink", "err-bg", 4.5, "text in an error box"], ["ink", "ok-bg", 4.5, "text in an ok box"], ["ink", "warn-bg", 4.5, "text in a warning box"],
  ["orange", "paper", 4.5, "orange text"], ["orange", "card", 4.5, "orange text on a card"], ["green", "paper", 4.5, "green text"], ["red", "paper", 4.5, "red text"], ["ink", "sky", 4.5, "text on a pale blue panel"], ["ink", "orange-tint", 4.5, "text on an orange tint"], ["ink", "green-tint", 4.5, "text on a green tint"], ["ink", "red-tint", 4.5, "text on a red tint"], ["on-fill", "green", 4.5, "text on a green flag"], ["on-fill", "orange", 4.5, "text on an orange flag"], ["on-fill", "red", 4.5, "text on a red flag"], ["house-fg", "commons", 4.5, "Honourable LIBBY (Commons) card"], ["house-fg", "lords", 4.5, "Noble LIBBY (Lords) card"], ["focus", "paper", 3, "focus ring"], ["outline", "paper", 3, "panel outline"], 
];
let failed = 0;
if (dark.paper === light.paper || auto.paper === light.paper) { console.log("FAIL  dark palette was not found in tokens.css"); process.exit(1); }
for (const [name, set] of [["light", light], ["dark", dark]]) for (const [f, b, min, what] of PAIRS) {
  const r = ratio(set[f], set[b]);
  if (r < min) { failed++; console.log(`FAIL  ${name}: ${what} (${f} ${set[f]} on ${b} ${set[b]}) = ${r.toFixed(2)}, needs ${min}`); }
}
for (const k of new Set([...Object.keys(dark), ...Object.keys(auto)])) if (dark[k] !== auto[k]) { failed++; console.log(`FAIL  dark palette differs between data-theme and device preference: --${k} ${dark[k]} vs ${auto[k]}`); }
console.log(failed ? `\n${failed} problem(s)` : `contrast ok: ${PAIRS.length} pairs x 2 themes, dark palettes identical`);
process.exit(failed ? 1 : 0);
