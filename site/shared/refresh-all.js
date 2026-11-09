/* The "Refresh all data" button at the foot of every page: asks the server to start the "Run everything" workflow, the same one that runs by itself
 * at 6am and 6pm. Any element with data-refresh-all is the button (so it keeps working when a page redraws its footer). */
(() => {
  const html = '<button type="button" class="linkish" data-refresh-all>Refresh all data</button><span class="refresh-all-note small" data-refresh-all-note aria-live="polite"></span>';
  async function run(btn) {
    const note = btn.parentElement && btn.parentElement.querySelector('[data-refresh-all-note]');
    const say = (t) => { if (note) note.textContent = t ? ' ' + t : ''; };
    btn.disabled = true; say('Starting...');
    try {
      const { data } = window.Athena && Athena.sb ? await Athena.sb.auth.getSession() : { data: {} };
      const token = (data && data.session && data.session.access_token) || '';
      const res = await fetch('/api/refresh-all', { method: 'POST', headers: { accept: 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
      const out = await res.json().catch(() => ({}));
      say(out.message || out.error || (res.ok ? 'Started.' : 'That did not work.'));
    } catch { say('Could not reach the server.'); }
    setTimeout(() => { btn.disabled = false; }, 20000);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-refresh-all]'); if (b && !b.disabled) run(b); });
  window.RefreshAll = { html };
})();
