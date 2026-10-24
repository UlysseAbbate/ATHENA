"""Static server for site/ that applies the `/*` block of site/_headers, so UI tests run under the real CSP."""
import http.server, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2] / "site"
HEADERS = []          # applied to every page: the `/*` block of _headers
RULES = []            # [(path prefix, [(header, value)], [detached headers])]: other blocks, as Cloudflare applies them on top
block = None
for line in (ROOT / "_headers").read_text().splitlines():
    if line.startswith("/"):
        block = line.strip()
        if block != "/*":
            RULES.append((block, [], []))
    elif line.startswith("  ") and ":" in line or line.startswith("  !"):
        t = line.strip()
        if t.startswith("!"):
            if block != "/*" and RULES: RULES[-1][2].append(t[1:].strip())
            continue
        k, v = t.split(":", 1)
        if k == "Strict-Transport-Security":
            continue
        if block == "/*":
            HEADERS.append((k, v.strip()))
        elif RULES:
            RULES[-1][1].append((k, v.strip()))


def matches(pattern, path):
    if pattern.endswith("/*"):
        return path.startswith(pattern[:-1])
    if pattern.startswith("/*"):
        return path.endswith(pattern[2:])
    return path == pattern


# the same simple rules as site/_redirects (exact path, or prefix/* with :splat)
REDIRECTS = []
rfile = ROOT / "_redirects"
if rfile.exists():
    for line in rfile.read_text().splitlines():
        parts = line.split()
        if len(parts) == 3 and not line.startswith("#"):
            REDIRECTS.append((parts[0], parts[1], int(parts[2])))


class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        for src, dst, code in REDIRECTS:
            if src.endswith("/*") and path.startswith(src[:-1]):
                return self.redirect(dst.replace(":splat", path[len(src) - 1:]), code)
            if path == src:
                return self.redirect(dst, code)
        return super().do_GET()

    def redirect(self, to, code):
        self.send_response(code)
        self.send_header("Location", to)
        self.end_headers()

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        path = self.path.split("?")[0]
        applied = [(k, v) for k, v in HEADERS]
        for pattern, add, detach in RULES:
            if matches(pattern, path):
                applied = [(k, v) for k, v in applied if k not in detach]
                applied += [(k, v) for k, v in add if k not in ("Cache-Control",)]
        for k, v in applied:
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
