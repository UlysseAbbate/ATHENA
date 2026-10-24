// Portfolios mirror the department tabs of the Lords Business Dashboard spreadsheet. The list itself is lib/portfolios-data.js:
// `acronyms` are matched when they appear in brackets, e.g. "(Lord Hanson, HO)".
// `departments` are matched against Parliament API department / organisation names.
// `keywords` are a fallback for free text (debate titles, committee reports, policy motions).

import data from './portfolios-data.js';

/** The portfolios, from lib/portfolios-data.js (shared with the Python jobs). */
export const PORTFOLIOS = data.portfolios;
/** Where anything that matches no department or keyword goes, so that nothing is ever left without a portfolio. */
export const CATCH_ALL = data.catchAll;

export const PORTFOLIO_BY_CODE = Object.fromEntries(PORTFOLIOS.map((p) => [p.code, p]));

// Brackets count as spaces, so a keyword just inside brackets, e.g. "(Fraud, Error and Recovery)", is still found.
const lc = (s) => ` ${String(s || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ')} `;

/** Portfolio codes whose department names appear in `name` (e.g. a bill sponsor's organisation). */
export function portfoliosForDepartment(name) {
  const t = lc(name);
  return PORTFOLIOS.filter((p) => p.departments.some((d) => t.includes(lc(d).trim()))).map((p) => p.code);
}

/**
 * Best-guess portfolio codes for a piece of free text.
 * Priority: explicit acronym in brackets > department name > keyword hits.
 */
export function classifyPortfolios(text, { max = 2 } = {}) {
  const raw = String(text || '');
  // Acronyms inside parentheses, e.g. "(HO)" or "(Lord Timpson, MoJ)".
  const bracketed = [...raw.matchAll(/\(([^()]{1,80})\)/g)].map((m) => m[1]);
  const hits = new Map();
  for (const chunk of bracketed) {
    const tokens = chunk.split(/[,;/\s]+/).map((t) => t.replace(/[^A-Za-z]/g, '').toUpperCase()).filter(Boolean);
    for (const p of PORTFOLIOS) if (p.acronyms.some((a) => tokens.includes(a))) hits.set(p.code, 100);
  }
  if (hits.size) return [...hits.keys()].slice(0, max);

  const byDept = portfoliosForDepartment(raw);
  if (byDept.length) return byDept.slice(0, max);

  const t = lc(raw);
  for (const p of PORTFOLIOS) {
    let score = 0;
    for (const k of p.keywords) if (t.includes(` ${k.trim()}`)) score += k.trim().length > 6 ? 2 : 1;
    if (score) hits.set(p.code, score);
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
}

/** Like classifyPortfolios, but never empty: anything that matches nothing gets the catch-all. `by` says which it was. */
export function tagText(text, { max = 2 } = {}) {
  const codes = classifyPortfolios(text, { max });
  return codes.length ? { codes, by: 'rules' } : { codes: [CATCH_ALL], by: 'default' };
}
