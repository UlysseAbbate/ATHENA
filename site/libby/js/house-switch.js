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

/** The long button across the top of the page: it names the House you are in and takes you to the other one when you click it. */
export const houseSwitchHtml = () => {
  const here = currentHouse(), other = here === 'commons' ? 'lords' : 'commons';
  return `<button type="button" class="house-bar house-bar-${here}" data-house="${other}" aria-label="You are in ${HOUSES[here].name}, the ${HOUSES[here].house}. Switch to ${HOUSES[other].name}, the ${HOUSES[other].house}.">
    <span class="house-bar-here"><strong>${HOUSES[here].name}</strong> <span class="house-bar-sub">${HOUSES[here].house}</span></span>
    <span class="house-bar-go">Switch to ${HOUSES[other].name} (${HOUSES[other].house}) <span aria-hidden="true">\u203a</span></span></button>`;
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
