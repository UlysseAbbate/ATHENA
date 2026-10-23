const COLORS = {Con:"#1e6fd9", Lab:"#d83a3a", Reform:"#12b6cf", LD:"#f59e0b", Green:"#3aa655", SNP:"#8a8f98"};
const CAT_LABEL = {committee:"Committee", thinktank:"Think tank", media:"Media", polling:"Polling"};
const NEW_HOURS = 48;
const state = {tab:"all", items:[], polls:[], health:[]};
const $ = id => document.getElementById(id);

async function load(name){
  try{ const r = await fetch(`data/${name}.json`, {cache:"no-cache"}); return r.ok ? await r.json() : null; }
  catch(e){ return null; }
}

function ago(iso){
  if(!iso) return "undated";
  const h = (Date.now() - new Date(iso)) / 36e5;
  if(h < 1) return "just now";
  if(h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h/24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
}
function isNew(it){
  // new = first seen recently AND (undated or published recently), so the first
  // ever run does not mark the whole backlog as new.
  const seen = (Date.now() - new Date(it.first_seen)) / 36e5 < NEW_HOURS;
  const pubOk = !it.published || (Date.now() - new Date(it.published)) / 864e5 < 14;
  return seen && pubOk;
}
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function render(){
  const tab = state.tab;
  const isHealth = tab === "health", isPoll = tab === "polling";
  $("healthpanel").hidden = !isHealth;
  $("list").hidden = isHealth; $("count").hidden = isHealth;
  $("controls").hidden = isHealth;
  $("pollpanel").hidden = !isPoll;
  $("tag").hidden = !isPoll;
  if(isHealth){ renderHealth(); return; }

  const q = $("q").value.trim().toLowerCase();
  const days = +$("range").value, src = $("source").value, tag = $("tag").value, onlyNew = $("onlyNew").checked;
  let rows = state.items.filter(i => tab === "all" || i.category === tab);

  // rebuild source dropdown for this tab
  const sources = [...new Set(rows.map(i => i.source))].sort();
  const sel = $("source"), cur = sel.value;
  sel.innerHTML = '<option value="">All sources</option>' + sources.map(s => `<option ${s===cur?"selected":""}>${esc(s)}</option>`).join("");

  rows = rows.filter(i => {
    const d = new Date(i.published || i.first_seen);
    if((Date.now() - d) / 864e5 > days) return false;
    if(src && i.source !== src) return false;
    if(tag && !(i.tags||[]).includes(tag)) return false;
    if(onlyNew && !isNew(i)) return false;
    if(q && !(i.title + " " + i.source + " " + i.summary).toLowerCase().includes(q)) return false;
    return true;
  });
  $("count").textContent = `${rows.length} item${rows.length===1?"":"s"}`;
  $("list").innerHTML = rows.slice(0, 400).map(i => `
    <li style="--c:var(--c-${i.category})">
      <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
      <div class="meta">
        ${isNew(i) ? '<span class="pill new">NEW</span>' : ""}
        <span class="src">${esc(i.source)}</span>
        <span>${CAT_LABEL[i.category]||""}</span>
        <span>${ago(i.published || i.first_seen)}</span>
        ${(i.tags||[]).map(t => `<span class="pill">${esc(t)}</span>`).join("")}
      </div>
      ${i.summary ? `<p class="summary">${esc(i.summary)}</p>` : ""}
    </li>`).join("") || '<li style="--c:var(--line)">Nothing matches. Try widening the date range.</li>';
  if(isPoll) renderPolls();
}

function renderPolls(){
  const rows = (state.polls || []).filter(r => r.end && !r.mrp).sort((a,b) => a.end.localeCompare(b.end));
  $("pollsrc").textContent = rows.length ? `· ${rows.length} polls from Wikipedia's table` : "· no table data yet";
  const svg = $("chart");
  if(!rows.length){ svg.innerHTML = ""; $("legend").innerHTML = ""; $("polltable").innerHTML = ""; return; }
  const parties = ["Con","Lab","Reform","LD","Green"];
  const W=800,H=280,L=34,R=10,T=10,B=24;
  const t0 = new Date(rows[0].end).getTime(), t1 = new Date(rows.at(-1).end).getTime() || t0 + 1;
  const vals = rows.flatMap(r => parties.map(p => r[p]).filter(v => v != null));
  const max = Math.ceil(Math.max(...vals) / 5) * 5;
  const x = t => L + (t - t0) / ((t1 - t0) || 1) * (W - L - R);
  const y = v => H - B - v / max * (H - T - B);
  let out = "";
  for(let g = 0; g <= max; g += 5) out += `<line x1="${L}" x2="${W-R}" y1="${y(g)}" y2="${y(g)}" stroke="currentColor" opacity=".12"/><text x="${L-6}" y="${y(g)+4}" text-anchor="end">${g}%</text>`;
  [[t0,"start"], [(t0+t1)/2,"middle"], [t1,"end"]].forEach(([t,anchor]) => out += `<text x="${x(t)}" y="${H-6}" text-anchor="${anchor}">${new Date(t).toLocaleDateString("en-GB",{month:"short",year:"2-digit"})}</text>`);
  parties.forEach(p => {
    const pts = rows.filter(r => r[p] != null);
    // dots per poll + 7-poll rolling average line
    pts.forEach(r => out += `<circle cx="${x(new Date(r.end))}" cy="${y(r[p])}" r="1.8" fill="${COLORS[p]}" opacity=".35"/>`);
    const avg = pts.map((r,i) => { const s = pts.slice(Math.max(0,i-6), i+1); return [new Date(r.end).getTime(), s.reduce((a,b)=>a+b[p],0)/s.length]; });
    out += `<polyline fill="none" stroke="${COLORS[p]}" stroke-width="2.2" points="${avg.map(a => `${x(a[0]).toFixed(1)},${y(a[1]).toFixed(1)}`).join(" ")}"/>`;
  });
  svg.innerHTML = out;
  const latest = rows.slice(-7);
  $("legend").innerHTML = parties.map(p => {
    const v = latest.filter(r => r[p] != null); const a = v.length ? (v.reduce((s,r)=>s+r[p],0)/v.length).toFixed(1) : "–";
    return `<span><i style="background:${COLORS[p]}"></i>${p} ${a}%</span>`;
  }).join("") + '<span class="muted">(avg of last 7 polls; line = 7-poll rolling average)</span>';
  $("polltable").innerHTML = "<tr><th>Pollster</th><th>Fieldwork</th><th>N</th>" + parties.map(p=>`<th>${p}</th>`).join("") + "</tr>" +
    rows.slice(-30).reverse().map(r => `<tr><td>${esc(r.pollster)}</td><td>${esc(r.dates)}</td><td>${r.sample ?? ""}</td>${parties.map(p=>`<td>${r[p] ?? ""}</td>`).join("")}</tr>`).join("");
}

function renderHealth(){
  const groups = {};
  state.health.forEach(h => (groups[h.group] ||= []).push(h));
  const failing = state.health.filter(h => !h.ok).length;
  $("healthpanel").innerHTML = `<p class="muted">${state.health.length - failing} of ${state.health.length} sources returned items on the last run. Fix failing ones in <code>config/sources.yml</code> (add a <code>feed:</code> URL, or correct the page URL).</p>` +
    Object.entries(groups).map(([g, rows]) => `<h2>${esc(g)}</h2><div class="tablewrap"><table><tr><th></th><th>Source</th><th>Items</th><th>Method</th><th>Note</th></tr>` +
      rows.map(h => `<tr><td class="${h.ok?"good":"bad"}">${h.ok?"●":"○"}</td><td>${esc(h.name)}</td><td>${h.items}</td><td>${esc(h.method||"")}</td><td>${esc(h.error)}</td></tr>`).join("") + "</table></div>").join("");
}

(async function init(){
  const [feed, polls, health] = await Promise.all([load("feed"), load("polls"), load("health")]);
  state.items = feed?.items || []; state.polls = polls?.rows || []; state.health = health?.sources || [];
  $("updated").textContent = feed ? `Updated ${ago(feed.updated)}` : "No data yet — run the collector";
  $("tabs").addEventListener("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b));
    state.tab = b.dataset.tab; $("source").value = ""; render();
  });
  ["q","source","range","tag","onlyNew"].forEach(id => $(id).addEventListener("input", render));
  render();
})();
