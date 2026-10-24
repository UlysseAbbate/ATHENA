"""
Build the Lib Dem policy library in Supabase from:
  - Conference motions: https://www.libdems.org.uk/conference/motions/
  - Policy papers:      https://www.libdems.org.uk/members/make-policy#policy-papers

Stores the text only (no PDFs), split into searchable chunks, each document tagged with
one or more portfolios. Unchanged documents are skipped on later runs.

Run by .github/workflows/ingest-policy.yml weekly, or by hand:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [ANTHROPIC_API_KEY=...] python scripts/ingest_policy.py
Options:  --limit 20   only process 20 documents      --refresh   re-process everything
          --dry-run    crawl and print, no database
          --retag      only give a portfolio to stored documents that have none (no crawling)
"""

import hashlib
import io
import json
import os
import re
import sys
from collections import deque
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

from common import (CATCH_ALL, PORTFOLIO_CODES, http_get, keyword_portfolios, require_env,
                    sb_delete, sb_insert, sb_select, sb_update)

MOTIONS_INDEX = "https://www.libdems.org.uk/conference/motions/"
POLICY_PAGE = "https://www.libdems.org.uk/members/make-policy"
MAX_PAGES = 1500
CHUNK_CHARS = 1200

CONF_RE = re.compile(r"\b(spring|autumn)\b[\s\-_]*(?:conference[\s\-_]*)?(20\d\d)", re.I)
STATUS_RE = re.compile(r"\b(passed as amended|passed with amendments|passed|carried|defeated|rejected|referred back|not debated|withdrawn)\b", re.I)
BOILERPLATE = re.compile(r"(this website uses cookies|please select the types of cookies|necessary for the website|register for conference|join us next time|promoted by|share this)", re.I)


# ------------------------------------------------------------------ text helpers

def clean_html_text(html):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript", "svg"]):
        tag.decompose()
    title = (soup.find("h1").get_text(" ", strip=True) if soup.find("h1")
             else (soup.title.get_text(strip=True) if soup.title else ""))
    main = soup.find("main") or soup.find("article") or soup.body or soup
    lines = [re.sub(r"\s+", " ", l).strip() for l in main.get_text("\n").split("\n")]
    lines = [l for l in lines if l and not BOILERPLATE.search(l)]
    return title.strip(), "\n".join(lines), soup


def conference_of(*texts):
    for t in texts:
        m = CONF_RE.search(t or "")
        if m:
            season, year = m.group(1).title(), m.group(2)
            return f"{season} {year}", f"{year}-{'03-15' if season == 'Spring' else '09-20'}"
    return None, None


def status_of(text):
    m = STATUS_RE.search(text[:600])
    return m.group(1).capitalize() if m else None


def chunks_of(text):
    paras = [p.strip() for p in re.split(r"\n+", text) if len(p.strip()) > 2]
    out, buf = [], ""
    for p in paras:
        if len(buf) + len(p) > CHUNK_CHARS and buf:
            out.append(buf.strip())
            buf = ""
        buf += p + "\n"
    if buf.strip():
        out.append(buf.strip())
    return out


# ------------------------------------------------------------------ portfolio tagging

def readable_words(text):
    """How many real words the text has: a scanned PDF often extracts as blanks or /g12/g7 codes."""
    return len(re.findall(r"[A-Za-z]{3,}", text))


def classify(title, text):
    """1-3 portfolio codes, most relevant first. Never empty: a document that fits nothing gets the catch-all (CO),
    and if the text is unreadable the title alone decides."""
    sample = text[:3500]
    unreadable = readable_words(sample) < 40
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        try:
            res = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={
                    "model": os.environ.get("CLAUDE_CLASSIFY_MODEL", "claude-haiku-4-5-20251001"),
                    "max_tokens": 100,
                    "system": ("You tag Liberal Democrat policy documents with UK government portfolio codes. "
                               f"Allowed codes: {', '.join(PORTFOLIO_CODES)}. "
                               "CO=Cabinet Office/constitution, DBT=business & trade, DCMS=culture/media/sport/civil society, "
                               "DEFRA=environment/food/rural/water, DESNZ=energy/climate, DFE=education, DFT=transport, "
                               "DHSC=health & social care, DSIT=science/tech/online, FCDO=foreign affairs/development, "
                               "DWP=welfare/pensions, HMT=economy/tax, HO=home affairs/policing/immigration, "
                               "MHCLG=housing/local government, MOD=defence, MOJ=justice, NIWS=Northern Ireland/Wales/Scotland. "
                               f"Every document must get at least one code: if it covers many areas or fits none, use {CATCH_ALL}. "
                               "If the text is missing or unreadable, judge from the title. "
                               "Reply with a JSON array of 1-3 codes, most relevant first, nothing else."),
                    "messages": [{"role": "user", "content": f"Title: {title}\n\n" + ("(the text could not be read)" if unreadable else sample)}],
                },
                timeout=60,
            )
            res.raise_for_status()
            reply = "".join(b.get("text", "") for b in res.json().get("content", []))
            codes = [c for c in json.loads(reply[reply.index("["): reply.rindex("]") + 1]) if c in PORTFOLIO_CODES]
            if codes:
                return codes[:3]
        except Exception as exc:  # fall back to keywords
            print(f"  ! Claude tagging failed ({exc}); using keywords")
    return keyword_portfolios("" if unreadable else text[:6000], title=title)


def retag_untagged():
    """Give a portfolio to every stored document that has none, using the stored text (no crawling)."""
    rows = sb_select("policy_documents", "select=id,title,full_text&or=(portfolios.is.null,portfolios.eq.{})")
    for r in rows:
        codes = classify(r["title"], r.get("full_text") or "")
        sb_update("policy_documents", f"id=eq.{r['id']}", {"portfolios": codes})
        print(f"  tagged: {r['title'][:70]} -> {', '.join(codes)}")
    print(f"Done. Tagged {len(rows)} document(s) that had no portfolio.")


# ------------------------------------------------------------------ crawling

def same_site_path(url):
    p = urlparse(url)
    return p.netloc.endswith("libdems.org.uk"), p.path.rstrip("/")


def crawl_motions(limit):
    """Breadth-first crawl under /conference/motions/. Returns list of documents."""
    base_path = urlparse(MOTIONS_INDEX).path.rstrip("/")
    queue, seen, docs = deque([MOTIONS_INDEX]), set(), []
    while queue and len(seen) < MAX_PAGES and (not limit or len(docs) < limit):
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        html = http_get(url)
        if not html:
            continue
        title, text, soup = clean_html_text(html)
        path = urlparse(url).path.rstrip("/")
        depth = len([s for s in path[len(base_path):].split("/") if s])

        children = []
        for a in soup.find_all("a", href=True):
            link = urldefrag(urljoin(url, a["href"]))[0]
            ok, lp = same_site_path(link)
            if ok and lp.startswith(base_path + "/") and link not in seen and lp != path:
                children.append(link)
        deeper = [c for c in children if len([s for s in urlparse(c).path.rstrip("/")[len(base_path):].split("/") if s]) > depth]
        queue.extend(deeper)

        conference, approx = conference_of(path, title, text[:500])
        if depth >= 2 and len(text) > 400:
            docs.append(make_doc(url, title, text, "motion", conference, approx))
        elif depth == 1 and not deeper and len(text) > 2000:
            # A conference page that lists every motion inline: split on headings.
            docs.extend(split_inline_motions(url, soup, conference, approx))
        print(f"  crawled {url} (depth {depth}, {len(deeper)} links)")
    return docs


def split_inline_motions(url, soup, conference, approx):
    docs = []
    main = soup.find("main") or soup.body or soup
    for h in main.find_all(["h2", "h3"]):
        title = h.get_text(" ", strip=True)
        parts = []
        for sib in h.find_next_siblings():
            if sib.name in ("h2", "h3"):
                break
            parts.append(sib.get_text("\n", strip=True))
        body = "\n".join(p for p in parts if p)
        if len(body) > 300:
            anchor = h.get("id") or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            docs.append(make_doc(f"{url}#{anchor}", title, body, "motion", conference, approx))
    return docs


def crawl_policy_papers(limit):
    html = http_get(POLICY_PAGE)
    if not html:
        print("  ! Policy papers page unavailable (it may require a members' login) — skipping.")
        return []
    soup = BeautifulSoup(html, "html.parser")
    docs = []
    for a in soup.find_all("a", href=True):
        if limit and len(docs) >= limit:
            break
        link = urljoin(POLICY_PAGE, a["href"])
        label = a.get_text(" ", strip=True)
        if not re.search(r"\.pdf($|\?)", link, re.I) and "policy-paper" not in link.lower():
            continue
        if any(d["source_url"] == link for d in docs):
            continue
        if re.search(r"\.pdf($|\?)", link, re.I):
            data = http_get(link, binary=True)
            if not data:
                continue
            try:
                reader = PdfReader(io.BytesIO(data))
                text = "\n".join((p.extract_text() or "") for p in reader.pages)
                meta_title = (reader.metadata.title if reader.metadata else None) or ""
            except Exception as exc:
                print(f"  ! Could not read {link}: {exc}")
                continue
            title = label if len(label) > 6 and label.lower() not in ("download", "read more", "pdf") else meta_title or link.rsplit("/", 1)[-1]
        else:
            page = http_get(link)
            if not page:
                continue
            title, text, _ = clean_html_text(page)
        conference, approx = conference_of(title, text[:3000])
        docs.append(make_doc(link, title, text, "policy_paper", conference, approx))
        print(f"  policy paper: {title[:80]}")
    return docs


def make_doc(url, title, text, doc_type, conference, approx):
    return {
        "source_url": url,
        "title": title[:300] or url,
        "doc_type": doc_type,
        "conference": conference,
        "date_label": conference,
        "date_passed": approx,
        "status": status_of(text) if doc_type == "motion" else None,
        "full_text": text,
        "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }


# ------------------------------------------------------------------ main

def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    refresh = "--refresh" in args
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else 0
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    if "--retag" in args:
        retag_untagged()
        return

    print("Crawling conference motions…")
    docs = crawl_motions(limit)
    print("Crawling policy papers…")
    docs += crawl_policy_papers(limit)
    print(f"Found {len(docs)} documents.")

    if dry:
        for d in docs[:50]:
            print(f"- [{d['doc_type']}] {d['date_label'] or 'undated'} | {d['title'][:90]} | {len(d['full_text'])} chars")
        return

    existing = {r["source_url"]: r["content_hash"] for r in sb_select("policy_documents", "select=source_url,content_hash")}
    stored = skipped = 0
    for d in docs:
        if not refresh and existing.get(d["source_url"]) == d["content_hash"]:
            skipped += 1
            continue
        d["portfolios"] = classify(d["title"], d["full_text"]) or [CATCH_ALL]
        row = sb_insert("policy_documents", [d], upsert_on="source_url", returning=True)[0]
        sb_delete("policy_chunks", f"document_id=eq.{row['id']}")
        sb_insert("policy_chunks", [{"document_id": row["id"], "chunk_index": i, "content": c}
                                    for i, c in enumerate(chunks_of(d["full_text"]))])
        stored += 1
        print(f"  stored: {d['title'][:70]} → {', '.join(d['portfolios'])}")
    print(f"Done. Stored {stored}, unchanged {skipped}.")


if __name__ == "__main__":
    main()
