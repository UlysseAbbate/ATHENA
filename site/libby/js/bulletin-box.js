// How the Whips' Office Bulletin looks. Used by the home page and by the editor's preview.
import { esc, fmtDate } from './ui.js';

/** Escaped text with web addresses made into links. Line breaks are kept by the page's CSS. */
export function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

/**
 * The box. Nothing is shown when there are no messages, except that Staff and Admin get a prompt to add one.
 * messages: [ { heading, body, updated_at } ]
 */
export function bulletinHtml(messages, { admin = false } = {}) {
  if (!messages || !messages.length) {
    return admin ? `<section class="bulletin bulletin-empty" aria-label="Whips' Office Bulletin"><h2>Whips' Office Bulletin</h2>
      <p class="small muted">There is no bulletin message at the moment. <a href="#/bulletin-editor">Add one</a> (only Staff and Admin see this).</p></section>` : '';
  }
  const latest = messages.map((m) => m.updated_at || '').sort().pop();
  return `<section class="bulletin" aria-label="Whips' Office Bulletin"><h2>Whips' Office Bulletin</h2>
    ${messages.map((m) => `<div class="bulletin-msg">${m.heading ? `<h3>${esc(m.heading)}</h3>` : ''}<p>${linkify(m.body)}</p></div>`).join('')}
    ${latest ? `<p class="bulletin-foot">Last updated ${esc(fmtDate(latest, { day: 'numeric', month: 'long', year: 'numeric' }))}.${admin ? ' <a href="#/bulletin-editor">Edit</a>' : ''}</p>` : ''}</section>`;
}
