// The Comms page: the latest post from each of the Lib Dem Lords team's accounts, with a button to each.
// Bluesky updates itself; for X, Instagram and LinkedIn an adviser pastes in the latest post (passcode needed).
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, pageHeader } from '../ui.js';
import { authFieldsHtml, readAuth, rememberAuth, reopenPasscode, can } from '../session.js';

const DATE = { day: 'numeric', month: 'short', year: 'numeric' };
const SNIPPET = 280;
const STALE_DAYS = 7;

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const snippet = (t) => (t.length > SNIPPET ? `${t.slice(0, SNIPPET).trimEnd()}…` : t);

function postHtml(p) {
  const post = p.post;
  if (!post) return `<div class="comms-post is-empty">${p.auto ? 'No posts found yet.' : 'No post recorded yet.'}</div>`;
  const text = post.text ? esc(snippet(post.text)) : 'A post with an image, video or link. Open it to see more.';
  return `<div class="comms-post ${post.text ? '' : 'is-empty'}">${text}</div>`;
}

function metaHtml(p) {
  const post = p.post;
  if (!post) return p.note ? `<p class="small comms-warn">${esc(p.note)}</p>` : '';
  const when = post.at ? `Posted ${esc(fmtDate(post.at, DATE))}` : '';
  if (post.source === 'live') return `<p class="small muted">${when}${when ? ' · ' : ''}updates automatically</p>`;
  const age = daysSince(post.savedAt);
  const added = `${post.by ? `added by ${esc(post.by)}` : 'added by an adviser'}${post.savedAt ? ` on ${esc(fmtDate(post.savedAt, DATE))}` : ''}`;
  return `<p class="small muted">${when}${when ? ' · ' : ''}${added}</p>
    ${age !== null && age >= STALE_DAYS ? '<p class="small comms-warn">Entered over a week ago, so there may be newer posts: check the account.</p>' : ''}`;
}

function updateHtml(p) {
  if (!can('whips')) return '';
  if (p.auto && p.post) return '';
  return `<details class="comms-update"><summary class="small">Advisers: update the latest post</summary>
    <form data-update="${esc(p.key)}">
      <label class="field"><span>Text of the latest post</span><textarea name="text" rows="4" maxlength="1500"></textarea></label>
      <label class="field"><span>Link to the post (optional)</span><input type="url" name="postUrl" placeholder="https://"></label>
      <label class="field field-narrow"><span>Date posted (optional)</span><input type="date" name="postedAt"></label>
      <div class="row" style="display:flex;flex-wrap:wrap;gap:.75rem">${authFieldsHtml()}</div>
      <p class="small muted">Leave the text and link empty and save to clear it.</p>
      <p><button class="button" type="submit">Save</button> <span class="small" data-status aria-live="polite"></span></p>
    </form></details>`;
}

function cardHtml(p) {
  return `<article class="comms-card" data-platform="${esc(p.key)}">
    <header><h2>${esc(p.name)}</h2><span class="small muted">${esc(p.handle)}</span></header>
    ${postHtml(p)}
    ${metaHtml(p)}
    <div class="comms-actions">
      <a class="button" href="${esc(p.url)}" target="_blank" rel="noopener">Open ${esc(p.name)}<span class="sr-only"> (opens in a new tab)</span></a>
      ${p.post?.url ? `<a class="small" href="${esc(p.post.url)}" target="_blank" rel="noopener">View this post<span class="sr-only"> (opens in a new tab)</span></a>` : ''}
    </div>
    ${updateHtml(p)}
  </article>`;
}

export async function renderComms(el) {
  el.innerHTML = `${pageHeader('Comms', 'What the Liberal Democrat Lords team has been putting out. Each box shows the latest post, with a button to the account.')}
    <div id="comms">${loading('Loading the latest posts')}</div>`;
  const box = el.querySelector('#comms');

  const load = async () => {
    let data;
    try { data = await api('comms'); } catch (err) { box.innerHTML = errorBox(err); return; }
    box.innerHTML = `
      ${(data.notes || []).map((n) => `<p class="small muted">${esc(n)}</p>`).join('')}
      <div class="comms-grid">${data.platforms.map(cardHtml).join('')}</div>
      <p class="small muted">Bluesky updates by itself. X, Instagram and LinkedIn do not allow other sites to read their posts for free, so the latest post is pasted in by the Whips' Office.</p>`;
  };
  await load();

  box.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-update]');
    if (!form) return;
    e.preventDefault();
    const status = form.querySelector('[data-status]');
    const f = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() || '';
    const { passcode, author } = readAuth(form);
    status.textContent = 'Saving…';
    try {
      await api('comms', { method: 'POST', body: JSON.stringify({ passcode, platform: form.dataset.update, text: f('text'), postUrl: f('postUrl'), postedAt: f('postedAt'), author }) });
      rememberAuth(passcode, author);
      await load();
    } catch (err) {
      status.textContent = err.message;
      if (/passcode/i.test(err.message)) reopenPasscode(form);
    }
  });
}
