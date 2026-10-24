"""Static server for site/ that applies the `/*` block of site/_headers, so UI tests run under the real CSP."""
import http.server, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2] / "site"
HEADERS = []
block = None
for line in (ROOT / "_headers").read_text().splitlines():
    if line.startswith("/"):
        block = line.strip()
    elif line.startswith("  ") and block == "/*" and ":" in line:
        k, v = line.strip().split(":", 1)
        if k != "Strict-Transport-Security":
            HEADERS.append((k, v.strip()))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        for k, v in HEADERS:
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
