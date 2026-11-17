# Source health: why some LUCIEN sources return nothing, and what can be done

LUCIEN's collector (`tracker/update.py`) is deliberately polite: it checks each site's `robots.txt`, spaces its requests, identifies itself honestly, and does nothing to get past a block (no disguised browsers, no challenge solving). It already tries, in order, a site's feeds, its pages (links, embedded data, the WordPress API), its sitemap and alternate pages. When a source still returns nothing, **Source health** says why. At the last count 28 of 130 sources failed, in six groups. What to do about each follows; "researched" marks points confirmed by an online search on 17 November 2026, the rest are suggestions to test.

## 1. The site's robots.txt refuses bots (City AM, Reuters, The Times, Lib Dem Voice, Commons Library)
Respected, and not worked around.
- **Reuters:** its public RSS feeds were switched off (the old `feeds.reuters.com` stopped updating in June 2020; researched). Google News search feeds are the usual workaround others use, but Google's own robots.txt forbids bots, which is why LUCIEN does not use them.
- **Commons Library:** Parliament publishes a machine-readable feed of Library briefings at `api.parliament.uk/library-feeds/publications` (researched: it exists, with date, author, publisher and a link to each briefing; its terms were not checked). That is an official route that does not touch the refused site. It needs `api.parliament.uk` to be reachable (it is on GitHub's runners; it is not in this session's allowed list).
- **Newspapers (City AM, The Times, Lib Dem Voice):** ask the publisher for a feed or for permission; or take their press-office or newsletter emails (see "email route" below). A free news-metadata service such as GDELT (searchable by site and keyword, no key) could cover headlines without reading the sites: to be tested, not confirmed.

## 2. A Cloudflare challenge answers with 403 or 401 (IFS, Social Market Foundation, The King's Fund, Chatham House, Bath IPR, The Jobs Foundation)
These sites ask unknown automated visitors to prove they are people.
- Cloudflare has a **verified bots** programme (researched): the bot's owner applies, publishes how the bot behaves, and is verified by IP ranges or signed requests. GitHub's runners share IP addresses, so LUCIEN is unlikely to qualify.
- **Ask the organisation.** A short email to the web or communications team from the owner ("we read your public publications list twice a day, politely, as `PolicyTracker/1.0`: could you allow it, or point us to a feed?") is the straightforward fix, and costs nothing.
- **Scholarly metadata, not the site:** several of these publish reports with DOIs or list them on scholarly indexes. **OpenAlex** is free, needs no key and has a "polite" mode with an email address (researched); it can list works by institution. **RePEc/IDEAS** lists the King's Fund's papers (researched: `ideas.repec.org/d/kngsfuk.html`). Neither is as complete as the organisation's own page, and a report without a DOI will be missed.
- **Email route:** every one of these organisations has a newsletter. A dedicated mailbox that LUCIEN reads (titles and links from each email) works for all of them, bypasses the web block, and is the same thing a person subscribing would see. This needs building and a mailbox.

## 3. The page comes back empty (a bot check): BMG, Deltapoll, Electoral Calculus, Good Growth Foundation, Redfield & Wilton, Trajectory Partnership, Bright Blue, NCUB, Re:State
Usually a web application firewall or a JavaScript check in front of the site; LUCIEN stops there by design.
- Same first step: **ask for an allow-list or a feed**. For the polling firms the British Polling Council's member list shows who to contact.
- Most pollsters also post each new poll on social media. LUCIEN already reads BlueSky accounts openly (the Social Media Channels Tracker does it for LOVELACE); adding the pollsters' accounts, and showing them in LUCIEN's Polling tab, is a legitimate route that needs no access to their sites.
- Their tables are filed with the British Polling Council and quoted by Wikipedia; LUCIEN does not collect Wikipedia's generic tables, by decision.

## 4. The page loads but lists no links: Merlin Strategy, Norstat, Stonehaven, IISS
The page is drawn by JavaScript, so the links are not in the HTML LUCIEN reads. The collector already tries the sitemap and the WordPress API; these did not offer them.
- **Render the page in a headless browser** in GitHub Actions (Playwright is available there). It is allowed by robots.txt where robots.txt allows the page, and it is what a visitor's browser does. Not built yet; I can add it as a fallback for named sources.
- Or ask the organisation for a feed.

## 5. The address is unreachable (Convergent Opinion, People's Polling)
A connection error, not a block: the web address in `config/sources.yml` may be wrong or the site gone. Check the current address of each and correct it (or remove the source).

## 6. No feed, or a paid one (The Spectator, The Telegraph)
The Spectator answers 404 on every feed address tried; the Telegraph's feed answers 402 (payment required). No legitimate workaround besides a subscription or a licensed feed; the email route (above) works if either sends a newsletter.

## What I would do first
1. Correct the two dead addresses (group 5): five minutes.
2. Email the organisations in groups 2 and 3 asking to be allow-listed or pointed to a feed. About a dozen emails would restore most of the thinktank and polling sources.
3. Add the Commons Library feed (group 1) and the pollsters' BlueSky accounts (group 3).
4. Build the headless-browser fallback (group 4) and the email route (groups 1 to 3 and 6) if the first three leave gaps.
