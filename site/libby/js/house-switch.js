// The buttons at the top of Today and Business that switch between Honourable LIBBY (the Commons, green) and Noble LIBBY (the Lords, red).
// The choice is kept in this browser; the whole site takes its colour from it (html[data-house], see styles.css).
import { HOUSES } from './pages.js';
import { setHouse, currentHouse } from './session.js';

const KEY = 'libbyHouse';
export const savedHouse = () => { try { const h = localStorage.getItem(KEY); return h === 'commons' || h === 'lords' ? h : 'lords'; } catch { return 'lords'; } };

/** Make `house` the House: the pages read it and "peers" becomes "MPs" in the footnote. (The page takes the House colour only on the pages that have a switch: see route() in app.js.) */
export function applyHouse(house) {
  setHouse(house);
  try { localStorage.setItem(KEY, house); } catch { /* the choice is just not remembered */ }
  setMembers(true);
}

/** The foot says "peers" or "MPs" on a page of one House, "peers and MPs" elsewhere. */
export function setMembers(ofOneHouse) {
  const members = document.querySelector('[data-members]');
  if (members) members.textContent = ofOneHouse ? HOUSES[currentHouse()].members : 'peers and MPs';
}

/** A small button at the top right: it is the OTHER House's colour (a red one on a Commons page, a green one on a Lords page) and takes you there. */
export const houseSwitchHtml = () => {
  const other = currentHouse() === 'commons' ? 'lords' : 'commons';
  return `<button type="button" class="house-switch-btn house-switch-to-${other}" data-house="${other}" aria-label="Switch to ${HOUSES[other].name}, the ${HOUSES[other].house}">Switch to the ${other === 'lords' ? 'Lords' : 'Commons'} <span aria-hidden="true">\u203a</span></button>`;
};

/** Draw the button into `box` (or empty it), and call `onChange` after a switch. */
export function renderHouseSwitch(box, show, onChange) {
  if (!show) { box.innerHTML = ''; return; }
  box.innerHTML = houseSwitchHtml();
  box.querySelector('[data-house]').addEventListener('click', (e) => {
    applyHouse(e.currentTarget.dataset.house);
    onChange();
  });
}
