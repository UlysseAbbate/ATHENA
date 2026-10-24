// Roles (Admin only): who is a Whip, a Spokesperson and so on.
// A compact two-column table: the person, and their role (a drop-down). Every Lib Dem peer on the Members list is there; people who
// are not on it (staff) are added at the end, and can be removed again. A change saves as soon as it is made.
// The list decides who appears on the Whips pages (the duty rota and availability for whipping). It does not give anyone access:
// that comes from the role and password chosen at sign-in.
import { api } from '../api.js';
import { esc, loading, errorBox, empty, pageHeader, debounce } from '../ui.js';
import { savedName } from '../session.js';
import { clearRoster } from '../peer-list.js';

const plural = { peers: 'Peers', whips: 'Whips', spokesperson: 'Spokespeople', leader: 'Leader’s office', staff: 'Staff', admin: 'Admin' };

export async function renderRoles(el) {
  el.innerHTML = `${pageHeader('Roles', 'Say who is a Whip, a Spokesperson and so on. This list decides who appears on the Whips pages (the duty rota and availability for whipping). It does not change anyone’s access: that comes from the role and password chosen when signing in.')}
    <div id="roles">${loading('Loading the list')}</div>`;
  const box = el.querySelector('#roles');
  let data;
  try { data = await api('people-roles'); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;

  const { roles } = data;
  const people = data.people.map((p) => ({ ...p }));
  const label = Object.fromEntries(roles.map((r) => [r.id, r.label]));
  const options = (current) => roles.map((r) => `<option value="${esc(r.id)}" ${r.id === current ? 'selected' : ''}>${esc(r.label)}</option>`).join('');

  const row = (p) => `<tr data-name="${esc(p.name)}" data-role="${esc(p.role)}">
      <td>${esc(p.name)}${p.onList ? '' : ' <span class="roles-added" title="Not on the Members list">added</span>'}</td>
      <td><select data-set aria-label="Role of ${esc(p.name)}">${options(p.role)}</select>${p.onList ? '' : ' <button type="button" class="linkish" data-remove>Remove</button>'}</td></tr>`;

  box.innerHTML = `
    <p class="small roles-summary" data-summary></p>
    <div class="roles-tools">
      <label class="field"><span>Find a person</span><input type="search" data-find placeholder="Name"></label>
      <label class="field"><span>Show</span><select data-show><option value="">Everyone</option>${roles.map((r) => `<option value="${esc(r.id)}">${esc(plural[r.id] || r.label)} only</option>`).join('')}</select></label>
      <button type="button" class="button button-quiet" data-jump>Add a person (end of the table)</button>
    </div>
    <p class="small" data-status role="status" aria-live="polite"></p>
    <div class="table-wrap roles-wrap"><table class="grid roles-table">
      <thead><tr><th scope="col">Person</th><th scope="col">Role</th></tr></thead>
      <tbody data-body>${people.map(row).join('')}</tbody>
      <tfoot><tr data-add-row>
        <td><form id="roles-add" class="roles-add" autocomplete="off"><input type="text" name="name" maxlength="80" placeholder="Add a person, e.g. Jane Smith" aria-label="Name of the person to add" required></form></td>
        <td><select name="role" form="roles-add" aria-label="Role of the person to add">${options('staff')}</select>
          <button class="button button-small" type="submit" form="roles-add">Add</button></td></tr></tfoot>
    </table></div>
    <p class="small muted">Staff and anyone else who is not a Liberal Democrat peer are added at the end. Only people added by hand can be removed: a peer leaves this list when they leave the Members list.</p>`;

  const body = box.querySelector('[data-body]');
  const status = box.querySelector('[data-status]');
  const find = box.querySelector('[data-find]');
  const show = box.querySelector('[data-show]');

  const summary = () => {
    const counts = {};
    for (const p of people) counts[p.role] = (counts[p.role] || 0) + 1;
    box.querySelector('[data-summary]').textContent = `${people.length} people: ${roles.filter((r) => counts[r.id]).map((r) => `${counts[r.id]} ${plural[r.id] || r.label}`).join(', ')}.`;
  };
  const apply = () => {
    const q = find.value.trim().toLowerCase();
    body.querySelectorAll('tr').forEach((tr) => {
      tr.hidden = (!!q && !tr.dataset.name.toLowerCase().includes(q)) || (!!show.value && tr.dataset.role !== show.value);
    });
  };
  summary();
  find.addEventListener('input', debounce(apply, 120));
  show.addEventListener('change', apply);
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
    if (!name) return;
    status.textContent = 'Adding…';
    try {
      await post({ action: 'add', name, role });
      const person = { name, role, onList: false };
      people.push(person);
      body.insertAdjacentHTML('beforeend', row(person));
      form.reset();
      status.textContent = `Added ${name} as ${label[role]}.`;
      summary();
      apply();
    } catch (err) { status.textContent = err.message; }
  });

  if (!people.length) body.innerHTML = `<tr><td colspan="2">${empty('No one is in the list yet.')}</td></tr>`;
}
