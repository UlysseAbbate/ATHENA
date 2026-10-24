// Which portfolio(s) a Bill belongs to. Every Bill gets at least one: the last resort is the catch-all (Cabinet Office),
// and the Legislation page marks those so they can be placed by hand in lib/portfolio-overrides.js.

import { CATCH_ALL, tagText, portfoliosForDepartment, classifyPortfolios } from './portfolios.js';
import overrides from './portfolio-overrides.js';
import { norm, htmlToText } from './util.js';

const OVERRIDES = new Map(Object.entries(overrides.bills || {}).map(([title, codes]) => [norm(title), codes]));

/**
 * Portfolios for one Bill: { codes, by }. In order of trust:
 *   override     the Bill is listed in lib/portfolio-overrides.js
 *   department   the Bills API lists it under a department (departmentCodes), or its sponsor is one (sponsorOrgs)
 *   keywords     the title, then the long title and summary, match a portfolio's department name or keywords
 *   default      nothing matched: the catch-all portfolio
 */
export function tagBill({ title = '', longTitle = '', summary = '', departmentCodes = [], sponsorOrgs = [] }) {
  const override = OVERRIDES.get(norm(title));
  if (override && override.length) return { codes: override.slice(0, 3), by: 'override' };

  const direct = [...new Set(departmentCodes)];
  if (direct.length) return { codes: direct.slice(0, 3), by: 'department' };
  const sponsors = [...new Set(sponsorOrgs.flatMap((name) => portfoliosForDepartment(name)))];
  if (sponsors.length) return { codes: sponsors.slice(0, 3), by: 'department' };

  const byTitle = tagText(title);
  if (byTitle.by === 'rules') return { codes: byTitle.codes, by: 'keywords' };
  const byText = tagText(`${longTitle} ${htmlToText(summary)}`.slice(0, 3000));
  return byText.by === 'rules' ? { codes: byText.codes, by: 'keywords' } : { codes: [CATCH_ALL], by: 'default' };
}

/**
 * A function title -> the one portfolio code a vote's title belongs to ('' if none can be found), for the Voting Data page.
 * A vote's title is the Bill's (or instrument's) name. In order of trust: lib/portfolio-overrides.js; a live Bill of that name,
 * which has the department that sponsors it; then the keywords. `bills` are the tagged live Bills (activeLordsBillsTagged).
 */
export function titleTagger(bills = []) {
  const byTitle = new Map(bills.filter((b) => b.title && b.portfolios?.length).map((b) => [norm(b.title), b.portfolios[0]]));
  return (title) => {
    const key = norm(title);
    return OVERRIDES.get(key)?.[0] || byTitle.get(key) || classifyPortfolios(title, { max: 1 })[0] || '';
  };
}
