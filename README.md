# Mixcloud Regex Feeds

An unofficial podcast bridge for Mixcloud's `8ballradio` account.

- `/feed.xml?regex=correspondence`
- `/feed.xml?regex=ephemera`
- `/feed.xml?regex=correspondence%7Cephemera`

Regex is always case insensitive and matches titles. URL-encode reserved regex characters (`|` as `%7C`, `+` as `%2B`, etc.). Default maximum: latest 100 matches; `limit` accepts 1–200. Invalid patterns return HTTP 400. Repeated groups, lookarounds, backreferences, and repeated wildcards are rejected to limit synchronous regex work.

The initial snapshot covers 5,788 uploads. Each refresh scans newest uploads until it reaches the snapshot, then combines new/updated entries with that archive. Entries already archived and no longer visible in current upload pages can remain listed; playback resolution still checks Mixcloud and omits unavailable audio. Results cache for 15 minutes. Existing titles deep in the snapshot are refreshed when a new snapshot is deployed.

Audio enclosures use stable local URLs. At playback the service resolves the current public audio URL and redirects to Mixcloud, avoiding long-lived expiring URLs in RSS. HEAD returns the verified MIME type and file size. Stream restrictions are respected, and restricted or unavailable episodes are omitted. Temporary upstream failures return HTTP 502 rather than serving an apparently successful empty feed.

No audio is rehosted. This service is not affiliated with Mixcloud or 8 Ball Radio. Source for the public stream URL decoder: yt-dlp's Mixcloud extractor (Unlicense), https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/mixcloud.py.

## Build

Run `node scripts/assemble.mjs`, `bash scripts/build.sh`, then `node scripts/validate-artifact.mjs`. The assembled Worker embeds the catalog; no external dependencies, credentials, schedules, or database are required. Public access must be enabled before a podcast app can fetch the RSS and audio routes.

## Vercel

`vercel.json` adds a Node.js Function adapter for RSS and audio paths. `node scripts/build-vercel.mjs` writes the unchanged generator page to `public/index.html`. The original Sites Worker remains usable. No environment variables are required. Production must be publicly accessible for podcast clients.
