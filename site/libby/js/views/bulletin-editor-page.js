// Where Staff and Admin write the Whips' Office Bulletin (the box on the home page). Reached from the Advisers page.
import { api } from '../api.js';
import { esc, loading, errorBox, pageHeader } from '../ui.js';
import { authFieldsHtml, readAuth, rememberAuth } from '../session.js';
import { bulletinHtml } from '../bulletin-box.js';

export async function renderBulletinEditor(el) {
  el.innerHTML = `${pageHeader('Whips\u2019 Office Bulletin', 'Messages for the box at the top of the home page, which everyone signed in can read. They stay there until you change or delete them.', [['#/advisers', 'Advisers']])}
    <div id="bul-root">
    <div class="row" style="display:flex;flex-wrap:wrap;gap:.75rem">${authFieldsHtml()}</div>
    <p class="small" data-status aria-live="polite"></p>
    <div id="cards">${loading('Loading the bulletin')}</div>
    <p><button type="button" class="button" data-add>Add a message</button></p>
    <h2 class="h2-rule">How it looks on the home page</h2>
    <div id="preview"></div>
    </div>`;
  const root = el.querySelector('#bul-root'); // the handler below goes on this, which is rebuilt on every visit (the page container is reused)
  const cards = el.querySelector('#cards');
  const preview = el.querySelector('#preview');
  const status = el.querySelector('[data-status]');
  const nameBox = () => readAuth(root).author;

  let messages = [];
  const load = async () => {
    const d = await api('bulletin');
    messages = d.messages || [];
    if (d.note) status.textContent = d.note;
  };
  const draw = () => {
    cards.innerHTML = messages.length ? messages.map((m, i) => `<div class="bul-card" data-index="${i}">
        <label class="field"><span>Heading (optional)</span><input type="text" data-heading maxlength="120" value="${esc(m.heading || '')}"></label>
        <label class="field"><span>Message</span><textarea data-body rows="5" maxlength="4000">${esc(m.body || '')}</textarea></label>
        <div class="bul-actions">
          <button type="button" class="button" data-save>${m.id ? 'Save changes' : 'Save new message'}</button>
          ${m.id ? `<button type="button" class="button button-quiet" data-up ${i === 0 ? 'disabled' : ''}>Move up</button>
            <button type="button" class="button button-quiet" data-down ${messages[i + 1] && messages[i + 1].id ? '' : 'disabled'}>Move down</button>` : '<span class="bul-new">Not saved yet</span>'}
          <button type="button" class="button button-quiet" data-delete>Delete</button>
        </div></div>`).join('')
      : '<p class="state">There are no messages yet. Choose "Add a message" below.</p>';
    preview.innerHTML = bulletinHtml(messages.filter((m) => m.id), { admin: false }) || '<p class="small muted">Nothing to show yet: the box is hidden on the home page until there is a message.</p>';
  };
  try { await load(); draw(); } catch (err) { cards.innerHTML = errorBox(err); return; }

  const run = async (label, fn) => {
    status.textContent = `${label}\u2026`;
    try { await fn(); await load(); draw(); status.textContent = 'Done.'; } catch (err) { status.textContent = err.message; }
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) {
      if (messages.some((m) => !m.id)) { status.textContent = 'Save the new message first.'; return; }
      messages.push({ id: null, heading: '', body: '' });
      draw();
      cards.querySelector('.bul-card:last-child [data-body]')?.focus();
      return;
    }
    const card = e.target.closest('.bul-card');
    if (!card) return;
    const i = Number(card.dataset.index);
    const m = messages[i];
    if (e.target.closest('[data-save]')) {
      const author = nameBox();
      run('Saving', async () => {
        await api('bulletin', { method: 'POST', body: JSON.stringify({ action: 'save', id: m.id, heading: card.querySelector('[data-heading]').value, body: card.querySelector('[data-body]').value, author }) });
        rememberAuth('', author);
      });
    } else if (e.target.closest('[data-delete]')) {
      if (!window.confirm('Delete this message from the bulletin?')) return;
      if (!m.id) { messages.splice(i, 1); draw(); return; }
      run('Deleting', () => api('bulletin', { method: 'POST', body: JSON.stringify({ action: 'delete', id: m.id }) }));
    } else if (e.target.closest('[data-up]') || e.target.closest('[data-down]')) {
      const j = e.target.closest('[data-up]') ? i - 1 : i + 1;
      const order = messages.filter((x) => x.id).map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      run('Moving', () => api('bulletin', { method: 'POST', body: JSON.stringify({ action: 'order', ids: order }) }));
    }
  });
}
