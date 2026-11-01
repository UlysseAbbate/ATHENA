// Team & access (the administrator's alone): who has LIBBY, the codes and recent changes. The page itself is shared with LUCIEN (site/shared/teampage.js).

export async function renderTeam(el) {
  const host = document.createElement('div');
  el.replaceChildren(host);
  await window.TeamPage.render(host, { program: 'libby', name: 'LIBBY' });
}
