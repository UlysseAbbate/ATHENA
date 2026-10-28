// The hub page of a group (Business, LD Peers' Group): a card for every subpage the signed-in person may open.
// What is in each group is decided in pages.js, so this file never changes when a page is added.
import { esc, pageHeader } from '../ui.js';
import { currentLevel, currentHouse } from '../session.js';
import { GROUPS, tabsFor } from '../pages.js';

export async function renderGroupPage(el, { group }) {
  const g = GROUPS[group];
  el.innerHTML = `${pageHeader(g.title, g.intro)}
    <nav class="index index-small" aria-label="${esc(g.title)} sections">
      ${tabsFor(group, currentLevel(), currentHouse()).map((t) => `<a class="index-row" href="${esc(t.href)}">
        <span class="index-title"><span class="swipe">${esc(t.label)}</span></span>
        <span class="index-text">${esc(t.card || '')}</span></a>`).join('')}
    </nav>`;
}
