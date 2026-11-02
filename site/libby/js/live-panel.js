// The live panel: Lords Chamber (annunciator) and Grand Committee (schedule-based).
import { api } from './api.js';
import { esc, hl } from './ui.js';

function chamberHtml(c) {
  if (!c.available) return '<p class="live-quiet">The annunciator feed is unavailable.</p>';
  const lines = c.lines.filter((l) => l.text && !/^\s*$/.test(l.text));
  if (!lines.length) return '<p class="live-quiet">No business showing — the House may not be sitting.</p>';
  return lines.slice(0, 6).map((l) => `<p class="live-line ${l.style === 'member' ? 'is-member' : ''}">${hl(l.text)}</p>`).join('');
}

function gcHtml(g) {
  if (!g.sittingToday) return '<p class="live-quiet">Grand Committee is not sitting today.</p>';
  const row = (label, e) => (e ? `<p class="live-line"><span class="live-label">${label}${e.start ? ` · ${esc(e.start.slice(0, 5))}` : ''}</span>${hl(e.title)}</p>` : '');
  return (row('Now', g.current) + row('Next', g.next)) || '<p class="live-quiet">Grand Committee has finished for the day.</p>';
}

export function liveStrip(el, { compact = false } = {}) {
  el.className = `live ${compact ? 'live-compact' : ''}`;
  el.innerHTML = `
    <section class="live-panel" aria-labelledby="live-ch"><h2 id="live-ch"><span class="pulse" aria-hidden="true"></span>Lords Chamber</h2><div class="live-body" data-ch>…</div></section>
    <section class="live-panel" aria-labelledby="live-gc"><h2 id="live-gc">Grand Committee</h2><div class="live-body" data-gc>…</div></section>`;
  let loadedAt = 0;
  const load = () => api('live', { passive: true }).then((d) => {
    loadedAt = Date.now();
    el.querySelector('[data-ch]').innerHTML = chamberHtml(d.chamber);
    el.querySelector('[data-gc]').innerHTML = gcHtml(d.grandCommittee);
  }).catch(() => {
    el.querySelector('[data-ch]').innerHTML = '<p class="live-quiet">Live feed unavailable.</p>';
    el.querySelector('[data-gc]').innerHTML = '';
  });
  load();
  // Refresh every minute while this panel is on screen and the tab is in view (a tab in the background does not need it),
  // and straight away when the person comes back to a tab that has been waiting.
  const onVisible = () => { if (!document.hidden && Date.now() - loadedAt > 60000) load(); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); }
    else if (!document.hidden) load();
  }, 60000);
}

/**
 * The home page's annunciators: one for the House of Lords and one for the House of Commons, each showing what the Chamber is doing now
 * (the Parliament annunciator feed) and the current / next item in Grand Committee or Westminster Hall (inferred from the schedule).
 */
export function annunciators(el) {
  const panel = (id, title, cls) => `<section class="annunciator ${cls}" aria-labelledby="ann-${id}"><h2 id="ann-${id}"><span class="pulse" aria-hidden="true"></span>${title}</h2>
    <div class="live-body" data-${id}-ch>\u2026</div><div class="live-second" data-${id}-2></div></section>`;
  el.className = 'annunciators';
  el.innerHTML = panel('lords', 'House of Lords', 'annunciator-lords') + panel('commons', 'House of Commons', 'annunciator-commons');
  const second = (name, sitting, current, next) => {
    if (!sitting) return `<p class="live-quiet">${name} is not sitting today.</p>`;
    const row = (label, e) => (e ? `<p class="live-line"><span class="live-label">${label}${e.start ? ` \u00b7 ${esc(e.start.slice(0, 5))}` : ''}</span>${hl(e.title)}</p>` : '');
    return `<p class="live-sub">${name}</p>` + ((row('Now', current) + row('Next', next)) || `<p class="live-quiet">${name} has finished for the day.</p>`);
  };
  let loadedAt = 0;
  const load = () => Promise.all([api('live', { passive: true }).catch(() => null), api('commons/annunciator', { passive: true }).catch(() => null)]).then(([l, c]) => {
    loadedAt = Date.now();
    el.querySelector('[data-lords-ch]').innerHTML = l ? chamberHtml(l.chamber) : '<p class="live-quiet">Live feed unavailable.</p>';
    el.querySelector('[data-lords-2]').innerHTML = l ? second('Grand Committee', l.grandCommittee.sittingToday, l.grandCommittee.current, l.grandCommittee.next) : '';
    el.querySelector('[data-commons-ch]').innerHTML = c ? chamberHtml(c.chamber) : '<p class="live-quiet">Live feed unavailable.</p>';
    el.querySelector('[data-commons-2]').innerHTML = c ? second(c.secondary.name, c.secondary.sittingToday, c.secondary.current, c.secondary.next) : '';
  });
  load();
  const onVisible = () => { if (!document.hidden && Date.now() - loadedAt > 60000) load(); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); }
    else if (!document.hidden) load();
  }, 60000);
}
