// The Advisers page (Administrators only): a button for each page the advisers use.
// The buttons are listed in ADVISER_LINKS in pages.js.
import { esc, pageHeader } from '../ui.js';
import { ADVISER_LINKS } from '../pages.js';

export async function renderAdvisers(el) {
  el.innerHTML = `${pageHeader('Advisers', 'Every page the advisers use, in one place. Only Administrators can see this page.')}
    ${ADVISER_LINKS.map(([title, links]) => `<section class="adv-section"><h2 class="h2-rule">${esc(title)}</h2>
      <ul class="adv-list button-grid">${links.map(([label, href, text]) => `<li><a class="button" href="${esc(href)}">${esc(label)}</a><p>${esc(text)}</p></li>`).join('')}</ul></section>`).join('')}`;
}
