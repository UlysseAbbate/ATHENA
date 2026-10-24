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
