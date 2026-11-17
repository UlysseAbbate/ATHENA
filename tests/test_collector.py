"""Offline tests for the collector: no network (fetches are stubbed). Run: python -m pytest -q"""
import json
from datetime import date
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

    def json(self):
        return json.loads(self.text)

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
    pages = {"https://o.test/1": "<p>Nothing here</p>",
             "https://o.test/3": "<nav>Sarah Olney</nav><article>The Richmond Park MP, Sarah Olney, said it was a disgrace.</article>",
             "https://o.test/4": "<script>var x='Olney'</script><p>Scores</p>"}
    monkeypatch.setattr(U, "get", lambda url, **kw: Resp(pages[url]))
    monkeypatch.setitem(U.CONFIG, "media", {"title_pattern": U.CONFIG["media"]["title_pattern"], "lookback_days": 14,
                                            "outlets": [{"name": "Outlet", "feeds": ["https://o.test/rss"]},
                                                        {"name": "No feed", "feeds": []}]})
    items, cov = U.collect_media()
    assert {i["url"] for i in items} == {"https://o.test/1", "https://o.test/2", "https://o.test/3"}
    assert sorted(c["url"] for c in cov) == ["https://o.test/2", "https://o.test/3"]   # 3 names her only inside the article
    assert [c for c in cov if c["url"].endswith("/3")][0]["notes"] == "Mentioned in the article text"
    assert cov[0]["covered_on"] and cov[0]["outlet"] == "Outlet"
    by = {h["name"]: h for h in U.health}
    assert by["Outlet"]["ok"] and not by["No feed"]["ok"]


def test_article_mentions_ignores_menus_and_scripts():
    pat = U.re.compile(U.CONFIG["coverage"]["pattern"], U.re.I)
    assert U.mentions("<article>Sarah Olney spoke</article>", pat)
    assert not U.mentions("<header>Olney</header><script>Olney</script><p>x</p>", pat)


def test_first_line_cuts_at_a_word():
    assert U.first_line("Short post") == "Short post"
    out = U.first_line("word " * 60)
    assert out.endswith("…") and len(out) <= 112 and "  " not in out


def test_bluesky_posts_become_social_post_rows():
    data = {"feed": [
        {"post": {"uri": "at://did:plc:x/app.bsky.feed.post/3abc", "author": {"handle": "sarah.bsky.social"},
                  "record": {"text": "Proud to back\nlocal schools today", "createdAt": U.NOW.isoformat()}}},
        {"reason": {"$type": "repost"}, "post": {"uri": "at://y/app.bsky.feed.post/3zzz", "author": {"handle": "other.bsky.social"},
                                                 "record": {"text": "not hers", "createdAt": U.NOW.isoformat()}}},
        {"post": {"uri": "at://did:plc:x/app.bsky.feed.post/3old", "author": {"handle": "sarah.bsky.social"},
                  "record": {"text": "ancient", "createdAt": "2020-01-01T00:00:00Z"}}}]}
    rows = U.bsky_rows("Sarah Olney MP", "sarah.bsky.social", data, U.NOW - timedelta(days=14))
    assert len(rows) == 1
    r = rows[0]
    assert r["platform"] == "BlueSky" and r["organisation"] == "Sarah Olney MP" and r["summary"] == "Proud to back local schools today"
    assert r["url"] == "https://bsky.app/profile/sarah.bsky.social/post/3abc" and r["posted_on"] == U.NOW.astimezone(U.LONDON).date().isoformat()


def test_collect_social_reads_only_open_platforms(monkeypatch):
    monkeypatch.setenv("INGEST_URL", "https://i.test")
    monkeypatch.setenv("INGEST_TOKEN", "t")
    monkeypatch.setattr(U, "_ingest", lambda p: {"accounts": [
        {"organisation": "London Lib Dems", "platform": "Instagram", "handle": "londonlibdems"},
        {"organisation": "London Lib Dems", "platform": "BlueSky", "handle": "ldn.bsky.social"}]})
    seen = []
    feed = {"feed": [{"post": {"uri": "at://x/app.bsky.feed.post/3k", "author": {"handle": "ldn.bsky.social"},
                               "record": {"text": "Hello London", "createdAt": U.NOW.isoformat()}}}]}
    monkeypatch.setattr(U, "get", lambda url, **kw: (seen.append(url), Resp(json.dumps(feed)))[1])
    U.health.clear()
    rows = U.collect_social()
    assert len(rows) == 1 and len(seen) == 1 and "bsky" in seen[0]


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


def test_embedded_json_items_reads_next_data():
    html = '''<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"items":[
      {"title":"Housing and the cost of living: a new report on rents","slug":"x","url":"/research/housing-costs-report","publishedAt":"2026-10-20"},
      {"title":"Short","url":"/research/short"},
      {"headline":"Why polling on the NHS matters for the next election","url":"https://example.org/insight/nhs-polling","datePublished":"2026-10-18T09:00:00Z"},
      {"@type":"Organization","name":"Example Institute of Policy Research Studies","url":"https://example.org/"}]}}}</script></body></html>'''
    rows = U.embedded_json_items("https://example.org/research", html)
    assert [r[1] for r in rows] == ["https://example.org/research/housing-costs-report", "https://example.org/insight/nhs-polling"]
    assert rows[0][2].date().isoformat() == "2026-10-20"


def test_embedded_json_items_reads_json_ld_item_list():
    html = '''<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","position":1,"item":{"@type":"Article","name":"Voting intention and the new swing seats analysis","url":"https://example.org/blog/swing-seats"}}]}</script>'''
    rows = U.embedded_json_items("https://example.org/blog", html)
    assert [r[1] for r in rows] == ["https://example.org/blog/swing-seats"]


def test_wp_items_prefers_custom_publication_type(monkeypatch):
    html = '<link rel="https://api.w.org/" href="https://example.org/wp-json/">'
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        if url.endswith("/wp/v2/types"):
            return Resp(json.dumps({"post": {"slug": "post", "rest_base": "posts"}, "publication": {"slug": "publication", "rest_base": "publications"}}))
        if "/wp/v2/publications" in url:
            return Resp(json.dumps([{"title": {"rendered": f"Report number {i} on the economy"}, "link": f"https://example.org/p/{i}", "date": "2026-10-2%dT10:00:00" % i} for i in range(4)]))
        return Resp("[]", status=404)
    monkeypatch.setattr(U, "get", fake_get)
    rows, via = U.wp_items("https://example.org/publications", html)
    assert len(rows) == 4 and via.endswith("/wp/v2/publications") and rows[0][1] == "https://example.org/p/0"
    assert not any(u.endswith("/wp/v2/posts") or "/wp/v2/posts?" in u for u in calls)   # stopped at the publication type


def test_sitemap_without_dates_takes_the_end_of_it(monkeypatch):
    xml = "<urlset>" + "".join(f"<url><loc>https://example.org/research/paper-{i}</loc></url>" for i in range(40)) + "</urlset>"

    def fake_get(url, **kw):
        if url.endswith("/sitemap.xml"):
            return Resp(xml)
        raise RuntimeError("no")
    monkeypatch.setattr(U, "get", fake_get)
    monkeypatch.setattr(U, "_robots_for", lambda u: type("R", (), {"site_maps": lambda self: []})())
    items, via = U.sitemap_items({"name": "Ex", "url": "https://example.org/research"}, "thinktank")
    assert items and items[0]["url"].endswith("paper-39")


def test_squarespace_items(monkeypatch):
    body = json.dumps({"items": [{"title": "Our latest polling on housing and the cost of living", "fullUrl": "/blog/housing-poll", "publishOn": 1760000000000},
                                 {"title": "No link", "fullUrl": ""}]})
    monkeypatch.setattr(U, "get", lambda url, **kw: Resp(body))
    rows = U.squarespace_items("https://sq.example.org/blog", "<html>static1.squarespace.com</html>")
    assert rows[0][1] == "https://sq.example.org/blog/housing-poll" and rows[0][2].year == 2025
    assert U.squarespace_items("https://x.org/", "<html>plain</html>") == []


def test_collect_source_does_not_hammer_a_site_that_answered(monkeypatch):
    asked = []

    def fake_get(url, **kw):
        asked.append(url)
        return Resp("<html><title>Home</title>" + "<p>no links here</p>" * 100 + "</html>")
    monkeypatch.setattr(U, "get", fake_get)
    monkeypatch.setattr(U, "_feed_entries", lambda u: ([], "not a feed"))
    monkeypatch.setattr(U, "sitemap_items", lambda tt, cat, limit=25: ([], "0 sitemap file(s)"))
    items, rec = U.collect_source({"name": "X", "url": "https://x.example.org/research", "urls": ["https://x.example.org/blog"]})
    assert not items and not rec["ok"]
    # the main page and the one alternate were each asked once; the www twins were not tried because the site had answered
    assert asked == ["https://x.example.org/research", "https://x.example.org/blog"]
    assert "lists no publication links" in rec["error"]


def test_sitemap_relaxed_pass_takes_top_level_slugs(monkeypatch):
    recent = (U.NOW - timedelta(days=3)).date().isoformat()
    urlset = "".join(f"<url><loc>https://o.test{p}</loc><lastmod>{recent}</lastmod></url>" for p in
                     ["/an-important-new-report-on-housing", "/about", "/another-detailed-paper-on-tax-reform"])
    stub_session(monkeypatch, {"https://o.test/sitemap.xml": f"<urlset>{urlset}</urlset>"})
    items, _ = U.sitemap_items({"name": "O", "url": "https://o.test/research"}, "thinktank")
    assert sorted(i["url"] for i in items) == ["https://o.test/an-important-new-report-on-housing", "https://o.test/another-detailed-paper-on-tax-reform"]


def test_sources_yml_has_no_duplicate_keys():
    import yaml

    class Strict(yaml.SafeLoader):
        pass

    def construct(loader, node, deep=False):
        keys = [loader.construct_object(k, deep=deep) for k, _ in node.value]
        assert len(keys) == len(set(keys)), f"duplicate keys: {sorted(k for k in set(keys) if keys.count(k) > 1)}"
        return yaml.SafeLoader.construct_mapping(loader, node, deep)
    Strict.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct)
    for name in ("sources.yml", "taxonomy.yml"):
        yaml.load((Path(__file__).resolve().parent.parent / "config" / name).read_text(), Strict)


def test_update_is_due_since_the_last_6am_or_6pm():
    from datetime import datetime, timezone
    utc = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731
    # winter (London = UTC): a run that GitHub started at 14:06 is due if nothing was collected since 06:00
    assert U.last_slot_start(utc(2026, 11, 9, 14, 6)) == utc(2026, 11, 9, 6)
    assert U.update_is_due("2026-11-08T18:03:00+00:00", utc(2026, 11, 9, 14, 6)) is True
    assert U.update_is_due("2026-11-09T06:40:00+00:00", utc(2026, 11, 9, 14, 6)) is False
    # after 6pm it is the evening slot, before 6am still the previous evening's
    assert U.last_slot_start(utc(2026, 11, 8, 21, 15)) == utc(2026, 11, 8, 18)
    assert U.last_slot_start(utc(2026, 11, 9, 5, 59)) == utc(2026, 11, 8, 18)
    # summer (London = UTC+1): 6am is 05:00 UTC, 6pm is 17:00 UTC
    assert U.last_slot_start(utc(2026, 7, 10, 14, 0)) == utc(2026, 7, 10, 5)
    assert U.last_slot_start(utc(2026, 7, 10, 3, 0)) == utc(2026, 7, 9, 17)
    # nothing stored, or an unreadable time: due
    assert U.update_is_due(None, utc(2026, 11, 9, 14, 6)) is True
    assert U.update_is_due("not a date", utc(2026, 11, 9, 14, 6)) is True


# ------------------------------------------------------------------ the GLA / London data drops that go to Lovelace's Daily Plan
def test_london_data_rows_take_the_data_statistics_and_meetings():
    today = date(2026, 11, 16)
    body = {"releases": [
        {"id": "lds:1", "tier": "london", "source_system": "london_datastore", "kind": "published", "date": "2026-11-14", "publisher": "GLA", "title": "Housing data", "url": "https://data.london.gov.uk/dataset/h"},
        {"id": "est:lds:1", "tier": "london", "source_system": "london_datastore", "kind": "upcoming", "date": "2026-12-01", "date_status": "estimated", "publisher": "GLA", "title": "Housing data (next update, estimated)", "url": "https://x"},
        {"id": "m:1", "tier": "london", "source_system": "manual", "kind": "upcoming", "date": "2026-11-20", "date_precision": "time", "datetime": "2026-11-20T09:30:00+00:00", "publisher": "GLA", "title": "Budget data", "url": ""},
        {"id": "ons:1", "tier": "ons", "source_system": "ons_api", "kind": "upcoming", "date": "2026-11-19", "publisher": "ONS", "title": "Labour market"},
        {"id": "nat:1", "tier": "national", "source_system": "govuk_search", "kind": "upcoming", "date": "2026-11-20", "publisher": "DfE", "title": "National"},
        {"id": "pol", "tier": "london", "source_system": "police_uk", "kind": "upcoming", "date": "2026-11-20", "publisher": "police", "title": "Crime"},
        {"id": "mtg", "tier": "london", "source_system": "gla_meetings", "kind": "upcoming", "date": "2026-11-20", "publisher": "GLA", "title": "Assembly meeting"},
        {"id": "old", "tier": "london", "source_system": "london_datastore", "kind": "published", "date": "2026-09-01", "publisher": "GLA", "title": "Too old"},
        {"id": "gone", "tier": "london", "source_system": "manual", "kind": "upcoming", "cancelled": True, "date": "2026-11-21", "publisher": "GLA", "title": "Cancelled"}]}
    rows = U.london_data_rows(body, today)
    by = {r["key"]: r for r in rows}
    assert sorted(by) == sorted(["statscal:lds:1:2026-11-14", "statscal:est:lds:1:2026-12-01", "statscal:m:1:2026-11-20", "statscal:ons:1:2026-11-19", "statscal:pol:2026-11-20", "statscal:mtg:2026-11-20"])
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)
    assert by["statscal:lds:1:2026-11-14"]["title"] == "GLA: Housing data (published)" and "date not yet confirmed" in by["statscal:est:lds:1:2026-12-01"]["title"] and by["statscal:m:1:2026-11-20"]["starts"] == "09:30"
    assert by["statscal:mtg:2026-11-20"]["section"] == "political" and by["statscal:ons:1:2026-11-19"]["section"] == "data"


# ------------------------------------------------------------------ open feeds for the Social Media Channels Tracker: YouTube and Mastodon
def test_open_feed_addresses():
    assert U.youtube_feed_url("UCabcdefghijklmnopqrstuv") == "https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"
    assert U.youtube_feed_url("channel/UC0123456789abcdefghijkl").endswith("channel_id=UC0123456789abcdefghijkl")
    assert U.mastodon_feed_url("sarah@mastodon.social") == "https://mastodon.social/@sarah.rss"
    assert U.mastodon_feed_url("@sarah@mastodon.social") == "https://mastodon.social/@sarah.rss"
    assert U.mastodon_feed_url("https://mastodon.social/@sarah") == "https://mastodon.social/@sarah.rss"
    assert U.mastodon_feed_url("not a handle") is None


def test_youtube_handle_is_looked_up_on_the_public_page(monkeypatch):
    seen = []
    monkeypatch.setattr(U, "fetch", lambda url, **kw: (seen.append(url), Resp('<html>..."channelId":"UCzzzzzzzzzzzzzzzzzzzzzz"...</html>'))[1])
    assert U.youtube_feed_url("londonlibdems") == "https://www.youtube.com/feeds/videos.xml?channel_id=UCzzzzzzzzzzzzzzzzzzzzzz"
    assert seen == ["https://www.youtube.com/@londonlibdems"]


def test_feed_posts_become_social_post_rows():
    entries = [{"title": "Our new film\n on housing", "link": "https://youtu.be/x", "published": U.NOW.isoformat()},
               {"title": "ancient", "link": "https://youtu.be/old", "published": "2020-01-01T00:00:00Z"},
               {"title": "", "summary": "<p>Only a summary</p>", "link": "https://m.test/1", "published": U.NOW.isoformat()},
               {"title": "no link", "link": "", "published": U.NOW.isoformat()}]
    rows = U.feed_post_rows("London Lib Dems", "YouTube", entries, U.NOW - timedelta(days=14))
    assert [r["url"] for r in rows] == ["https://youtu.be/x", "https://m.test/1"]
    assert rows[0]["platform"] == "YouTube" and rows[0]["organisation"] == "London Lib Dems" and rows[0]["summary"] == "Our new film on housing"


# ------------------------------------------------------------------ the Lib Dem London events (events.libdems.org.uk) for the Daily Plan
def _ev(title, when, eid="1", extra=""):
    return (f'<article class="event quarter "><div class="card"><div class="event-content"><h2 class="event-title font-custom">'
            f'<a href="https://events.libdems.org.uk/events/{eid}/x" title="t">\n  {title}\n </a></h2><div class="event-date"><div><span>{when}</span>{extra} <br/>'
            f'<span class="event-date-timezone">Greenwich Mean Time</span></div></div></div></div></article>')


def test_libdem_event_rows():
    html = "".join([
        _ev("Canada Water — Sunday Campaigning", "15th Nov 2026 3pm - 5pm", "10"),
        _ev("Ealing AGM", "16th Nov 2026 7:30pm - 11pm", "11"),
        _ev("Late start", "17th Nov 2026 12am", "12"),
        _ev("Weekend away", "21st Nov 2026 9am", "13", " - <span>22nd Nov 2026 1pm</span>"),
        _ev("Membership year", "2nd Jan 2026 12am", "14", " - <span>31st Dec 2026 12am</span>"),
        _ev("Already over", "1st Nov 2026 3pm - 5pm", "15"),
        _ev("Not ours", "20th Nov 2026 3pm - 5pm", "16").replace("https://events.libdems.org.uk", "https://evil.example"),
    ])
    rows = U.libdem_event_rows(html, date(2026, 11, 15))
    assert [r["key"] for r in rows] == ["libdemev:10:2026-11-15", "libdemev:11:2026-11-16", "libdemev:12:2026-11-17", "libdemev:13:2026-11-21"]
    assert rows[0]["title"] == "Canada Water — Sunday Campaigning" and rows[0]["starts"] == "15:00" and rows[1]["starts"] == "19:30" and rows[2]["starts"] == "00:00"
    assert rows[3]["date"] == "2026-11-21" and rows[0]["url"].startswith("https://events.libdems.org.uk/events/")


# ------------------------------------------------------------------ the UK Parliament What's On calendar for the Daily Plan (London Politics > Political Events)
def test_whatson_event_rows():
    today = date(2026, 11, 16)
    ev = lambda i, d, **k: {"Id": str(i), "StartDate": f"{d}T00:00:00", "StartTime": "14:30", "House": "Commons", "Type": "Main Chamber", "Category": "Oral questions", "Description": None, "Committee": None, "CancelledDate": None, **k}  # noqa: E731
    rows = U.whatson_event_rows([
        ev(1, "2026-11-17", Description="Oral questions"),
        ev(2, "2026-11-17", House="Lords", Type="Select & Joint Committees", Category="Oral evidence", Committee={"Description": "Home Affairs Committee"}, StartTime="09:15"),
        ev(3, "2026-11-17", Category="Private Meeting", Type="Select & Joint Committees", Committee={"Description": "Procedure Committee"}),
        ev(4, "2026-11-18", CancelledDate="2026-11-10T00:00:00"),
        ev(5, "2026-11-10"), ev(6, "2027-03-01"), {"StartDate": "2026-11-18T00:00:00"}], today)
    assert [r["key"] for r in rows] == ["whatson:2", "whatson:1"]
    assert rows[0]["title"] == "Lords Committee: Home Affairs Committee (Oral evidence)" and rows[0]["starts"] == "09:15" and rows[0]["url"] == "https://whatson.parliament.uk/event/cal2"
    assert rows[1]["title"] == "Commons Chamber: Oral questions"


# ------------------------------------------------------------------ LUCIEN's permanent archive
class _Resp:
    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d


def test_committee_history_reads_year_by_year_newest_first(monkeypatch):
    calls = []

    def fake_get(url, **kw):
        if url.endswith("/PublicationType"):
            return _Resp([{"id": 1, "name": "Report"}, {"id": 2, "name": "Correspondence"}, {"id": 4, "name": "Government Response"}, {"id": 6, "name": "Special Report"}])
        p = kw["params"]
        calls.append((p["StartDate"][:4], p["PublicationTypeIds"], p["Skip"]))
        yr = p["StartDate"][:4]
        n = 100 if (yr == "2025" and p["Skip"] == 0) else 3
        return _Resp({"items": [{"id": int(yr) * 1000 + p["Skip"] + i, "type": {"name": "Report"}, "committee": {"name": "Health Committee", "house": "Commons"},
                                 "description": f"Report {yr}-{i}", "publicationStartDate": f"{yr}-03-01T10:00:00"} for i in range(n)]})
    monkeypatch.setattr(U, "get", fake_get)
    items = U.collect_committee_history(2025, first_year=2024)
    assert [c[0] for c in calls] == ["2025", "2025", "2024"] and calls[0][1] == [1, 4, 6]   # the year with a full page is read again; Correspondence is not asked for
    assert len(items) == 100 + 3 + 3 and items[0]["category"] == "committee" and items[0]["source"] == "Health Committee"
    monkeypatch.setattr(U, "HISTORY_BUDGET_S", -1)   # out of time: nothing is read, and the next run carries on
    assert U.collect_committee_history(2025, first_year=2024) == []


def test_archive_history_start(monkeypatch):
    monkeypatch.setattr(U, "ingest_configured", lambda: True)
    monkeypatch.delenv("ARCHIVE_HISTORY", raising=False)
    for oldest, want in ((None, U.NOW.year), ("2019-05-02T00:00:00+00:00", 2019), ("2010-01-01T00:00:00+00:00", 2010), ("1995-03-01T00:00:00+00:00", None)):
        monkeypatch.setattr(U, "_ingest", lambda payload, timeout=90, o=oldest: {"ok": True, "committees": 5, "oldest_committee": o})
        assert U.archive_history_start() == want
    monkeypatch.setenv("ARCHIVE_HISTORY", "1")
    assert U.archive_history_start() == U.NOW.year
    monkeypatch.delenv("ARCHIVE_HISTORY")
    monkeypatch.setattr(U, "ingest_configured", lambda: False)
    assert U.archive_history_start() is None


def test_upload_archive_sends_everything_in_chunks(monkeypatch):
    sent = []
    monkeypatch.setattr(U, "ingest_configured", lambda: True)
    monkeypatch.setattr(U, "_ingest", lambda payload, timeout=90: sent.append(payload) or {"ok": True, "stored": len(payload["rows"])})
    assert U.upload_archive([{"id": str(i)} for i in range(1200)]) is True
    assert [len(p["rows"]) for p in sent] == [500, 500, 200] and all(p["action"] == "archive" for p in sent)
    assert U.upload_archive([]) is True


# ------------------------------------------------------------------ economic data (Nomis) for LUCIEN > Economic policy
def test_econdata_age_bands_and_sexes():
    import econdata as E
    assert E.parse_age("Age 16 to 24") == (16, 24, "16-24")
    assert E.parse_age("Aged 18-24") == (18, 24, "18-24")
    assert E.parse_age("Aged 65 years and over") == (65, 120, "65+")
    assert E.parse_age("Aged 15 years and under") == (0, 15, "0-15")
    assert E.parse_age("All categories: Age 16+") == (16, 120, "16+")
    assert E.parse_age("All ages") == (0, 120, "All ages") and E.parse_age("Total") == (0, 120, "All ages")
    assert E.sex_of("All persons") == "all" and E.sex_of("Males") == "male" and E.sex_of("Female") == "female"
    assert E.level_of("K02000001", "United Kingdom") == "uk" and E.level_of("E92000001", "England") == "country" and E.level_of("E12000007", "London") == "region"


def test_econdata_rows_from_nomis_csv():
    import econdata as E
    csv_text = ('"DATE_NAME","GEOGRAPHY_NAME","GEOGRAPHY_CODE","C_SEX_NAME","C_AGE_NAME","C_AGE","C_ECOPUK11_NAME","MEASURE_NAME","OBS_VALUE","OBS_STATUS_NAME"\n'
                '"Jul 2025-Jun 2026","London","E12000007","Females","Age 16 to 24","22","Employed","Count",512300,"Normal Value"\n'
                '"Jul 2025-Jun 2026","London","E12000007","Females","Age 16 to 24","22","Unemployed","Count",,"Normal Value"\n')

    class R:
        text = csv_text
        encoding = None
    seen = []
    rows = E.aps_labour(lambda url, **kw: seen.append(url) or R())
    assert len(rows) == 1 and rows[0]["sex"] == "female" and rows[0]["age_label"] == "16-24" and rows[0]["category"] == "Employed" and rows[0]["value"] == 512300.0
    assert rows[0]["geography_level"] == "region" and rows[0]["period"] == "Jul 2025-Jun 2026" and rows[0]["dataset"] == "aps_labour" and len(rows[0]["id"]) == 20
    assert "NM_170_1.data.csv" in seen[0] and "measure=1" in seen[0]


def test_econdata_one_failing_dataset_does_not_stop_the_rest():
    import econdata as E
    log = []

    class R:
        text = '"DATE_NAME","GEOGRAPHY_NAME","GEOGRAPHY_CODE","MEASURE_NAME","OBS_VALUE"\n"2024","North East","E12000001","GDHI per head (£)",20562\n'
        encoding = None

    def fetch(url, **kw):
        if "NM_185_1" in url:
            return R()
        raise RuntimeError("boom")
    rows = E.collect(fetch, lambda name, ok, n, err: log.append((name, ok, n)))
    assert [r["dataset"] for r in rows] == ["gdhi"] and rows[0]["unit"] == "£"
    assert ("gdhi", True, 1) in log and ("aps_labour", False, 0) in log


def test_nomis_api_is_the_one_robots_exception():
    assert U.allowed("https://www.nomisweb.co.uk/api/v01/dataset/NM_170_1.data.csv?x=1") is True
    assert any(e["prefix"].startswith("https://www.nomisweb.co.uk/api/") for e in U.CONFIG["robots_exceptions"]) and len(U.CONFIG["robots_exceptions"]) == 1


def test_ons_series_points_and_rows():
    import econdata as E
    assert E.point_key({"date": "2026 SEP"}) == "2026-09" and E.point_key({"date": "2026 Q2"}) == "2026-Q2" and E.point_key({"date": "2026"}) is None
    pts = [{"date": f"2026 {m}", "value": str(i + 1.5), "label": f"2026 {m}"} for i, m in enumerate(["JAN", "FEB", "MAR"])] + [{"date": "2025 DEC", "value": "bad"}, {"date": "2026", "value": "1"}]

    class R:
        def json(self):
            return {"months": pts, "quarters": [], "years": []}
    seen = []
    rows = E.ons_series(lambda url, **kw: seen.append(url) or R())
    first = [r for r in rows if r["category"] == E.ONS_SERIES[0][0]]
    assert [r["period"] for r in first] == ["2026-01", "2026-02", "2026-03"] and first[-1]["value"] == 3.5 and first[0]["unit"] == "%" and first[0]["geography_level"] == "uk"
    assert first[0]["source_url"] == "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23" and first[0]["label"] == "2026 JAN" and seen[0].endswith("/d7g7/mm23/data")
    assert len({r["id"] for r in rows}) == len(rows)


# ------------------------------------------------------------------ working links for select committee reports, and polling kept whether or not it is political
def test_committee_link_opens_the_publication():
    row = {"id": 55848, "documents": [{"documentId": 314690}], "committee": {"id": 127}, "additionalContentUrl": None}
    assert U.committee_link(row) == "https://committees.parliament.uk/publications/55848/documents/314690/default/"
    lords = {"id": 55828, "documents": [], "committee": {"id": 9}, "additionalContentUrl": "https://publications.parliament.uk/pa/ld5902/ldselect/ldresilience/79/7902.htm"}
    assert U.committee_link(lords) == "https://publications.parliament.uk/pa/ld5902/ldselect/ldresilience/79/7902.htm"
    bare = {"id": 1, "documents": [], "committee": {"id": 127}, "additionalContentUrl": "http://evil.example/x"}
    assert U.committee_link(bare) == "https://committees.parliament.uk/committee/127/"
    full = {"id": 55848, "type": {"name": "Report"}, "description": "A report", "publicationStartDate": "2026-11-16T10:00:00", "documents": [{"documentId": 7}], "committee": {"id": 3, "name": "Health Committee", "house": "Commons"}}
    it = U._committee_row(full, ["report"])
    assert it["url"].endswith("/publications/55848/documents/7/default/") and it["id"] == U.make_item("committee", "x", "x", "https://committees.parliament.uk/publications/55848/", None)["id"]


def test_archive_history_start_rereads_broken_links(monkeypatch):
    monkeypatch.setattr(U, "ingest_configured", lambda: True)
    monkeypatch.delenv("ARCHIVE_HISTORY", raising=False)
    monkeypatch.setattr(U, "_ingest", lambda payload, timeout=90: {"ok": True, "committees": 11000, "oldest_committee": "1995-03-01T00:00:00+00:00", "stale_links": 9000, "newest_stale": "2024-05-01T00:00:00+00:00"})
    assert U.archive_history_start() == 2024
    monkeypatch.setattr(U, "_ingest", lambda payload, timeout=90: {"ok": True, "committees": 11000, "oldest_committee": "1995-03-01T00:00:00+00:00", "stale_links": 0, "newest_stale": None})
    assert U.archive_history_start() is None


# ------------------------------------------------------------------ think tanks that block automated visitors: RePEc and OpenAlex
_REPEC_HTML = '''<div id="content"><h2>Content</H2><h3>2026</h3><div class="panel-body"><UL class="list-group paperlist">
<LI class="list-group-item downfree"><B>W46/46 <A HREF="/p/ifs/ifsewp/46-46.html">Horizontal equity of taxation</A></B><BR><I>by</I> A & B
<LI class="list-group-item downfree"><B>W28/45 <A HREF="/p/ifs/ifsewp/28-45.html">Smartphones and children's mental health</A></B></UL></div>
<h3>2025</h3><UL class="list-group paperlist"><LI class="list-group-item"><B>W25/1 <A HREF="/p/ifs/ifsewp/25-01.html">An older paper</A></B></UL></div>'''


class _Resp2:
    def __init__(self, text="", data=None):
        self.text, self._d = text, data

    def json(self):
        return self._d


def test_repec_series_items(monkeypatch):
    monkeypatch.setattr(U, "get", lambda url, **kw: _Resp2(_REPEC_HTML))
    rows = U.repec_series_items("Institute for Fiscal Studies", "ifs/ifsewp", limit=3)
    assert [r["title"] for r in rows] == ["Horizontal equity of taxation", "Smartphones and children's mental health", "An older paper"]
    assert rows[0]["url"] == "https://ideas.repec.org/p/ifs/ifsewp/46-46.html" and rows[0]["tags"] == ["RePEc", "2026"] and rows[2]["tags"] == ["RePEc", "2025"] and rows[0]["published"] is None


def test_openalex_items(monkeypatch):
    calls = []

    def fake(url, **kw):
        calls.append((url, kw.get("params"), kw.get("headers")))
        if url.endswith("/institutions"):
            return _Resp2(data={"results": [{"id": "https://openalex.org/I1", "display_name": "Fiscal Studies Group"}, {"id": "https://openalex.org/I2", "display_name": "Institute for Fiscal Studies"}]})
        return _Resp2(data={"results": [{"display_name": "A report", "publication_date": "2026-10-01", "primary_location": {"landing_page_url": "https://ifs.org.uk/a"}, "doi": None},
                                        {"display_name": "Only a DOI", "publication_date": "2026-09-01", "primary_location": {}, "doi": "https://doi.org/10.1/x"}, {"display_name": "No link", "primary_location": {}}]})
    monkeypatch.setattr(U, "get", fake)
    rows = U.openalex_items("Institute for Fiscal Studies", "Institute for Fiscal Studies", "KEY")
    assert [r["title"] for r in rows] == ["A report", "Only a DOI"] and rows[0]["published"].startswith("2026-10-01") and rows[1]["url"] == "https://doi.org/10.1/x"
    assert "institutions.id:I2" in calls[1][1]["filter"] and calls[0][2]["Authorization"] == "Bearer KEY"
    monkeypatch.setattr(U, "get", lambda url, **kw: _Resp2(data={"results": []}))
    try:
        U.openalex_items("X", "No Such Place", "KEY")
        assert False
    except LookupError:
        pass


def test_blocked_think_tank_falls_back_to_the_indexes(monkeypatch):
    blocked = ([], {"group": "thinktanks", "name": "IFS", "ok": False, "items": 0, "error": "ifs.org.uk/publications: HTTP 403 (Cloudflare challenge)"})
    monkeypatch.setattr(U, "collect_source", lambda tt, c, g: blocked)
    monkeypatch.setattr(U, "get", lambda url, **kw: _Resp2(_REPEC_HTML))
    monkeypatch.delenv("OPENALEX_API_KEY", raising=False)
    items, rec = U.collect_thinktank({"name": "IFS", "repec": ["ifs/ifsewp"], "openalex": "Institute for Fiscal Studies"})
    assert rec["ok"] and rec["method"] == "repec/openalex" and len(items) == 3 and "scholarly indexes" in rec["error"] and "OPENALEX_API_KEY" in rec["error"]
    items, rec = U.collect_thinktank({"name": "SMF", "openalex": "Social Market Foundation"})
    assert not rec["ok"] and items == [] and "OPENALEX_API_KEY" in rec["error"]
    items, rec = U.collect_thinktank({"name": "Other"})
    assert not rec["ok"]


# ------------------------------------------------------------------ LOVELACE: Parliamentary Activity sections and London Politics (policy reports, London media)
def test_whatson_events_go_to_parliamentary_sections():
    today = date(2026, 11, 16)
    ev = lambda i, house, typ, **k: {"Id": str(i), "StartDate": "2026-11-17T00:00:00", "StartTime": "10:00", "House": house, "Type": typ, "Category": "Debate", "Description": f"Item {i}", "Committee": None, "CancelledDate": None, **k}  # noqa: E731
    rows = U.whatson_event_rows([ev(1, "Commons", "Main Chamber"), ev(2, "Commons", "Westminster Hall"), ev(3, "Lords", "Main Chamber"), ev(4, "Lords", "Grand Committee"),
                                 ev(5, "Commons", "Select & Joint Committees", Committee={"Description": "Health Committee"}), ev(6, "Lords", "Select & Joint Committees", Committee={"Description": "Lords committee"}),
                                 ev(7, "Commons", "General Committee"), ev(8, "Joint", "Select & Joint Committees", Committee={"Description": "Joint committee"})], today)
    assert {r["key"]: r["section"] for r in rows} == {"whatson:1": "commons", "whatson:2": "commons", "whatson:3": "lords", "whatson:4": "lords", "whatson:5": "committees", "whatson:6": "committees", "whatson:7": "committees", "whatson:8": "committees"}


def test_collect_london_keeps_london_politics_only(monkeypatch):
    mk = lambda src, title, cat: {"id": U.make_item(cat, src, title, f"https://x.example/{title}", None)["id"], "category": cat, "source": src, "title": title, "url": f"https://x.example/{title}", "published": None, "summary": "", "tags": []}  # noqa: E731

    def fake_source(tt, cat, group):
        rows = {"Centre for London": [mk("Centre for London", "Housing in the capital", "thinktank")], "Mayor of London and the GLA": [mk("GLA", "New report on air quality", "thinktank"), mk("GLA", "Road closure today", "thinktank")],
                "MyLondon": [mk("MyLondon", "Mayor of London announces fares freeze", "media"), mk("MyLondon", "Football results", "media")]}
        return rows.get(tt["name"], []), {"group": group, "name": tt["name"], "ok": bool(rows.get(tt["name"])), "items": 0, "error": ""}
    monkeypatch.setattr(U, "collect_source", fake_source)
    monkeypatch.setitem(U.CONFIG, "london", {"reports": [{"name": "Centre for London"}, {"name": "Mayor of London and the GLA", "require": "report"}], "media_pattern": "Mayor of London|TfL", "media": [{"name": "MyLondon"}]})
    national = [{"id": "n1", "category": "thinktank", "source": "IPPR", "title": "A plan for London's economy", "url": "https://x.example/n1", "geo": ["London"], "tags": []},
                {"id": "n2", "category": "thinktank", "source": "IPPR", "title": "Pensions reform", "url": "https://x.example/n2", "geo": ["UK-wide"], "tags": []}]
    rows = U.collect_london(national)
    by_kind = {k: sorted(r["title"] for r in rows if r["kind"] == k) for k in ("report", "media")}
    assert by_kind["report"] == ["A plan for London's economy", "Housing in the capital", "New report on air quality"]
    assert by_kind["media"] == ["Mayor of London announces fares freeze"]
    assert all(r["url"].startswith("https://") and r["first_seen"] for r in rows)
