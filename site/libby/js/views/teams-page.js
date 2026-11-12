// Teams (#/teams, POLD Staff): Staff bring people together in teams so that they can share certain things. For now there is one shared thing: people in a team
// see in full the Wallace Room and Room 391 bookings that the others in the team made (they can look but not change them). A team never changes anyone's access level.
// People are the accounts with LIBBY access (pick from the list, or type an email address). Every change saves as soon as it is made.
import { api } from '../api.js';
import { esc, loading, errorBox, empty, pageHeader } from '../ui.js';

export async function renderTeams(el) {
  el.innerHTML = `${pageHeader('Teams', 'Bring people (staff or parliamentarians) together in a team. For now, people in a team can see in full the Wallace Room and Room 391 bookings that the others in the team made; they can look but not change them. Joining a team never changes anyone’s access level, and a person’s level is not affected by anyone else in their team.')}
    <div id="teams">${loading('Loading the teams')}</div>`;
  const box = el.querySelector('#teams');
  let data;
  try { data = await api('teams'); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;

  const post = async (body) => {
    const res = await fetch('/api/libby/teams', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401 && out.login) { location.reload(); return new Promise(() => {}); }
    return { ok: res.ok, data: out };
  };
  const refresh = async (msg) => { data = await api('teams'); draw(); if (msg) box.querySelector('[data-status]').textContent = msg; };
  const label = (p) => `${p.name || p.email}${p.name ? ` (${p.email})` : ''}`;

  const teamHtml = (t) => `<section class="team-card" data-team="${t.id}">
    <h3 class="h3-section"><span data-team-name>${esc(t.name)}</span> <span class="count">${t.members.length}</span></h3>
    ${t.members.length ? `<ul class="team-members">${t.members.map((m) => `<li>${esc(m.name || m.email)}${m.name ? ` <span class="small muted">${esc(m.email)}</span>` : ''}${m.level ? ` <span class="small muted">· ${esc(m.level)}</span>` : ' <span class="small muted">· no LIBBY account yet</span>'}
      <button type="button" class="linkish small" data-remove="${esc(m.email)}">Remove</button></li>`).join('')}</ul>` : '<p class="small muted">No one is in this team yet.</p>'}
    <form class="team-add" data-add autocomplete="off"><label class="field"><span>Add a person (pick from the list, or type an email address)</span>
      <input name="email" list="team-people" maxlength="200" placeholder="name@example.org" required></label>
      <button class="button button-small" type="submit">Add</button></form>
    <p class="small"><button type="button" class="linkish" data-rename>Rename</button> · <button type="button" class="linkish" data-delete>Delete this team</button></p></section>`;

  const draw = () => {
    box.innerHTML = `<p class="small" data-status aria-live="polite"></p>
      <form class="team-new" data-new><label class="field field-narrow"><span>New team</span><input name="name" maxlength="60" placeholder="e.g. Leader’s office" required></label>
        <button class="button" type="submit">Create the team</button></form>
      ${data.teams.length ? data.teams.map(teamHtml).join('') : empty('No teams yet. Create one, then add the people who should share their room bookings.')}
      <datalist id="team-people">${data.people.map((p) => `<option value="${esc(p.email)}" label="${esc(label(p))}"></option>`).join('')}</datalist>
      <p class="small muted">Shared today: room bookings (Wallace Room and Room 391). More can be added later; whatever a team shares will be listed here.</p>`;
  };
  draw();

  const status = () => box.querySelector('[data-status]');
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card = e.target.closest('[data-team]');
    if (e.target.matches('[data-new]')) {
      const r = await post({ action: 'create', name: e.target.elements.name.value });
      if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return; }
      await refresh('Team created. Add the people in it.');
    } else if (e.target.matches('[data-add]')) {
      const r = await post({ action: 'add', id: Number(card.dataset.team), email: e.target.elements.email.value });
      if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return; }
      await refresh(r.data.already ? 'They are already in the team.' : 'Added. They now see the bookings of the others in this team.');
    }
  });
  box.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-team]');
    if (!card) return;
    const id = Number(card.dataset.team);
    const team = data.teams.find((t) => t.id === id);
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const r = await post({ action: 'remove', id, email: rm.dataset.remove });
      if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return; }
      await refresh('Removed. They no longer see the bookings of the others in this team.');
    } else if (e.target.closest('[data-rename]')) {
      const name = window.prompt('New name for the team', team.name);
      if (!name || name.trim() === team.name) return;
      const r = await post({ action: 'rename', id, name });
      if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return; }
      await refresh('Renamed.');
    } else if (e.target.closest('[data-delete]')) {
      if (!window.confirm(`Delete the team “${team.name}”? Its people keep their access levels and lose only what the team shared.`)) return;
      const r = await post({ action: 'delete', id });
      if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return; }
      await refresh('Team deleted.');
    }
  });
}
