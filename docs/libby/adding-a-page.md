# Adding a page

A page is **one new file plus one new line**. Nothing else needs editing.

## 1. Write the page file

Create `public/js/views/<name>-page.js` (browser page files always end in `-page.js`). It exports one function:

```js
import { api } from '../api.js';
import { esc, pageHeader, loading, errorBox } from '../ui.js';

export async function renderThing(el, params, query) {
  el.innerHTML = `${pageHeader('Thing', 'What this page is for.')}<div id="body">${loading('Loading')}</div>`;
  // ...fetch with api('route-name') and fill #body. Always put text from outside through esc().
}
```

`el` is the page area, `params` is whatever the registry hands over, `query` is the part after `?` in the address.

## 2. Add one entry to `public/js/pages.js`

```js
{ id: 'thing', match: /^\/thing$/, view: 'thing-page.js', fn: 'renderThing', level: 'whips',
  group: 'group', tab: 'thing', tabLabel: 'Thing', href: '#/thing', card: 'One line shown on the hub page.',
  api: [['thing-data', { GET: 'whips', '*': 'staff' }]] },
```

- `level`: `'peers'` (everyone, the default), `'whips'` (Whip, Spokesperson and Leader's office as well as Staff and Admin), `'staff'`, or
  `'admin'` (also `BACKCHANNEL`, for operations Staff must not do).
- `group` / `tab` / `tabLabel` / `href` / `card`: put the page in a group (`'business'` or `'group'`) so it gets a button above its
  siblings and a card on the hub page. Leave these out for a stand-alone page.
- For a new menu item, add a line to `MENU` at the top of the file.
- `api`: the `/api` routes the page uses and who may use them (`GET` = reading, `'*'` = saving). A route you do not list can be read by
  Peers and changed only by Admin, which is safe.

That is all: the menu, hub card, button row, home card (for menu items) and the server's access rule are all made from that line.

## 3. If the page saves data, write the route

Create `functions/api/<route-name>.js`. Any function that changes data must start with:

```js
const refused = await passcodeProblem(request, env);
if (refused) return refused;
```

(import it from `../../lib/auth.js`). The checker fails if a route can save data but never calls it.

## 4. If it needs a database table

Add the table to the bottom of `supabase/schema.sql` and put the same SQL in `supabase/migrations/` as the next numbered file
(see the README there). Run it in Supabase.

## 5. Styles

Add any new styles to the bottom of `public/styles.css`. Do not create a new stylesheet or add styles from JavaScript.

## 6. Check it

`node scripts/check-site.mjs` (this also runs by itself on GitHub when you commit). It tells you in plain words if a file is missing,
an import is wrong, the page list does not match the files, or a table is missing from the schema.

Try new work on a branch first: see "Trying a change safely" in the README.
