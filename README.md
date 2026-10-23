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
4. Open the site and check the **Source health** tab. Committees, media and polling were verified against live responses on 2026-10-23. Only ~14 of the 63 think tank entries were verified live (the verification sandbox could not reach the rest), so expect some to need a corrected URL or a `feed:` override in `config/sources.yml` (`feed: false` forces the HTML scrape instead of feed autodiscovery).

Run locally:

```bash
pip install -r requirements.txt
python tracker/update.py            # everything
python tracker/update.py media      # one group: committees | thinktanks | media | polling
cd site && python -m http.server    # then open http://localhost:8000
```

## Known limitations

- Committees: only Report, Special Report and Government Response publications are kept (`keep_types`). Correspondence was ~70% of the API's volume, add `"correspondence"` to include it. Committee links point at `committees.parliament.uk/publications/<id>/` (the site's standard pattern; not fetched during verification).
- Media: Google News RSS matches keywords anywhere in an article, so results are filtered to headlines matching `media.title_pattern`. Only headlines and Google redirect links are available (no article text), and a quiet outlet shows as "quiet" in Source health, not as a failure. Daily Mail, Spectator and Reuters returned nothing from Google News.
- Polling: the Wikipedia parser assumes the first table is the current year (the table gives no year in its date column), keeps GB/UK rows only and tags MRPs (excluded from the chart). Several smaller firms (Techne, BMG, JL Partners, Deltapoll, Verian, Whitestone, Merlin, Stonehaven) are only sparsely indexed by Google News. YouGov News Trackers are collected from the YouGov articles page plus the earlier editions linked from the newest one.
- Bright Blue and the IFS return HTTP 403 to all automated requests (including robots.txt); they are left in the config and will show as failing.
- HTML-scrape fallbacks are heuristic; add a `feed:` where one exists.
- If any site's terms forbid automated access, remove it from the config.

## Next steps

The "London" site can reuse `tracker/update.py` and the front end: add a new `london` config block (London media outlets, GLA and borough sources) and a tab.
