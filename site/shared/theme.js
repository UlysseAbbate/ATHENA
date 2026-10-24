/* Light / dark theme. Loaded in <head> (no inline script, so the CSP stays strict) so the right theme is set before first paint.
 * Choice is "auto" (follow the device), "light" or "dark"; it is kept in this browser only.
 * Theme.toggleHtml() gives the header button; Theme.wire(root) makes it work. */
window.Theme = (() => {
  const KEY = "athena_theme", ORDER = ["auto", "light", "dark"], LABEL = { auto: "Auto", light: "Light", dark: "Dark" };
  const get = () => { try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : "auto"; } catch { return "auto"; } };
  const set = v => { try { localStorage.setItem(KEY, v); } catch { /* private window: lasts for this page only */ } apply(v); };
  function apply(v = get()) {
    const el = document.documentElement;
    if (v === "auto") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", v);
    const dark = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.append(m); }
    m.content = dark ? "#1D1B0E" : "#FDBB30";
    document.querySelectorAll("[data-theme-btn]").forEach(b => { b.textContent = "Theme: " + LABEL[v]; b.setAttribute("aria-label", "Colour theme: " + LABEL[v] + ". Press to change."); });
  }
  const toggleHtml = () => '<button type="button" class="ghost theme-btn" data-theme-btn></button>';
  function wire(root = document) {
    root.querySelectorAll("[data-theme-btn]").forEach(b => { b.onclick = () => set(ORDER[(ORDER.indexOf(get()) + 1) % 3]); });
    apply();
  }
  apply();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => apply());
  return { get, set, apply, toggleHtml, wire };
})();
