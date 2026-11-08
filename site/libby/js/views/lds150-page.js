// Lib Dems 150: a card for each part of the old LD Peers' Group page that is not for the Whips or the advisers (Policy, the Wallace Room, Room 391,
// Work Experience Support), and buttons for the guides. A guide whose link is not known yet says so. The pages and links are listed in pages.js.
import { esc, pageHeader } from '../ui.js';
import { currentLevel, currentHouse } from '../session.js';
import { GROUPS, LD150_LINKS, tabsFor } from '../pages.js';

export async function renderLds150(el) {
  const g = GROUPS.lds150;
  el.innerHTML = `${pageHeader(g.title, g.intro)}
    <nav class="index index-small" aria-label="${esc(g.title)} sections">
      ${tabsFor('lds150', currentLevel(), currentHouse()).map((t) => `<a class="index-row" href="${esc(t.href)}">
        <span class="index-title"><span class="swipe">${esc(t.label)}</span></span>
        <span class="index-text">${esc(t.card || '')}</span></a>`).join('')}
    </nav>
    <section><h2 class="h2-rule">Guides</h2>
      <ul class="link-buttons button-grid">${LD150_LINKS.map(([label, url, text]) => `<li>${url
        ? `<a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
        : `<button type="button" class="button" disabled aria-disabled="true">${esc(label)}</button>`}
        <p>${esc(text)}${url ? '' : ' Link to come.'}</p></li>`).join('')}</ul>
    </section>`;
}
