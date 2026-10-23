# Policy Tracker

A static site, refreshed every three hours by GitHub Actions, that tracks:

1. **Select committees**: new reports, government responses and special reports from all Commons and Lords committees (Parliament Committees API).
2. **Think tanks**: new outputs from the ~64 organisations in `config/sources.yml`. For each one the collector tries, in order: an explicit `feed:` URL, RSS/Atom autodiscovery and common feed paths, then a generic scrape of the publications page.
3. **Lib Dems in the media**: Telegraph, Times, Guardian, Politico, FT, Economist and others, via per-outlet Google News RSS searches (keywords are in the config).
4. **Polling**: a voting-intention chart and table (from the Wikipedia table of BPC-member polls) plus new write-ups and trackers from BPC member firms, tagged *voting-intention*, *party-support* or *news-cycle*.

"NEW" means first seen in the last 48 hours (and not an old backlog item). `site/data/feed.json` is committed back to the repo each run, which is how first-seen times persist.

## Setup

1. Create a GitHub repo and push this folder to `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *Update tracker and deploy* → Run workflow.
4. Open the site and check the **Source health** tab. Think-tank and poll-firm URLs were written from memory and not verified, so expect some to need a corrected URL or a `feed:` override in `config/sources.yml`.

Run locally:

```bash
pip install -r requirements.txt
python tracker/update.py            # everything
python tracker/update.py media      # one group: committees | thinktanks | media | polling
cd site && python -m http.server    # then open http://localhost:8000
```

## Known limitations

- The Parliament Committees API field names are read defensively but were not checked against a live response; if "Parliament Committees API" fails in the health tab, inspect `https://committees-api.parliament.uk/api/Publications` and adjust `_committee_row`.
- Google News RSS returns headlines and links, not article text, and coverage of paywalled outlets is headline-only.
- HTML-scrape fallbacks are heuristic and can pick up non-publication links; add a `feed:` where one exists.
- Wikipedia's table layout changes occasionally; the VI chart degrades to empty rather than failing the run.
- If any site's terms forbid automated access, remove it from the config.

## Next steps

The "London" site can reuse `tracker/update.py` and the front end: add a new `london` config block (London media outlets, GLA and borough sources) and a tab.
