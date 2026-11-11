// Roles (Admin only): who is a Backbench or Frontbencher parliamentarian, a Whip, in the Leader’s circle, their Staff, or an Administrator.
// A compact table: the person (a Lib Dem peer or MP on the Members lists is highlighted in yellow, as everywhere on the site), their House, and their role (a drop-down).
// Every Lib Dem peer and MP on the Members lists is there; people who are not on them (staff) are added at the end, and can be removed again. A change saves as soon as it is made.
// The list decides who appears on the Whips pages (the duty rota and availability for whipping). It does not give anyone access:
// that comes from the role and password chosen at sign-in.
import { api } from '../api.js';
import { esc, loading, errorBox, empty, pageHeader, debounce, peer } from '../ui.js';
import { savedName } from '../session.js';
import { clearRoster } from '../peer-list.js';
import { mountImport } from '../../../shared/import/panel.js';
import { IMPORTERS } from '../../../shared/import/importers.js';
import { norm } from '../../../shared/import/sheet.js';

const plural = { backbench: 'Backbench parliamentarians', frontbench: 'Frontbencher parliamentarians', backbench_staff: 'Backbench Staff', frontbench_staff: 'Frontbencher Staff', whips_staff: 'Whip’s Staff', leader_staff: 'Leader’s circle’s Staff', peers: 'Peers', whips: 'Whips', spokesperson: 'Spokespeople', leader: 'Leader’s circle', staff: 'Staff', admin: 'Administrators' };

export async function renderRoles(el) {
  el.innerHTML = `${pageHeader('Roles', 'Say who is a Backbench or Frontbencher parliamentarian, a Whip, in the Leader’s circle, their Staff, or an Administrator. This list decides who appears on the Whips pages (the duty rota and availability for whipping). It does not change anyone’s access: that comes from the role and password chosen when signing in.')}
    <div id="roles">${loading('Loading the list')}</div>`;
  const box = el.querySelector('#roles');
  let data;
  try { data = await api('people-roles'); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;

  const { roles } = data;
  const people = data.people.map((p) => ({ ...p }));
  const label = Object.fromEntries(roles.map((r) => [r.id, r.label]));
  const options = (current) => roles.map((r) => `<option value="${esc(r.id)}" ${r.id === current ? 'selected' : ''}>${esc(r.label)}</option>`).join('');

  const HOUSE = { lords: 'Lords', commons: 'Commons' };
  const row = (p) => `<tr data-name="${esc(p.name)}" data-role="${esc(p.role)}" data-house="${esc(p.house || 'lords')}">
      <td>${p.onList ? peer(p.name, true) : esc(p.name)}${p.onList ? '' : ' <span class="roles-added" title="Not on the Members lists">added</span>'}</td>
      <td><span class="tag">${HOUSE[p.house || 'lords']}</span></td>
      <td><select data-set aria-label="Role of ${esc(p.name)}">${options(p.role)}</select>${p.onList ? '' : ' <button type="button" class="linkish" data-remove>Remove</button>'}</td></tr>`;

  box.innerHTML = `
    <div data-import-roles></div>
    <p class="small roles-summary" data-summary></p>
    <div class="roles-tools">
      <label class="field"><span>Find a person</span><input type="search" data-find placeholder="Name"></label>
      <label class="field field-narrow"><span>House</span><select data-house><option value="">Lords and Commons</option><option value="lords">Lords (peers)</option><option value="commons">Commons (MPs)</option></select></label>
      <label class="field"><span>Show</span><select data-show><option value="">Everyone</option>${roles.map((r) => `<option value="${esc(r.id)}">${esc(plural[r.id] || r.label)} only</option>`).join('')}</select></label>
      <button type="button" class="button button-quiet" data-jump>Add a person (end of the table)</button>
    </div>
    <p class="small" data-status role="status" aria-live="polite"></p>
    <div class="table-wrap roles-wrap"><table class="grid roles-table">
      <thead><tr><th scope="col">Person</th><th scope="col">House</th><th scope="col">Role</th></tr></thead>
      <tbody data-body>${people.map(row).join('')}</tbody>
      <tfoot><tr data-add-row>
        <td colspan="2"><form id="roles-add" class="roles-add" autocomplete="off"><input type="text" name="name" maxlength="80" placeholder="Add a person, e.g. Jane Smith" aria-label="Name of the person to add" required></form></td>
        <td><select name="house" form="roles-add" aria-label="House of the person to add"><option value="lords">Lords</option><option value="commons">Commons</option></select>
          <select name="role" form="roles-add" aria-label="Role of the person to add">${options('staff')}</select>
          <button class="button button-small" type="submit" form="roles-add">Add</button></td></tr></tfoot>
    </table></div>
    <p class="small muted">Staff and anyone else who is not a Liberal Democrat peer or MP are added at the end, with the House they work in. Only people added by hand can be removed: a peer or MP leaves this list when they leave the Members list.</p>`;

  const body = box.querySelector('[data-body]');
  const status = box.querySelector('[data-status]');
  const find = box.querySelector('[data-find]');
  const show = box.querySelector('[data-show]');
  const houseSel = box.querySelector('[data-house]');

  const summary = () => {
    const counts = {};
    for (const p of people) counts[p.role] = (counts[p.role] || 0) + 1;
    const lords = people.filter((p) => (p.house || 'lords') === 'lords').length;
    box.querySelector('[data-summary]').textContent = `${people.length} people (${lords} in the Lords, ${people.length - lords} in the Commons): ${roles.filter((r) => counts[r.id]).map((r) => `${counts[r.id]} ${plural[r.id] || r.label}`).join(', ')}.`;
  };
  const apply = () => {
    const q = find.value.trim().toLowerCase();
    body.querySelectorAll('tr').forEach((tr) => {
      tr.hidden = (!!q && !tr.dataset.name.toLowerCase().includes(q)) || (!!show.value && tr.dataset.role !== show.value) || (!!houseSel.value && tr.dataset.house !== houseSel.value);
    });
  };
  summary();
  find.addEventListener('input', debounce(apply, 120));
  show.addEventListener('change', apply);
  houseSel.addEventListener('change', apply);
  box.querySelector('[data-jump]').addEventListener('click', () => {
    const add = box.querySelector('[data-add-row]');
    add.scrollIntoView({ block: 'center' });
    add.querySelector('input').focus();
  });

  const post = async (payload) => {
    const out = await api('people-roles', { method: 'POST', body: JSON.stringify({ ...payload, author: savedName() }) });
    clearRoster(); // the Whips pages must ask again
    return out;
  };

  body.addEventListener('change', async (e) => {
    const select = e.target.closest('[data-set]');
    if (!select) return;
    const tr = select.closest('tr');
    const person = people.find((p) => p.name === tr.dataset.name);
    const before = person.role;
    status.textContent = 'Saving…';
    try {
      await post({ action: 'set', name: person.name, role: select.value });
      person.role = select.value;
      tr.dataset.role = select.value;
      status.textContent = `Saved: ${person.name} is now ${label[person.role]}.`;
      summary();
      apply();
    } catch (err) {
      select.value = before; // put it back to what is actually saved
      status.textContent = err.message;
    }
  });

  body.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    const tr = rm.closest('tr');
    const name = tr.dataset.name;
    if (!window.confirm(`Remove ${name} from the list?`)) return;
    status.textContent = 'Removing…';
    try {
      await post({ action: 'remove', name });
      people.splice(people.findIndex((p) => p.name === name), 1);
      tr.remove();
      status.textContent = `Removed ${name}.`;
      summary();
    } catch (err) { status.textContent = err.message; }
  });

  box.querySelector('#roles-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.elements.name.value.trim().replace(/\s+/g, ' ');
    const role = box.querySelector('[name="role"]').value;
    const house = box.querySelector('[name="house"]').value;
    if (!name) return;
    status.textContent = 'Adding…';
    try {
      await post({ action: 'add', name, role, house });
      const person = { name, role, house, onList: false };
      people.push(person);
      body.insertAdjacentHTML('beforeend', row(person));
      form.reset();
      status.textContent = `Added ${name} as ${label[role]}.`;
      summary();
      apply();
    } catch (err) { status.textContent = err.message; }
  });

  // Import from a spreadsheet: a name and a role on each row. Someone already on the list gets the new role; anyone else is added (with their House).
  mountImport(box.querySelector('[data-import-roles]'), {
    importer: IMPORTERS.roles,
    lookups: async () => ({ roles }),
    after: () => renderRoles(el),
    commit: async (entries, progress) => {
      let added = 0, skipped = 0, done = 0; const failed = [];
      for (const e of entries) {
        try {
          const have = people.find((p) => norm(p.name) === norm(e.name));
          if (have && have.role === e.role) skipped++;
          else if (have) { await post({ action: 'set', name: have.name, role: e.role }); have.role = e.role; added++; }
          else { await post({ action: 'add', name: e.name, role: e.role, house: e.house }); people.push({ name: e.name, role: e.role, house: e.house, onList: false }); added++; }
        } catch (err) { failed.push({ summary: e.name, error: err.message }); }
        progress(++done, entries.length);
      }
      return { added, skipped, failed };
    },
  });

  if (!people.length) body.innerHTML = `<tr><td colspan="3">${empty('No one is in the list yet.')}</td></tr>`;
}
