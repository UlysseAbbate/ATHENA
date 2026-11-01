// The buttons at the top of Today and Business that switch between Honourable LIBBY (the Commons, green) and Noble LIBBY (the Lords, red).
// The choice is kept in this browser; the whole site takes its colour from it (html[data-house], see styles.css).
import { HOUSES } from './pages.js';
import { setHouse, currentHouse } from './session.js';

const KEY = 'libbyHouse';
export const savedHouse = () => { try { const h = localStorage.getItem(KEY); return h === 'commons' || h === 'lords' ? h : 'lords'; } catch { return 'lords'; } };

/** Make `house` the House: the pages read it, the page takes its colour, and "peers" becomes "MPs" in the footnote. */
export function applyHouse(house) {
  setHouse(house);
  try { localStorage.setItem(KEY, house); } catch { /* the choice is just not remembered */ }
  document.documentElement.dataset.house = house;
  const members = document.querySelector('[data-members]');
  if (members) members.textContent = HOUSES[house].members;
}

/** The buttons, as HTML. */
export const houseSwitchHtml = () => `<div class="house-switch" role="group" aria-label="Which House">
  ${['commons', 'lords'].map((h) => `<button type="button" class="house-btn house-btn-${h}" data-house="${h}"${currentHouse() === h ? ' aria-pressed="true"' : ' aria-pressed="false"'}>
    <span class="house-btn-name">${HOUSES[h].name.replace(' LIBBY', '')}</span><span class="house-btn-sub">${HOUSES[h].house}</span></button>`).join('')}
</div>`;

/** Draw the buttons into `box` (or empty it), and call `onChange` after a switch. */
export function renderHouseSwitch(box, show, onChange) {
  if (!show) { box.innerHTML = ''; return; }
  box.innerHTML = houseSwitchHtml();
  box.querySelectorAll('[data-house]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.house === currentHouse()) return;
    applyHouse(b.dataset.house);
    onChange();
  }));
}
