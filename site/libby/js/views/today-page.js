// Today: the Commons or the Lords, by the buttons at the top of the page (site/libby/js/house-switch.js).
import { currentHouse } from '../session.js';

export async function renderToday(el, params, query, stale) {
  if (currentHouse() === 'commons') {
    const { renderCommonsDay } = await import('./commons-day-page.js');
    return renderCommonsDay(el, params, query, stale);
  }
  const { renderDay } = await import('./day-page.js');
  return renderDay(el, params, query, stale);
}
