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
def test_london_data_rows_take_only_london_data_drops():
    today = date(2026, 11, 16)
    body = {"releases": [
        {"id": "lds:1", "tier": "london", "source_system": "london_datastore", "kind": "published", "date": "2026-11-14", "publisher": "GLA", "title": "Housing data", "url": "https://data.london.gov.uk/dataset/h"},
        {"id": "est:lds:1", "tier": "london", "source_system": "london_datastore", "kind": "upcoming", "date": "2026-12-01", "date_status": "estimated", "publisher": "GLA", "title": "Housing data (next update, estimated)", "url": "https://x"},
        {"id": "m:1", "tier": "london", "source_system": "manual", "kind": "upcoming", "date": "2026-11-20", "date_precision": "time", "datetime": "2026-11-20T09:30:00+00:00", "publisher": "GLA", "title": "Budget data", "url": ""},
        {"id": "ons:1", "tier": "national", "source_system": "ons_api", "kind": "upcoming", "date": "2026-11-20", "publisher": "ONS", "title": "National"},
        {"id": "pol", "tier": "london", "source_system": "police_uk", "kind": "upcoming", "date": "2026-11-20", "publisher": "police", "title": "Crime"},
        {"id": "mtg", "tier": "london", "source_system": "gla_meetings", "kind": "upcoming", "date": "2026-11-20", "publisher": "GLA", "title": "Assembly meeting"},
        {"id": "old", "tier": "london", "source_system": "london_datastore", "kind": "published", "date": "2026-09-01", "publisher": "GLA", "title": "Too old"},
        {"id": "gone", "tier": "london", "source_system": "manual", "kind": "upcoming", "cancelled": True, "date": "2026-11-21", "publisher": "GLA", "title": "Cancelled"}]}
    rows = U.london_data_rows(body, today)
    assert [r["key"] for r in rows] == ["statscal:lds:1:2026-11-14", "statscal:est:lds:1:2026-12-01", "statscal:m:1:2026-11-20"]
    assert rows[0]["title"] == "GLA: Housing data (published)" and "date not yet confirmed" in rows[1]["title"] and rows[2]["starts"] == "09:30"


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
