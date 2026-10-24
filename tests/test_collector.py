"""Offline tests for the collector: no network (fetches are stubbed). Run: python -m pytest -q"""
import json
import sys
from datetime import timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tracker"))
import update as U  # noqa: E402


class Resp:
    def __init__(self, text="", status=200, content=None):
        self.text, self.status_code = text, status
        self.content = content if content is not None else text.encode()

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    U._robots.clear()
    U._host_next.clear()
    U.health.clear()
    monkeypatch.setattr(U, "MIN_INTERVAL", 0)
    yield


def stub_session(monkeypatch, pages: dict):
    calls = []

    def fake_get(url, timeout=None, **kw):
        calls.append(url)
        if url in pages:
            v = pages[url]
            return v if isinstance(v, Resp) else Resp(v)
        return Resp("", 404)
    monkeypatch.setattr(U.S, "get", fake_get)
    return calls


# ------------------------------------------------------------------ robots.txt
def test_robots_disallow_blocks_fetch(monkeypatch):
    calls = stub_session(monkeypatch, {"https://a.test/robots.txt": "User-agent: *\nDisallow: /private\n",
                                       "https://a.test/ok": "fine"})
    assert U.get("https://a.test/ok").text == "fine"
    with pytest.raises(U.RobotsDisallowed):
        U.get("https://a.test/private/x")
    assert "https://a.test/private/x" not in calls


def test_robots_403_means_no_bots(monkeypatch):
    stub_session(monkeypatch, {"https://b.test/robots.txt": Resp("", 403), "https://b.test/page": "x"})
    with pytest.raises(U.RobotsDisallowed):
        U.get("https://b.test/page")


def test_robots_404_means_allowed(monkeypatch):
    stub_session(monkeypatch, {"https://c.test/page": "x"})
    assert U.get("https://c.test/page").text == "x"


def test_google_news_rss_is_blocked_by_its_robots(monkeypatch):
    rules = "User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/\n"
    stub_session(monkeypatch, {"https://news.google.com/robots.txt": rules})
    assert not U.allowed("https://news.google.com/rss/search?q=lib+dems")


def test_feed_entries_respects_robots(monkeypatch):
    stub_session(monkeypatch, {"https://d.test/robots.txt": "User-agent: *\nDisallow: /feed\n"})
    entries, why = U._feed_entries("https://d.test/feed")
    assert entries == [] and why == "blocked by robots.txt"


def test_unreachable_site_is_reported_as_such(monkeypatch):
    def down(url, timeout=None, **kw):
        raise U.requests.ConnectionError("refused")
    monkeypatch.setattr(U.S, "get", down)
    with pytest.raises(U.RobotsDisallowed, match="unreachable"):
        U.get("https://e.test/page")


# ------------------------------------------------------------------ sitemap fallback
def test_sitemap_items(monkeypatch):
    recent = (U.NOW - timedelta(days=3)).date().isoformat()
    old = (U.NOW - timedelta(days=400)).date().isoformat()
    index = f"""<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://tt.test/post-sitemap.xml</loc><lastmod>{recent}</lastmod></sitemap>
      <sitemap><loc>https://tt.test/author-sitemap.xml</loc><lastmod>{recent}</lastmod></sitemap></sitemapindex>"""
    posts = f"""<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://tt.test/research/fixing-the-housing-crisis/</loc><lastmod>{recent}</lastmod></url>
      <url><loc>https://tt.test/research/an-old-paper/</loc><lastmod>{old}</lastmod></url>
      <url><loc>https://tt.test/about/team/</loc><lastmod>{recent}</lastmod></url></urlset>"""
    stub_session(monkeypatch, {"https://tt.test/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://tt.test/sitemap_index.xml\n",
                               "https://tt.test/sitemap_index.xml": index, "https://tt.test/post-sitemap.xml": posts})
    items, via = U.sitemap_items({"name": "TT", "url": "https://tt.test/research/"}, "thinktank")
    assert [i["title"] for i in items] == ["Fixing the housing crisis"]
    assert items[0]["slug_title"] is True


def test_sitemap_skips_listing_pages_and_whole_universities(monkeypatch):
    recent = (U.NOW - timedelta(days=2)).date().isoformat()
    urlset = "".join(f"<url><loc>https://o.test{p}</loc><lastmod>{recent}</lastmod></url>" for p in
                     ["/collection/housing-justice", "/series/farmers", "/report/a-real-report/", "/report/another-one/",
                      "/report/third-report/", "/blog/a-post/"])
    stub_session(monkeypatch, {"https://o.test/sitemap.xml": f"<urlset>{urlset}</urlset>"})
    items, _ = U.sitemap_items({"name": "O", "url": "https://o.test/report/"}, "thinktank")
    assert sorted(i["url"] for i in items) == ["https://o.test/report/a-real-report/", "https://o.test/report/another-one/",
                                               "https://o.test/report/third-report/"]
    assert all("sitemap" in i["tags"] for i in items)
    items, why = U.sitemap_items({"name": "Uni", "url": "https://www.uni.ac.uk/publications/"}, "thinktank")
    assert items == [] and "whole university" in why


# ------------------------------------------------------------------ media + Olney coverage
def test_media_discovers_moved_feed(monkeypatch):
    page = '<html><head><link rel="alternate" type="application/rss+xml" href="/new-feed.xml"></head></html>'
    now = U.NOW.isoformat()
    stub_session(monkeypatch, {"https://n.test/politics": page})
    good = [{"title": f"Lib Dems story {k}", "summary": "", "link": f"https://n.test/{k}", "published": now} for k in range(3)]
    monkeypatch.setattr(U, "_feed_entries", lambda f: (good, "ok") if f.endswith("/new-feed.xml") else ([], "HTTP 404"))
    monkeypatch.setitem(U.CONFIG, "media", {"title_pattern": U.CONFIG["media"]["title_pattern"], "lookback_days": 14,
                                            "outlets": [{"name": "Moved", "feeds": ["https://n.test/old"], "url": "https://n.test/politics"}]})
    items, _ = U.collect_media()
    assert len(items) == 3 and U.health[0]["ok"] and "found" in U.health[0]["error"]


def test_media_filters_party_and_collects_olney(monkeypatch):
    now = U.NOW.isoformat()
    entries = [
        {"title": "Lib Dems call for NHS funding", "summary": "", "link": "https://o.test/1", "published": now},
        {"title": "Sarah Olney presses minister on Heathrow", "summary": "", "link": "https://o.test/2", "published": now},
        {"title": "Chancellor's budget plans", "summary": "Liberal Democrats respond", "link": "https://o.test/3", "published": now},
        {"title": "Football results round-up", "summary": "", "link": "https://o.test/4", "published": now},
    ]
    monkeypatch.setattr(U, "_feed_entries", lambda f: (entries, "ok"))
    monkeypatch.setitem(U.CONFIG, "media", {"title_pattern": U.CONFIG["media"]["title_pattern"], "lookback_days": 14,
                                            "outlets": [{"name": "Outlet", "feeds": ["https://o.test/rss"]},
                                                        {"name": "No feed", "feeds": []}]})
    items, cov = U.collect_media()
    assert {i["url"] for i in items} == {"https://o.test/1", "https://o.test/2", "https://o.test/3"}
    assert [c["url"] for c in cov] == ["https://o.test/2"]
    assert cov[0]["covered_on"] and cov[0]["outlet"] == "Outlet"
    by = {h["name"]: h for h in U.health}
    assert by["Outlet"]["ok"] and not by["No feed"]["ok"]


# ------------------------------------------------------------------ merge keeps what earlier runs learned
def test_merge_keeps_learned_date_and_title(tmp_path, monkeypatch):
    monkeypatch.setattr(U, "DATA", tmp_path)
    monkeypatch.setattr(U, "ENRICH", False)
    first = U.make_item("thinktank", "TT", "Real title from the page", "https://tt.test/research/x/", None)
    first.update(first_seen=(U.NOW - timedelta(days=5)).isoformat(), published=(U.NOW - timedelta(days=6)).isoformat())
    (tmp_path / "feed.json").write_text(json.dumps({"items": [first]}))
    again = U.make_item("thinktank", "TT", "X", "https://tt.test/research/x/", None)
    again["slug_title"] = True
    out = U.merge([again])
    assert len(out) == 1
    assert out[0]["title"] == "Real title from the page"
    assert out[0]["published"] == first["published"]
    assert out[0]["first_seen"] == first["first_seen"]
    assert "slug_title" not in out[0]


# ------------------------------------------------------------------ political polling filter
@pytest.mark.parametrize("title,keep", [
    ("Voting intention: Reform 27%, Lab 22%", True),
    ("Westminster voting intention 21-22 October", True),
    ("Most Britons support votes at 16, poll finds", True),
    ("Bingo players' favourite snacks survey", False),
    ("Generic ballot: Democrats lead in midterms", False),
])
def test_political_poll(title, keep):
    assert U.political_poll(title) is keep


# ------------------------------------------------------------------ state sync refuses to start from nothing
def test_sync_state_raises_when_database_unreachable(monkeypatch, tmp_path):
    monkeypatch.setattr(U, "DATA", tmp_path)
    monkeypatch.setenv("INGEST_URL", "https://x.test/fn")
    monkeypatch.setenv("INGEST_TOKEN", "t" * 30)

    def boom(*a, **k):
        raise U.requests.ConnectionError("down")
    monkeypatch.setattr(U.requests, "post", boom)
    with pytest.raises(U.requests.ConnectionError):
        U.sync_state()


def test_config_is_valid():
    assert all(o.get("feeds") is not None for o in U.CONFIG["media"]["outlets"])
    assert "firms" not in U.CONFIG["polling"]
    names = [t["name"] for t in U.CONFIG["thinktanks"]]
    assert len(names) == len(set(names))
