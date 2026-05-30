# serializd-export

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](#requirements)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](#quick-start)

Export your [serializd.com](https://www.serializd.com) watch history — shows, ratings, reviews, diary — to **JSON / CSV / Markdown / TXT**. Serializd doesn't ship a native export; this tool does.

Built as a single, dependency-light CLI that talks to serializd's JSON API directly (no headless browser at runtime), packaged in a small Docker image, and driven by composable field flags.

---

## Highlights

- **Pick exactly the fields you want** — one boolean flag per field, plus `--all`, `--preset`, and `--fields a,b,c`.
- **Multiple output formats** — `json`, `csv`, `md`, `txt`. Pick one or several.
- **Shows + diary** — both are exported by default, same field filter applies to each.
- **Pure Node `fetch`** — no Playwright, Puppeteer, or Selenium at runtime. ~230 MB Docker image (Alpine + Node only).
- **Smart enrichment** — only calls `/api/show/{id}` when a chosen field actually needs it.
- **Polite & resilient** — built-in concurrency limit, 429/5xx retry with backoff.

---

## Quick start

### With Docker (recommended)

```bash
git clone https://github.com/YOUR_USERNAME/serializd-export.git
cd serializd-export
cp .env.example .env       # fill in SERIALIZD_EMAIL / SERIALIZD_PASSWORD / SERIALIZD_USERNAME
docker build -t serializd-export .

# No flags → JSON + CSV, name only
docker run --rm --env-file .env -v "$(pwd)/output:/app/output" serializd-export

# All fields, all formats
docker run --rm --env-file .env -v "$(pwd)/output:/app/output" \
  serializd-export --all --format json,csv,md
```

Or with `docker compose`:

```bash
docker compose run --rm serializd-export --rating --genres --status
```

Output files land in `./output/`.

### Without Docker (Node ≥ 18)

```bash
git clone https://github.com/YOUR_USERNAME/serializd-export.git
cd serializd-export
cp .env.example .env       # fill in credentials
npm install
npm start                  # = node src/cli.js
```

Or install globally and run from anywhere:

```bash
npm install -g .
serializd-export --all --format json,csv,md
```

---

## How field flags work

Every flag adds one field to the output. **No flags = only the show name.**

```bash
# nothing → just names
serializd-export
# → shows.csv:    name
#                 Dexter
#                 The Office
#                 ...

# add fields → they appear in the output
serializd-export --rating --genres --status
# → shows.csv:    name,status,genres,rating
#                 Dexter,Ended,Crime; Drama; Mystery,
#                 ...

# alternative syntax — comma-separated list
serializd-export --fields name,url,rating,genres

# everything
serializd-export --all

# named bundles
serializd-export --preset standard
```

When **only `name`** is selected, JSON output collapses to a flat array of strings (`["Dexter", "The Office", ...]`) instead of an array of objects — cleaner for piping into other tools.

---

## Available fields

| Flag | Applies to | Description |
| --- | --- | --- |
| `--name` | shows, diary | Show name (always included) |
| `--id` | shows, diary | Numeric show ID |
| `--url` | shows, diary | Canonical serializd URL |
| `--date-added` | shows, diary | When you logged it |
| `--premiere-date` | shows, diary | First-aired date |
| `--last-air-date` * | shows, diary | Last-aired date |
| `--status` * | shows, diary | Ended / Returning / etc. |
| `--num-seasons` | shows | Total seasons in the show |
| `--num-episodes` | shows | Total episodes in the show |
| `--seasons-watched` | shows | IDs of seasons you've watched |
| `--seasons-watched-count` | shows | How many seasons you've watched |
| `--seasons-detail` * | shows | Per-season breakdown (name, episodes, air date) |
| `--genres` * | shows, diary | Genre list |
| `--networks` * | shows, diary | Network/channel list |
| `--tagline` * | shows | Show tagline |
| `--summary` * | shows | Plot summary |
| `--banner` | shows, diary | Banner image path |
| `--rating` | shows, diary | Your latest rating (shows) / entry rating (diary) |
| `--all-ratings` | shows | All ratings you've given the show |
| `--reviews` | shows | Full reviews you've written for the show |
| `--review-text` | diary | The review text |
| `--episode` | diary | Episode number + name |
| `--season` | diary | Season info |
| `--rewatch` | diary | Whether the entry is a rewatch |
| `--log` | diary | Whether the entry is a log (vs review) |
| `--spoiler` | diary | Whether the entry is flagged as spoiler |
| `--tags` | diary | User tags on the entry |

`*` = requires per-show enrichment (extra API calls — added automatically if you pick one).

### Presets

| Preset | Fields |
| --- | --- |
| `minimal` | `name` |
| `standard` | `name`, `url`, `date-added`, `rating`, `genres`, `status` |
| `full` | every field (same as `--all`) |

---

## CLI reference

```text
serializd-export [options]

Authentication (env or flags):
      --email <addr>            (env SERIALIZD_EMAIL)
      --password <pw>           (env SERIALIZD_PASSWORD)
  -u, --username <name>         (env SERIALIZD_USERNAME)

Output:
  -f, --format <fmt>            json, csv, md, txt (repeatable / comma-sep) [default: json,csv]
  -o, --output <dir>            Output directory [default: ./output]
      --no-shows                Skip the shows export
      --no-diary                Skip the diary export
      --concurrency <n>         Enrichment parallelism [default: 5]
  -q, --quiet                   Suppress progress logs

Misc:
  -h, --help                    Show full help with field list
  -v, --version                 Show version
```

Run `serializd-export --help` for the full list including every field flag.

---

## Output layout

For combined formats (JSON), one file per export:

```text
output/
└── serializd-export.json
```

For per-section formats (CSV / Markdown / TXT):

```text
output/
├── shows.csv
├── shows.md
├── diary.csv
└── diary.md
```

---

## Configuration

Copy `.env.example` to `.env`:

```env
SERIALIZD_EMAIL=you@example.com
SERIALIZD_PASSWORD=your-password
SERIALIZD_USERNAME=your-serializd-username
# Optional:
# SERIALIZD_OUTPUT_DIR=/path/to/output
```

In Docker, pass these via `--env-file .env` or repeated `-e`.

> [!CAUTION]
> Never commit your `.env`. The repo's `.gitignore` and `.dockerignore` already exclude it. If you fork and publish, double-check before pushing.

---

## How it works

Serializd is a Next.js app backed by a JSON API at `https://serializd.onrender.com/api`. This tool:

1. `POST /api/login` with `{email, password}` → receives a JWT.
2. Pages through `/api/user/{username}/watchedpage_v2/{n}` for the full watched list.
3. Pages through `/api/user/{username}/diary?page=N` for reviews and log entries.
4. *(Only if you select fields like `--genres` or `--status`)* hits `/api/show/{id}` per show for richer metadata.
5. Cross-references diary entries onto shows so `--rating` and `--reviews` work on the shows export.
6. Projects every record through your selected fields and writes the formats you asked for.

There's no Playwright / Puppeteer in the runtime path — the discovery scripts in `scripts/` exist only so a maintainer can re-map the API if it ever changes.

---

## Examples

```bash
# Just the names — perfect for piping
serializd-export | jq -r '.shows[]'

# A spreadsheet-ready file with the most useful fields
serializd-export --preset standard --format csv

# A Markdown summary you can paste anywhere
serializd-export --rating --genres --networks --format md --no-diary

# A diary-only export with episode details
serializd-export --rating --episode --season --review-text --no-shows --format csv

# Everything, in every format
serializd-export --all --format json,csv,md,txt
```

---

## Requirements

- Node.js ≥ 18 (uses native `fetch` and `parseArgs`), **or**
- Docker (any recent version).

---

## Project layout

```text
serializd-export/
├── src/
│   ├── cli.js          # entry point + arg parsing
│   ├── api.js          # serializd JSON API client
│   ├── fields.js       # field registry (one source of truth)
│   ├── formatters.js   # JSON / CSV / MD / TXT writers
│   └── exporter.js     # orchestration
├── scripts/
│   ├── discover.js     # dev tool — Playwright-based network discovery
│   └── probe.js        # dev tool — endpoint probing
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Roadmap

- [ ] Publish prebuilt image to GitHub Container Registry
- [ ] `--since <date>` filter, `--min-rating <n>` filter
- [ ] Optional web UI (`docker run -p 3000:3000`) — paste creds, click export, download zip
- [ ] Export to Letterboxd / Trakt-compatible formats

---

## Contributing

Issues and PRs welcome. Run `npm run discover` (requires Playwright; installed via devDependencies) to re-map the API after any serializd changes.

---

## Disclaimer

This is an unofficial tool. It uses your account's own data via the same API the serializd web app uses. **Use only with your own account**, and respect serializd's terms of service. The authors are not affiliated with serializd.

---

## License

[MIT](LICENSE)
