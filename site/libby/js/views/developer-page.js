// The Developer site (the admin only): a register of every page and who can open it, how the beta test is set up, and where work in
// progress goes. The register is read from pages.js, so it is always what the site really does.
import { esc, pageHeader } from '../ui.js';
import { PAGES, BETA_MENU, LEVEL_NAMES, DEVELOPER, ROLE_ORDER } from '../pages.js';

// (a page's id is the start of its address; pages with a variable part, such as a Bill number, are shown with \u2026)
const address = (p) => '#/' + p.id;

export async function renderDeveloper(el) {
  const rows = PAGES.filter((p) => p.id !== 'home').map((p) => {
    const who = p.level === DEVELOPER ? 'Developer only' : p.beta ? `${LEVEL_NAMES[p.level || 'peers']} and above, and Beta testers` : `${LEVEL_NAMES[p.level || 'peers']} and above`;
    return `<tr><th scope="row">${esc(p.id)}</th><td>${/\(/.test(p.match.source) ? esc(address(p) + '/\u2026') : `<a href="${esc(address(p))}">${esc(address(p))}</a>`}</td><td>${esc(who)}</td><td>${p.beta ? 'Yes' : ''}</td></tr>`;
  }).join('');
  el.innerHTML = `${pageHeader('Developer', 'Only you can see this page. It lists every page, who can open it, and how to put new work in front of the beta testers.')}
    <section>
      <h2>The three editions</h2>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th scope="col">Edition</th><th scope="col">Who</th><th scope="col">What they see</th></tr></thead>
        <tbody>
          <tr><th scope="row">Live</th><td>${ROLE_ORDER.filter((r) => r !== 'admin').map((r) => esc(LEVEL_NAMES[r])).join(', ')}</td><td>Every page up to their level.</td></tr>
          <tr><th scope="row">Beta test</th><td>${esc(LEVEL_NAMES.beta)}</td><td>${BETA_MENU.map((m) => esc(m.label)).join(', ')} only, read-only. Nothing else opens, even by typing the address, and the server refuses everything else.</td></tr>
          <tr><th scope="row">Developer</th><td>${esc(LEVEL_NAMES.developer)} (you)</td><td>Everything, plus the pages marked <i>Developer only</i> below.</td></tr>
        </tbody></table></div>
    </section>
    <section>
      <h2>Every page</h2>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th scope="col">Page</th><th scope="col">Address</th><th scope="col">Who can open it</th><th scope="col">In the beta</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>
    <section>
      <h2>Moving a page between editions</h2>
      <ul>
        <li><b>Keep it to yourself while you build it:</b> give its entry in <code>site/libby/js/pages.js</code> <code>level: DEVELOPER</code>.</li>
        <li><b>Put it in the beta:</b> add <code>beta: true</code> to its entry (and, if it reads from routes that are not listed under its <code>api</code>, list them under <code>betaApi</code>). It is read-only for beta testers.</li>
        <li><b>Go live for everyone:</b> remove <code>DEVELOPER</code> and set the lowest level that should have it.</li>
        <li><b>Invite a beta tester:</b> on the Athena Access page, give them the LIBBY level <i>Beta tester</i> (or make a shared code at that level).</li>
      </ul>
    </section>`;
}
