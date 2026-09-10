# Fluxtracker

Real-time performance dashboard for the Flux decentralized cloud network. Tracks revenue transactions, node metrics, deployed app statistics, price history, and Docker repository snapshots.

## Features

- **Real-time Flux network monitoring** -- Node counts by tier (Cumulus, Nimbus, Stratus), cloud resource utilization (CPU, RAM, Storage), and deployed app totals
- **Revenue transaction tracking** -- Syncs with the Flux blockchain daemon, attributes payments to deployed apps, and classifies app type (git/docker)
- **Price history** -- FLUX/USD daily closes via Binance, CoinGecko and CryptoCompare, stored for historical charts and USD revenue calculations
- **Docker repository snapshots** -- Daily tracking of running instances for every Docker image the network still exposes an image for; still collected and queryable via the API, but no longer surfaced on the dashboard (see "App Categorisation" below)
- **Decentralization tracking** -- Classifies node IPs as datacenter-hosted or independent via IP/org lookups, with daily snapshots and historical trends by datacenter, country and continent
- **Team Funded revenue tracking** -- The Flux team's own hosting spend (`FLUX_TEAM_ADDRESSES`) trended daily as a FLUX amount, a USD amount, and a % of that day's total revenue
- **Historical data visualization** -- Interactive Chart.js charts with configurable time ranges
- **Period-over-period comparisons** -- Toggle between daily, weekly, monthly, quarterly, and yearly comparisons across all metrics
- **KPI Discord reports** -- Manual (footer button, any webhook) and scheduled (env-configured) reports of Revenue, Nodes, Resource Utilization, Applications and Flux Cloud, comparing two completed periods
- **Terminal header** -- Animated boot sequence that resolves into a permanent FLUX ASCII logo, with a short sync animation whenever a new block is detected
- **CSV export** -- Download revenue transaction data as CSV
- **Carousel dashboard** -- Live feed of recently deployed and expiring apps on the network
- **Automated sync** -- Background schedulers for revenue sync (5 min), service tests (1 hr), carousel updates (1 hr), and daily snapshots
- **Automated backups** -- Daily backup of critical tables to Cloudflare R2 with 30-day retention and one-click restore
- **Auto-failover** -- Circuit breaker automatically switches to a failover Supabase instance when the primary is unreachable
- **Resilient outbound fetches** -- One shared retry + per-endpoint circuit breaker for every external API read, so a dead upstream can't stall the dashboard

## Tech Stack

| Layer      | Technology                                           |
|------------|------------------------------------------------------|
| Frontend   | SvelteKit 5 (Svelte 5, Vite 6)                      |
| Backend    | Express.js 4                                         |
| Database   | Supabase (PostgreSQL) or SQLite via `better-sqlite3`  |
| Backup     | Cloudflare R2 via `@aws-sdk/client-s3`               |
| Charts     | Chart.js 4                                           |
| Icons      | Lucide Svelte + custom Simple Icons components       |
| Runtime    | Node.js 20                                           |
| Deployment | Docker (multi-stage Alpine), Flux Cloud              |

## Architecture

```
                            +-------------------+
                            |   Flux Cloud      |
                            |   (port 37000)    |
                            +--------+----------+
                                     |
                            +--------v----------+
                            |  Docker Container |
                            +-------------------+
                            |                   |
         +------------------+  startup.sh       +------------------+
         |                  |  (entrypoint)     |                  |
         v                  +-------------------+                  v
+--------+--------+                                     +----------+-------+
| SvelteKit        |                                     | Express.js API   |
| (port 5173)      | --- /api/* proxy (hooks.server.js) --> (port 3000)    |
| Frontend + SSR   |                                     | Background sync  |
+------------------+                                     +--------+---------+
                                                                  |
                                                         +--------v---------+
                                                         | Supabase         |
                                                         | (PostgreSQL)     |
                                                         | PostgREST + RPC  |
                                                         +------------------+
```

Both processes run inside a single Docker container. SvelteKit serves the frontend on port 5173 and proxies all `/api/*` requests to the Express backend on port 3000 via `hooks.server.js`. In production on Flux Cloud, only one port (37000) is exposed externally and mapped to the SvelteKit server.

### Database Modes

The app supports two database backends via an adapter layer (`src/lib/db/database.js`):

- **Supabase mode** (`DB_TYPE=supabase`, default) — The primary instance connects to Supabase (PostgreSQL). Complex queries use RPC functions. Backs up critical tables to Cloudflare R2.
- **SQLite mode** (`DB_TYPE=sqlite`) — Docker/Flux instances use a local embedded SQLite database. On first start, optionally bootstraps historical data from R2. All RPC functions are translated to equivalent raw SQL.

```
PRIMARY (local)                          DOCKER/FLUX INSTANCES
+----------------------+                 +----------------------+
|  DB_TYPE=supabase    |   R2 Backup     |  DB_TYPE=sqlite      |
|  Supabase instance   | --------------> |                      |
|  Backs up to R2      |                 |  Bootstrap from R2   |
|                      |                 |  Run independently   |
+----------------------+                 +----------------------+
```

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (self-hosted or Supabase Cloud)

### Environment Variables

Copy the example file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Database mode:

| Variable   | Description                              | Default     |
|------------|------------------------------------------|-------------|
| `DB_TYPE`  | `supabase` or `sqlite`                   | `supabase`  |
| `DB_PATH`  | SQLite file path (SQLite mode only)      | `data/fluxtracker.sqlite3` |

Required for Supabase mode (`DB_TYPE=supabase` or unset):

| Variable                    | Description                     |
|-----------------------------|---------------------------------|
| `SUPABASE_URL`              | Your Supabase project URL       |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |

Optional -- Failover (auto-switch when primary DB is unreachable):

| Variable                  | Description                          |
|---------------------------|--------------------------------------|
| `SUPABASE_FAILOVER_URL`  | Failover Supabase project URL        |
| `SUPABASE_FAILOVER_KEY`  | Failover service role key            |

Optional -- Backup to Cloudflare R2 (primary instance, all 4 required):

| Variable              | Description                                           |
|-----------------------|-------------------------------------------------------|
| `R2_ENDPOINT`         | R2 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID`    | R2 API token access key (read-write)                  |
| `R2_SECRET_ACCESS_KEY`| R2 API token secret key                                |
| `R2_BUCKET_NAME`      | R2 bucket name (e.g. `fluxtracker-backups`)            |

Optional -- Bootstrap from R2 (Docker/SQLite instances, all 4 required):

| Variable                       | Description                     |
|--------------------------------|---------------------------------|
| `BOOTSTRAP_R2_ENDPOINT`       | R2 endpoint                     |
| `BOOTSTRAP_R2_ACCESS_KEY_ID`  | R2 API token access key (read-only recommended) |
| `BOOTSTRAP_R2_SECRET_ACCESS_KEY` | R2 API token secret key      |
| `BOOTSTRAP_R2_BUCKET_NAME`    | R2 bucket name                  |

Optional -- Scheduled KPI reports (all unset = feature off):

| Variable                       | Description                     |
|--------------------------------|---------------------------------|
| `KPI_WEBHOOK_URL`             | Discord webhook the scheduled reports are posted to. Unset or invalid = scheduler disabled. |
| `KPI_SCHEDULE`                | Which timeframes to auto-send, comma-separated: `daily`, `weekly`, `monthly`, `quarterly`, `yearly` (e.g. `daily,weekly`) |
| `KPI_SCHEDULE_HOUR_UTC`       | Hour of day (UTC) the daily run fires; the other timeframes go out in the same hour once their period has completed (weekly on Mondays, monthly on the 1st, quarterly on the quarter's first day, yearly on Jan 1; default `2`) |

When configured, the scheduler checks every 10 minutes and sends the report once per period (a restart never double-sends; a server that was down at the scheduled hour catches up on boot). The footer KPI button keeps working independently with any webhook you enter in the dialog.

Optional -- CORS allowed origins (production only):

| Variable                | Description                                          |
|--------------------------|------------------------------------------------------|
| `CORS_ALLOWED_ORIGINS`  | Comma-separated list of `scheme://host[:port]` entries allowed to make cross-origin requests to the API, e.g. `https://your-domain.example,http://203.0.113.10:37000`. Local dev origins (`localhost`/`127.0.0.1`) are always allowed and don't need to be listed. Unset = only local dev origins work — a deployed instance logs a startup warning and rejects everything else. |

### Database Setup

Run every file in `supabase/migrations/` in your Supabase SQL Editor, in numeric order --
unlike SQLite's self-healing `ALTER TABLE ADD COLUMN IF NOT EXISTS` schema, **Supabase
migrations are not auto-applied**, so a fresh project or one that's fallen behind needs each
file run manually:

1. `001_initial_schema.sql` -- Creates all tables, indexes, and seed data
2. `002_rpc_functions.sql` -- Creates RPC functions for aggregation queries
3. `003_enable_rls.sql` -- Enables Row Level Security on all tables (service_role bypasses it)
4. `004_partial_index_usd_null.sql` -- Partial index speeding up the USD-backfill scan
5. `005_app_name_index.sql` -- Index on `app_name` for analytics/search queries
6. `006_update_usd_batch.sql` -- RPC function for the USD backfill's batched updates
7. `007_node_ip_classification.sql` -- Table for per-IP datacenter/independent classification
8. `008_decentralization_snapshots.sql` -- Table for daily datacenter/independent history
9. `009_decentralization_country_continent.sql` -- Country/continent columns + snapshot tables
10. `010_daily_revenue_from_addresses.sql` -- RPC functions behind the Team Funded chart

The schema migrator (`src/lib/db/schemaMigrator.js`) also runs on startup to add any dynamic
columns needed by the current config (e.g., new gaming or crypto repo columns) -- that part
is automatic in both database modes. Only the files above (tables, indexes, RPC functions)
need to be run by hand against Supabase.

### Install and Run

```bash
# Install dependencies
npm install

# Run both frontend and API in development
npm run dev:all

# Or run them separately:
npm run dev      # SvelteKit frontend (port 5173)
npm run api      # Express API server (port 3000)
```

### Build for Production

```bash
npm run build
npm run start:all
```

`start:all` runs the same two processes the Docker image runs, in the same order: the Express
API on port 3000, then the built SvelteKit server on 5173 once the API answers. Override with
`API_PORT` / `FRONTEND_PORT`. Ctrl+C stops both, and if either process dies the other is
stopped too — half the stack running is never useful.

Before printing its banner it makes one request to `/api/health/live` **through the frontend**,
which is the same path the browser takes. Two healthy processes that cannot reach each other is
exactly what a port mismatch looks like, and checking them separately misses it entirely.

`API_PORT` is passed to both processes, because `hooks.server.js` has to proxy to the port the
API was actually started on. **Changing it requires `npm run build`** — `hooks.server.js` is
compiled into `build/`, so a stale build keeps proxying to the old port and every request fails
with `API proxy error: fetch failed`, which reads like the API is down rather than misaddressed.

**Two processes are required, not one.** The browser only ever talks to the SvelteKit server;
`src/hooks.server.js` proxies every `/api/*` request onward to Express. That is what makes the
single-port setup work on Flux, and it means `npm run start` on its own serves pages whose API
calls all fail. Use it alone only if you are running the API separately.

```bash
npm run start    # SvelteKit server only — needs the API running elsewhere
npm run api      # Express API only
```

## Database

Supabase (PostgreSQL). All database functions in `src/lib/db/database.js` are async. Deduplication is handled by `ON CONFLICT DO NOTHING` on upsert -- no in-memory txid sets needed.

### Tables

| Table                  | Primary Key     | Description                                                    |
|------------------------|-----------------|----------------------------------------------------------------|
| `daily_snapshots`      | `id` (BIGSERIAL) | One row per day with all metrics (revenue, nodes, apps, cloud). Unique on `snapshot_date`. |
| `revenue_transactions` | `id` (BIGSERIAL) | Individual blockchain transactions with app attribution. Unique on `txid`. |
| `failed_txids`         | `txid` (TEXT)    | Tracks failed transaction fetches for retry with attempt counts |
| `current_metrics`      | `id` (INTEGER)   | Singleton row (id=1) holding the latest live metrics           |
| `flux_price_history`   | `date` (DATE)    | Daily FLUX/USD prices from CoinGecko/CryptoCompare             |
| `sync_status`          | `id` (BIGSERIAL) | Tracks last sync time, block height, and status per service. Unique on `sync_type`. |
| `repo_snapshots`       | `id` (BIGSERIAL) | Daily Docker image instance counts with category labels. Unique on `(snapshot_date, image_name)`. |
| `node_ip_classification` | `ip` (TEXT) | Per-IP datacenter/independent classification, cached indefinitely (an IP's org rarely changes) and re-checked once stale. |
| `decentralization_snapshots` | `id` (BIGSERIAL) | Daily node count per datacenter/org. Unique on `(snapshot_date, org)`. |
| `decentralization_country_snapshots` | `id` (BIGSERIAL) | Daily node count per country. Unique on `(snapshot_date, country)`. |
| `decentralization_continent_snapshots` | `id` (BIGSERIAL) | Daily node count per continent. Unique on `(snapshot_date, continent)`. |

### RPC Functions

Defined in `supabase/migrations/002_rpc_functions.sql`, with two more added later in `010_daily_revenue_from_addresses.sql`:

| Function                         | Purpose                                          |
|----------------------------------|--------------------------------------------------|
| `get_daily_revenue`              | Sum revenue by day since a start date            |
| `get_daily_revenue_in_range`     | Sum revenue by day within a date range           |
| `get_daily_revenue_usd`          | Sum USD revenue by day with coverage stats       |
| `get_daily_revenue_usd_in_range` | Sum USD revenue by day within a date range       |
| `get_app_analytics`              | Revenue grouped by app_name, paginated + search  |
| `get_transactions_paginated`     | Paginated transactions with multi-field search   |
| `get_top_repos_by_category`      | Top Docker images by category from latest snapshot |
| `get_category_history`           | Aggregated daily totals for a category           |
| `get_repos_by_category`          | Distinct base image names in a category          |
| `get_repo_history_merged`        | Instance count history merging tagged images     |
| `get_distinct_repos`             | All distinct image names                         |
| `get_distinct_repo_count`        | Count of distinct image names                    |
| `get_daily_revenue_from_addresses_in_range` | Sum revenue by day within a date range, filtered to a given address list (Team Funded chart) |
| `get_daily_revenue_usd_from_addresses_in_range` | Same, in USD |

### Row Level Security

RLS is enabled on all tables via `003_enable_rls.sql`. No permissive policies are defined, so the anon key gets zero access. The backend uses the `service_role` key, which bypasses RLS entirely.

## API Endpoints

Base URL: `/api`

### Health and Stats

| Method | Endpoint        | Description                              |
|--------|-----------------|------------------------------------------|
| GET    | `/api/health`   | Combined health (DB, snapshot, backup, price history, KPI scheduler) -- see [Health Endpoint](#health-endpoint) |
| GET    | `/api/health/live` | Liveness only (process is running)    |
| GET    | `/api/health/ready` | Readiness (DB reachable)             |
| GET    | `/api/stats`    | Database row counts and last snapshot date |

### Metrics

| Method | Endpoint                              | Description                                              |
|--------|---------------------------------------|----------------------------------------------------------|
| GET    | `/api/metrics/current`                | Current live metrics (nodes, cloud, apps, revenue, etc.) |
| GET    | `/api/metrics/category/:category/top` | Top repos for a category with 7-day comparison           |

Valid categories: `gaming`, `crypto`, `wordpress`

### Revenue

| Method | Endpoint               | Description                                                          |
|--------|------------------------|----------------------------------------------------------------------|
| GET    | `/api/revenue/:period` | Revenue for a period with previous-period comparison                 |

Valid periods: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`

### Transactions

| Method | Endpoint                      | Description                                             |
|--------|-------------------------------|---------------------------------------------------------|
| GET    | `/api/transactions/summary`   | Total count and revenue for today, 7 days, and 30 days  |
| GET    | `/api/transactions/paginated` | Paginated list with search (`?page=&limit=&search=&appName=`) |
| GET    | `/api/transactions/:date`     | Transactions for a specific date (YYYY-MM-DD)           |

### Analytics

| Method | Endpoint                          | Description                                    |
|--------|-----------------------------------|------------------------------------------------|
| GET    | `/api/analytics/apps`             | Revenue grouped by app name, paginated         |
| GET    | `/api/analytics/comparison/:days` | Period-over-period comparison for all metrics   |

### History and Charts

| Method | Endpoint                                | Description                                     |
|--------|-----------------------------------------|-------------------------------------------------|
| GET    | `/api/history/snapshots`                | Daily snapshots (summarized for chart use)       |
| GET    | `/api/history/snapshots/full`           | Daily snapshots (full data, all columns)         |
| GET    | `/api/history/revenue/daily`            | Daily revenue aggregated from transactions       |
| GET    | `/api/history/revenue/daily-usd`        | Daily revenue in USD from transactions           |
| GET    | `/api/history/repos/list`               | All distinct Docker image names                  |
| GET    | `/api/history/repos/history?image=`     | Instance count history for an image              |
| GET    | `/api/history/repos/latest`             | Latest snapshot of all repos                     |
| GET    | `/api/history/category/:category`       | Category history (aggregated daily totals)       |
| GET    | `/api/history/category/:category/repos` | Repos belonging to a category                    |
| GET    | `/api/history/revenue/team-funded/daily?start_date=&end_date=` | Daily FLUX + USD revenue from `FLUX_TEAM_ADDRESSES`, merged by date (Team Funded chart) |

Query parameters for history endpoints: `limit`, `start_date`, `end_date`

### Decentralization

| Method | Endpoint                        | Description                                                     |
|--------|----------------------------------|------------------------------------------------------------------|
| GET    | `/api/decentralization`         | Current datacenter vs. independent node split, plus top datacenters |
| GET    | `/api/decentralization/history?days=` | Historical datacenter/independent, country and continent breakdowns, for the Historical Performance chart's search-and-trend view |

### Categories

| Method | Endpoint                 | Description                          |
|--------|--------------------------|--------------------------------------|
| GET    | `/api/categories/gaming` | Gaming app counts and history        |
| GET    | `/api/categories/crypto` | Crypto node counts                   |
| GET    | `/api/categories/nodes`  | Flux node distribution by tier       |

### Carousel

| Method | Endpoint                 | Description                |
|--------|--------------------------|----------------------------|
| GET    | `/api/carousel/stats`    | Cached carousel statistics |
| GET    | `/api/carousel/deployed` | Recently deployed apps     |
| GET    | `/api/carousel/expiring` | Apps expiring soon         |
| GET    | `/api/busiest-node`      | The network's busiest node (most running instances), its resolved app names, and CPU/RAM/SSD used vs. its own benchmarked capacity (issue #108) |
| GET    | `/api/apps/activity`     | 24h deployed/expiring counts (the same data behind the KPI daily report's Flux Cloud section) |

### Admin

| Method | Endpoint                              | Description                                    |
|--------|---------------------------------------|------------------------------------------------|
| GET    | `/api/admin/snapshot-status`          | Snapshot system health and state                |
| GET    | `/api/admin/revenue-status`           | Revenue sync status, block height, tx count    |
| GET    | `/api/admin/test-status`              | Service test scheduler status                  |
| GET    | `/api/admin/price-history-status`     | FLUX/USD price history coverage + last sync outcome |
| GET    | `/api/admin/host-location`            | Where this server resolved its own location (diagnostic) |
| GET    | `/api/kpi/availability`               | Which KPI timeframes have enough history            |
| GET    | `/api/kpi/preview?timeframe=`         | Computed KPI numbers without sending anything       |
| POST   | `/api/kpi-report`                     | Build and deliver a KPI report                      |
| POST   | `/api/admin/revenue-sync`             | Trigger manual revenue sync                    |
| POST   | `/api/admin/clear-revenue-data`       | Delete all transactions and reset sync (destructive) |
| POST   | `/api/admin/reset-revenue-sync`       | Reset sync block to trigger full re-scan       |
| POST   | `/api/admin/backfill-app-types`       | Backfill git/docker app type                   |
| POST   | `/api/admin/backfill-app-names`       | Backfill app names from OP_RETURN data         |
| POST   | `/api/admin/backfill-usd`             | Backfill USD amounts using price history       |
| POST   | `/api/admin/sync-price-history`       | Force a gap-filling price history sync         |
| POST   | `/api/admin/backfill`                 | Backfill daily snapshots (last 365 days)       |
| POST   | `/api/admin/backfill-repo-categories` | Backfill NULL repo categories                  |
| POST   | `/api/admin/recategorize-repos`       | Reset and re-apply all repo categories         |
| POST   | `/api/admin/snapshot`                 | Trigger manual daily snapshot                  |
| POST   | `/api/admin/repo-snapshot`            | Trigger manual repo-only snapshot              |
| POST   | `/api/admin/test-services`            | Trigger all service tests + revenue sync       |
| POST   | `/api/admin/audit-transactions`       | Audit recent transactions for missed entries   |
| GET    | `/api/admin/backup-status`            | Backup configuration and health status         |
| POST   | `/api/admin/backup`                   | Trigger manual backup to R2                    |
| GET    | `/api/admin/backups`                  | List available backup dates in R2              |
| POST   | `/api/admin/restore`                  | Restore from backup (`{ "date": "YYYY-MM-DD" }`) |
| POST   | `/api/admin/failover`                 | Manually switch between primary/failover DB    |
| GET    | `/api/admin/failover-status`          | Active instance and circuit breaker state      |

## App Categorisation

**Not currently shown on the dashboard.** FluxOS v8.18 (Sept 2026) removed the per-instance image
field the running-apps census used to return (issue #106); apps are now resolved by name via
`appSpecsCache.js`, which only covers the ~76-78% of running instances whose spec is still public.
An undercounted or (for the old Git/Docker split) actively wrong category total is worse than none,
so the Gaming/Crypto/WordPress metric cards, the category cards, the Docker Repos history graph and
the Git/Docker split were all removed (issue #109) rather than shown with a caveat. `total_apps` is
unaffected — it comes from the running-instance census, not per-app resolution — and is the one
app-count figure still displayed.

The logic below is unchanged and still runs: `repo_snapshots`, the `/api/categories/*` endpoints and
`gamingService`/`cryptoService`/`wordpressService` keep collecting this data (issue #108 explores
what to build with it next), so this section remains accurate as a reference for that code — just
read "card" below as "category row in the API/database," not "something on the dashboard."

Every category total resolves its numbers through one function, `categorizeImage()` in
`src/lib/config.js`. It matches keywords against the **whole Docker image string, tag included**.

Two things decide what you see on a card:

- **Which category an image counts toward** — `CATEGORY_CONFIG` keywords, minus `CATEGORY_EXCLUDE`
- **What the row is called, and which rows merge** — `DISPLAY_NAME_OVERRIDES` (per image, used in
  history) and `CANONICAL_NAME_OVERRIDES` (groups image variants into one card row)

### Why one game or chain can appear under several images

A game or chain is often published as several unrelated Docker images, and the card merges them:

| Card row | Merged from |
|---|---|
| Palworld | `thijsvanloef/palworld-server-docker` + `runonflux/palworld-server-flux` (Flux's own packaging) |
| Minecraft | `itzg/minecraft-server` (Java) + `itzg/minecraft-bedrock-server` |
| Valheim | `mbround18/valheim` + `littlestache/valheim-flux` + `lloesche/valheim-server` |
| Rust | `littlestache/rust-server` + `pfeiffermax/rust-game-server` |
| Beldex | `ghcr.io/girderworks/edge` + `ghcr.io/girderworks/feather` |

`repo_snapshots` still stores a row per image, so history and charts are unaffected by grouping —
only the card view merges.

**Palworld is the common question.** It used to render as two rows, "Palworld" and "Palworld
Server", which read as two different products. They are the same game: the second is Flux's own
packaging (`runonflux/palworld-server-flux`), and it only got a separate label because the
fallback namer strips the trailing `-flux` and stops. Both now merge into one **Palworld** row.

### An image name doesn't always name the thing

The biggest source of undercounting is an image whose name mentions neither the chain nor the game.
Beldex is the worst case found so far: `beldex` was in the crypto keyword list the whole time and
never matched, because ~890 masternodes run as `ghcr.io/girderworks/{edge,feather}` — a third party
packaging Beldex for Flux, with no chain identifier anywhere in the name. That is roughly 12% of
everything running on the network, sitting in "uncategorised" (issue #74).

When an image name is opaque, its labels usually are not:

```bash
docker inspect <image> --format '{{json .Config.Labels}}'   # org.opencontainers.image.title=beldex-node
docker history --no-trunc <image> | grep -i label
```

It is worth periodically running the top uncategorised images through that before assuming they
can't be classified — a handful of large owners account for a large share of the network, so one
missed image can move a total by an order of magnitude.

### What "Crypto Nodes" deliberately excludes

The card is labelled Crypto **Nodes**, so it counts infrastructure for a named chain: nodes,
indexers and block explorers. These are crypto-adjacent but are **not** counted, on purpose:

| Not counted | Why |
|---|---|
| `runonflux/fluxos`, `fluxoshashes`, `fluxcloud`, `runonflux/titan` | Flux platform containers, not a node for a chain |
| `runonflux/ipfs` | Content-addressed storage — no chain state |
| `wirewrex/nostr-rs-relay` | Nostr is a social protocol, not a blockchain |
| `patpi93/beam105-worker` | A miner, not a node |
| `smartico/aave`, `liquity/dev-frontend`, `honsontran/sushiswap-interface` and other dApp UIs | Web frontends, not nodes |

There are tests pinning each of these to "uncategorised" so the scope line doesn't drift by
accident. If you want a broader definition, that's a deliberate decision to change the card's
label along with its contents.

### Helper images that would be counted as the thing they help

`CATEGORY_EXCLUDE` is checked *before* the keyword match:

- `*-server-website` — companion web frontends shipped next to the game servers. Counting them
  inflated every game total and produced a "MINECRAFT SERVER WEBSITE" label that overflowed the card.
- `wirewrex/flux-dns-fdm` — a monitoring sidecar that runs one instance per app it watches and names
  the watched app in its **tag** (`:minecraft-ping`, `:wordpress`). Since matching includes the tag,
  those leaked straight into the totals — 47 phantom gaming instances on one day.

This is the trap to remember when adding a keyword: **any bare single-word keyword also matches
tags.** `presearch/node` is safe because it's qualified; a bare `wordpress` is not.

### Changing the configuration

1. Edit `CATEGORY_CONFIG`, `CATEGORY_EXCLUDE`, `DISPLAY_NAME_OVERRIDES` or
   `CANONICAL_NAME_OVERRIDES` in `src/lib/config.js`
2. Check the new keyword against a live sample before trusting it — confirm it only picks up
   currently-uncategorised images and moves nothing between categories
3. Run the tests: `npx vitest run src/lib/__tests__/categorization.test.js`
4. Re-apply to stored history:

```bash
curl -X POST localhost:3000/api/admin/recategorize-repos
```

The category endpoint also re-validates stored rows against the current config at read time, so a
newly excluded image disappears from the cards immediately — the admin call fixes history.

## Terminal Header

The static `FLUX / TRACKER` title is gone. The header is now an animated terminal: a boot
sequence types out real `/api/header` data (api/database checks, a counting block height,
version and network stats), then resolves into a permanent **FLUX ASCII logo** with a cyan glow.
Whenever a new block is detected while the page is open, the logo briefly wipes into a
random-character sync texture and the live sync status — inside the **same fixed-height box**,
so the header never grows or shrinks.

- One voice for all header text: the boot output, the sync status and the build line share font
  and colour; the build line shows the version (green) and ArcaneOS codename (purple), both
  API-driven
- Reduced-motion users get the final states without the animation
- The header is covered by a headless-browser acceptance harness: `scripts/header-smoke/` (see
  its README) — run it before and after any header change

Adding a **featured breakdown column** (the named entries inside a category, e.g. `gaming_palworld`)
is separate: add the repo to `GAMING_REPOS`/`CRYPTO_REPOS` and `schemaMigrator` creates the column at
startup, because `METRIC_COLUMNS` is derived from that config. Note its `imageMatch` must list every
image that merges into the row, or the featured number and the card disagree — `gaming_palworld`
read 170 against a card showing 266 for exactly this reason. Historical values keep their old basis,
so expect a step in the trend line on the day a change lands.

## Tests

```bash
npm test            # vitest — 590+ tests
```

The pure logic is deliberately separated from the components so it is unit-testable: KPI period
arithmetic, aggregation and Discord formatting (`src/lib/kpi/`), the terminal header animation
(`src/lib/utils/terminalAnimation.js`), app categorisation (`src/lib/__tests__/categorization.test.js`),
the fetch breaker and resilient fetch, the scheduler time math, and the adapter layer. The terminal
header additionally has the headless-browser harness in `scripts/header-smoke/` that drives a real
browser against a dev server and asserts size/style/timing invariants.

## Backup & Resilience

### Automated Backups (Cloudflare R2)

The `daily_snapshots`, `repo_snapshots` and `flux_price_history` tables contain irreplaceable point-in-time data that cannot be re-derived from blockchain or external APIs. Backups protect against data loss if the Supabase instance is lost.

- **Trigger**: Automatically after each successful daily snapshot (fire-and-forget, never blocks the snapshot)
- **Manual**: `POST /api/admin/backup`
- **Storage**: Cloudflare R2 at `backups/{YYYY-MM-DD}/daily_snapshots.json` + `repo_snapshots.json` + `flux_price_history.json`
- **Retention**: 30 days (older backups pruned automatically)
- **Restore**: `POST /api/admin/restore` with `{ "date": "2026-03-18" }` -- upserts data into the current DB
- **Health**: Backup is "healthy" if not configured (not expected) OR last backup is less than 48 hours old
- **No-op without config**: If R2 env vars are not set, backup is silently disabled -- no errors, no log spam

### Auto-Failover

If a failover Supabase instance is configured (`SUPABASE_FAILOVER_URL` + `SUPABASE_FAILOVER_KEY`):

- The circuit breaker monitors consecutive DB failures (threshold: 5)
- On the first transition to OPEN state, the app automatically switches to the failover instance
- All existing `supabase.from(...)` calls route transparently through a Proxy
- Manual toggle: `POST /api/admin/failover`
- Status: `GET /api/admin/failover-status`

### Circuit Breakers

Two independent breakers protect the app from hammering an unreachable dependency:

**Database** (`src/lib/db/circuitBreaker.js`): CLOSED (normal) -> OPEN (DB unreachable, all requests blocked) -> HALF_OPEN (probing with one request)

- Failure threshold: 5 consecutive failures
- Cooldown: 60 seconds before probing
- On the first transition to OPEN it triggers the auto-failover described above

**Outbound API fetches** (`src/lib/services/fetchBreaker.js`): the same state machine, keyed **per endpoint**, wired into `resilientFetch.js` — the shared HTTP GET primitive every external API read goes through (retry + timeout + optional shape validation). One dead upstream (a Flux stats endpoint, an exchange) is short-circuited for the cooldown instead of being timed out against on every cycle, and one open endpoint never blocks another. Threshold 5 / cooldown 60s via `FETCH_CIRCUIT_BREAKER_CONFIG`. The Discord webhook POST is deliberately outside this path — a retry could duplicate a user-visible report.

### Health Endpoint

`GET /api/health` returns combined status:

```json
{
  "status": "ok",
  "db": { "status": "connected", "circuit": "CLOSED", "activeInstance": "primary" },
  "snapshot": { "healthy": true, "todaySnapshotExists": true },
  "backup": { "enabled": true, "healthy": true, "lastBackup": 1710720300000, "ageHours": 2.1 },
  "priceHistory": { "days": 1720, "oldest": "2021-12-10", "newest": "2026-08-20", "healthy": true },
  "kpiScheduler": { "configured": true, "schedule": ["daily"], "hourUtc": 2, "lastRuns": { "daily": { "at": "2026-09-06T02:00:14.512Z", "ok": true } } }
}
```

`priceHistory.healthy` is false when the newest stored FLUX/USD price is more than 2 days old.
That means the historical price sources are failing and new transactions will be stored with a
NULL `amount_usd` — check `lastSync.error` and see "Historical prices" below.

### Historical Prices

Daily FLUX/USD closes live in `flux_price_history` and are what turn `amount` into `amount_usd`
for every transaction older than 24 hours. Today's transactions use the live price instead.

Sources are tried in order, and none needs an API key:

1. **Binance** — `FLUXUSDT` daily klines, 1000 candles per call, paged with `startTime` (data from 2021-12-10)
2. **CoinGecko** — `market_chart`, last 365 days
3. **CryptoCompare/CoinDesk** — only used when `CRYPTOCOMPARE_API_KEY` is set; the endpoint
   returns HTTP 401 without one

The sync is **gap-aware**: every 5 minutes it looks for missing days between the oldest revenue
transaction and yesterday and fills them, so a hole in the middle of the table heals on its own.
If every source fails it backs off for an hour and records the reason in
`GET /api/admin/price-history-status`.

If USD revenue looks empty on a chart:

```bash
curl -s localhost:3000/api/admin/price-history-status   # is `newest` recent? any lastSync.error?
curl -X POST localhost:3000/api/admin/sync-price-history # force a sync past the cooldown
curl -X POST localhost:3000/api/admin/backfill-usd       # then fill in the NULL amount_usd rows
```

`backfill-usd` returns `coverage` (oldest/newest price date and day count) alongside
`missingPriceDates`, so an `updated: 0` result says why.

## KPI Report

A **KPI** button in the footer (between GitHub and Refresh) opens a dialog where you pick a time
frame and a Discord webhook, and FluxTracker posts a formatted report of Revenue, Nodes, Resource
Utilization, Applications and Flux Cloud comparing two completed periods. Daily reports can also
send themselves on a schedule (see [Scheduled reports](#scheduled-reports)).

### Time frames

Reports **always compare two completed periods** and never include the period in progress — a
part-finished week would always look like a collapse next to a full one.

| Time frame | Period | Worked example (today = Fri 21 Aug 2026) |
|---|---|---|
| Daily | Yesterday (UTC) | Aug 20 vs Aug 19 |
| Weekly | Monday-Sunday (ISO week) | Aug 10-16 vs Aug 3-9 |
| Monthly | 1st to last day of the calendar month | Jul 2026 vs Jun 2026 |
| Quarterly | Calendar quarter (Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec) | Q2 2026 vs Q1 2026 |
| Yearly | Jan 1 - Dec 31 | 2025 vs 2024 |

All boundaries are **UTC**, matching how `revenue_transactions.date` and
`daily_snapshots.snapshot_date` are stored. The logic lives in `src/lib/kpi/periods.js`.

### How each metric is calculated

Two aggregation rules, chosen to match the live dashboard:

| Section | Metrics | Aggregation | Source |
|---|---|---|---|
| Revenue | Flux, USD, Team-funded, Team-funded %, Fiat, Fiat % | **Sum across the period** | `revenue_transactions` |
| Revenue | FLUX price (avg) | **Average of daily snapshots** | `daily_snapshots.flux_price_usd` |
| Nodes | Total, Cumulus, Nimbus, Stratus | **Average of daily snapshots** | `daily_snapshots` |
| Resource Utilization | CPU used (cores), RAM used, SSD used | **Average of daily snapshots** | `daily_snapshots` |
| Resource Utilization | CPU used %, RAM used %, SSD used % | **Average of daily snapshots** | `daily_snapshots` |
| Applications | Total Apps | **Average of daily snapshots** | `daily_snapshots` |
| Flux Cloud | Deployed (24h), Expiring (24h) — **Daily reports only** | **Point-in-time at report generation** | live app data (same registry the carousel reads) |

The **Flux Cloud** rows are the one part of the report with no comparison column. Both are 24h
windows read when the report is generated; we never snapshot them per day, so yesterday's
figure cannot be known and a +/- column would be invented. They render as a two-column table
(`Metric | Qty`). **The daily report is followed by a second Discord message, "Flux Cloud
Activity"**, which is the detail behind those two numbers: per-app tables
(`Inst | Name | CPU | RAM | SSD`) for the apps deployed in the last 24 hours and the apps
expiring within them — and the section's counts equal the Activity message's totals exactly,
since both come from the same deduped lists.

**Daily reports read differently from the rest.** A daily report covers single days — nothing
is summed or averaged — so it drops the `- SUM`/`- AVERAGE` heading suffixes and aggregation
notes the other timeframes carry, shows the two dates plainly (`2026-09-04 | 2026-09-03`), and
renders the price row as that day's price rather than an average. Weekly/monthly/quarterly/
yearly reports are unchanged.

**FLUX price is the one averaged row in a summed section.** It is there because without it the
two rows above it cannot be read: FLUX revenue flat while USD revenue falls is a price move, not
a drop in demand, and nothing else in the report distinguishes those. A period *total* of daily
prices would be meaningless, so the row is averaged and the Discord embed names the exception
underneath the `Revenue - SUM` heading rather than letting the heading misdescribe it. On daily
reports the row is simply that day's price, and the averaging note disappears with the rest.

**Utilization percentages sit alongside the raw figures, not instead of them.** "9,031 cores
used" is the same number whether the network grew or capacity collapsed; the percentage is what
separates those. Both are shown so a reader can see which one moved.

**RAM and SSD are reported in TB.** The `daily_snapshots` columns are named `used_ram_gb` and
`used_storage_gb`, but the values they hold are terabytes — fluxbench reports node RAM/SSD in GB
and `cloudService.js` divides by 1000. Numerator and denominator are scaled alike so the
utilization percentages were always right, but the raw figures were labelled GB, which understated
the network by 1000x ("RAM used 17.2 GB" across 6,400 apps). The column names are left alone —
renaming them needs a migration for no behaviour change — and every display site says TB instead.

### Reading the report: revenue is a flow, everything else is a stock

The most common way to misread this report is to expect revenue to track apps and utilization.
It often won't, for two independent reasons, and neither is a fault in the numbers.

**Revenue is a flow; apps and resources are a stock.** Revenue counts payments that *landed*
during the period. Apps, nodes and utilization are point-in-time readings of what *exists*. Those
answer different questions. 6,400 apps do not renew on an even schedule, so a week's revenue
reflects whose subscriptions happened to fall due that week — lumpy by nature, and capable of
falling while the installed base grows. A period where apps rise and revenue drops is ordinary.

**Team-funded revenue moves with Flux's own budget, not with demand.** The Flux team's hosting
spend is real revenue and is included in the headline, but it is one payer making internal
decisions. It can swamp everything else. A worked example from the week of Aug 10-16 2026:

| Bucket | Previous | Current | Change |
|---|---|---|---|
| Team-funded | 25,352 | 16,814 | **-8,539** |
| Fiat gateway | 27,982 | 25,291 | -2,691 |
| Everything else | 2,927 | 5,844 | **+2,917** |
| **Total** | **56,262** | **47,948** | **-8,313** |

The headline fell 14.8%, which reads as a bad week. But the team-funded decline alone is 103% of
the total drop, and third-party crypto revenue nearly doubled — consistent with apps being up
3.5% in the same period. This is exactly why the report breaks Team-funded and Fiat out as
separate lines rather than only showing a total: **subtract them before reading the headline as
a demand signal.**

To measure demand directly, count apps *deployed* during the period rather than revenue received.
The daily report's Flux Cloud section is a step in that direction — `Deployed (24h)` counts the
apps deployed in the last 24 hours — but it is a 24h window, not a full-period count, so it is
not directly comparable against a week's or month's revenue.

Worked examples:

> **USD Revenue - sum across the period.** The daily revenue values for the week are added
> together to give the period total, then compared to the previous week's total the same way.
> This uses `getRevenueForDateRange()`, the same query behind the dashboard's revenue card, so
> the two can never disagree.

> **CPU used - average of daily snapshots.** If daily CPU usage for the week was 61%, 63%, 59%,
> 64%, 62%, 60%, 65%, the period value is the mean = **62.0%**, compared against the previous
> week's mean.

**Team-funded** is revenue from `FLUX_TEAM_ADDRESSES`; **Fiat** is revenue arriving through the
Flux fiat gateway (`FLUX_FIAT_ADDRESSES`). Both are reported as a FLUX value and as a share of
total FLUX revenue for the same period, and both are *included* in the Flux/USD totals above them
rather than being separate buckets. Their `+/-` column is in **percentage points** (`+2.3pp`),
since a change in a percentage is not itself a percentage. The same applies to the three
utilization percentages: `42.5%` moving to `44.0%` is `+1.5pp`, not `+1.5%` (the `+/-%` column
still carries the relative move, `+3.5%`).

Revenue is summed because it accrues; everything else is a point-in-time reading that moves
daily. Averaging rather than taking the last day matters here: roughly 37 days in the history
have zeroed service values from a failed collection run, and an end-of-period reading landing on
one of those would define the entire metric instead of nudging it.

A **failed query is never reported as a number.** The four reads behind this report
(`getSnapshotsInRange`, `getRevenueForDateRange`, `getDailyRevenueUSDInRange`,
`getRevenueFromAddressesForDateRange`) throw on error rather than returning `0` or `[]`. They used
to swallow it, and because revenue coverage is judged only on whether the period predates our
transaction history, a database failure came back "covered" with a value of zero and rendered as a
genuine collapse — `Flux 0.00 / -12,400.00 / -100.0%` — which was then posted to Discord as fact.
The report is now refused instead. A period that genuinely earned nothing is still valid data.

A day whose value is `0` is treated as **missing, not zero** for the snapshot metrics — a live
network never truly has zero nodes or zero apps, so a zero means collection failed that day.

### Percentage change

`% change = ((current - comparison) / comparison) x 100`, rounded to one decimal, always signed.

| Case | Shown as |
|---|---|
| comparison > 0 | `+12.4%` / `-3.1%` |
| comparison = 0, current = 0 | `No change` |
| comparison = 0, current > 0 | `New` (not infinity) |
| either period lacks data | `Insufficient data` |

### Insufficient data

A metric is only reported when **every day** in **both** periods has data. Full coverage is
required on purpose: a 29-of-30-day average silently understates or overstates the period with no
way for the reader to tell it happened. Coverage is tracked per metric, not per report, because
columns were added to `daily_snapshots` at different times:

| Metric group | Data available from |
|---|---|
| Revenue | 2024-05-13 |
| Nodes, CPU/RAM/SSD, CPU/RAM/SSD %, FLUX price | 2024-06-07 |
| Total Apps | 2025-11-10 |

Metrics that fall short are marked `Insufficient data` **with the number of missing days**
(for example `Insufficient data (7 days missing)`), and the rest of the report still sends with a
`Data coverage` note stating how many metrics were skipped and why. When nothing is missing the
note says so explicitly, so a complete report is never ambiguous. A report is only refused outright when
nothing at all is computable — which is currently the case for **Yearly**, since 2024 only has
data from June onward. The modal greys out unavailable time frames up front, and the server
re-checks on submit, so a disabled button is never the only thing standing between a user and a
misleading report.

### Delivery

**Discord** — posted to a user-supplied incoming webhook as a rich embed, one field per section,
each wrapped in a code block so the Qty / +/- / +/-% columns stay aligned on desktop and mobile.
Weekly and longer reports state their aggregation twice — in the field name (`Revenue - SUM`,
`Nodes - AVERAGE`) and in a line above the table. Daily reports read single-day snapshots and
drop both, so the heading is just the section name. Daily is also two messages: the report
followed by the "Flux Cloud Activity" detail message.
Deliberately plain: **no emoji anywhere**, direction carried by explicit `+`/`-` signs, a single
restrained accent color on the embed border.

**Email** — designed for but not yet enabled: this instance has no mail transport configured, so
the option is disabled in the dialog and the API rejects `medium: "email"`.

To enable it you need three things: an SMTP account to send through (any mailbox provider, or a
transactional service such as Resend/SendGrid/SES), a transport library (`nodemailer`) plus an
XLSX writer (`exceljs`) added as dependencies, and four environment variables — `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, with `SMTP_FROM` for the sender address. No separate
application is required; the existing Express server sends directly. The KPI computation is
already delivery-agnostic, so only the transport and the attachment builder are new.

### Scheduled reports

Any of the five timeframes can send itself. Configure three environment
variables (see [Environment Variables](#environment-variables)): `KPI_WEBHOOK_URL` (the Discord
webhook), `KPI_SCHEDULE` (any comma-separated list of `daily`, `weekly`, `monthly`,
`quarterly`, `yearly`) and `KPI_SCHEDULE_HOUR_UTC` (default `2`). All unset or invalid =
scheduler off, one log line, everything else unaffected.

- Checks every 10 minutes and sends once per period, all in the configured hour: the daily
  report covers yesterday; weekly the last completed ISO week (Mondays); monthly fires on the
  1st, quarterly on the quarter's first day, yearly on Jan 1 — each covering the period that
  has just completed. A report missed while the server was down catches up on boot or the next
  tick.
- **A restart never double-sends**: a success receipt is recorded in the existing `sync_status`
  table, and a server that was down at the scheduled hour catches up at boot (or on the next
  tick) because the receipt proves which period was last delivered.
- **Failures are visible, never silent**: a failed run is retried on the next tick, a failure
  notice is posted to the same webhook once per period, and `/api/health` exposes
  `kpiScheduler: { configured, schedule, hourUtc, lastRuns }`.
- The footer **KPI button keeps working independently** — enter any webhook in the dialog and
  send manually; the manual path has its own rate limiting and never interferes with the
  schedule.

### Rate limits and abuse prevention

| Limit | Value |
|---|---|
| Per client, per hour | 5 reports |
| Per client, per day | 20 reports |
| Per destination | 1 report per 5 minutes |

The slot is claimed in the same synchronous pass as the check (`consumeRateLimit()`), not after
the outbound POST: checking and recording as two separate calls left a gap the width of the
Discord request, so two requests fired in parallel both passed before either was counted. If
delivery fails the destination's slot is handed back — nothing was delivered, so a mistyped
webhook should be correctable immediately — while the client's attempt still counts, since a
failed attempt cost real work and making failures free would let a retry loop hammer the endpoint.

Enforced server-side in `src/lib/kpi/rateLimiter.js`; the UI only reflects the result. Limits are
in-memory, so a restart clears them — acceptable for a single-process deployment, but this needs
to move to the database if the app is ever run multi-process.

Outbound requests are restricted to Discord webhook URLs (`discord.com` / `discordapp.com`, with
the `canary`/`ptb` subdomains), validated both at the API boundary and again immediately before
the request, with redirects disabled. Without that, the endpoint would be an open relay that
could be pointed at any host. A hidden honeypot field catches basic bots, and webhook URLs are
masked to their numeric ID in logs — the token half is a credential.


## Deployment

### Docker Build

```bash
docker build -t fluxtracker .
```

### Docker Run

```bash
# Supabase mode (primary instance)
docker run -d \
  -p 3000:3000 -p 5173:5173 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  fluxtracker

# SQLite mode with bootstrap from R2
docker run -d \
  -p 3000:3000 -p 5173:5173 \
  -e DB_TYPE=sqlite \
  -e BOOTSTRAP_R2_ENDPOINT=... \
  -e BOOTSTRAP_R2_ACCESS_KEY_ID=... \
  -e BOOTSTRAP_R2_SECRET_ACCESS_KEY=... \
  -e BOOTSTRAP_R2_BUCKET_NAME=... \
  fluxtracker

# SQLite mode with persistent storage
docker run -d \
  -v ./data:/app/data \
  -p 3000:3000 -p 5173:5173 \
  -e DB_TYPE=sqlite \
  fluxtracker
```

The container uses a multi-stage build (Node 20 Alpine). The `startup.sh` entrypoint:

1. Starts the Express API server on port 3000
2. Waits for the health check to pass (up to 30 seconds)
3. Starts the SvelteKit production server on port 5173
4. Exits if either process dies

A Docker `HEALTHCHECK` monitors the API health endpoint every 30 seconds.

### Flux Cloud

When deploying on Flux Cloud, only one port is exposed externally (typically 37000). Configure the Flux app specification to:

- Map port 37000 to the SvelteKit frontend port (5173)
- Pass `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment variables in the app spec

The SvelteKit `hooks.server.js` proxy handles forwarding all `/api/*` requests to the internal Express server on port 3000. From the browser's perspective, everything comes from a single origin.

### Environment Variables for Docker

| Variable                    | Required | Description                     |
|-----------------------------|----------|---------------------------------|
| `DB_TYPE`                   | No       | `supabase` (default) or `sqlite` |
| `SUPABASE_URL`              | Supabase mode | Supabase project URL       |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase mode | Service role key           |
| `BOOTSTRAP_R2_ENDPOINT`    | No       | R2 endpoint for bootstrap       |
| `BOOTSTRAP_R2_ACCESS_KEY_ID` | No     | R2 read-only access key         |
| `BOOTSTRAP_R2_SECRET_ACCESS_KEY` | No | R2 read-only secret key         |
| `BOOTSTRAP_R2_BUCKET_NAME` | No       | R2 bucket name                  |
| `R2_ENDPOINT`               | No       | R2 endpoint for backups (primary only) |
| `R2_ACCESS_KEY_ID`          | No       | R2 read-write access key        |
| `R2_SECRET_ACCESS_KEY`      | No       | R2 secret key                   |
| `R2_BUCKET_NAME`            | No       | R2 bucket name                  |
| `API_PORT`                  | No       | Express port (default: 3000)    |
| `FRONTEND_PORT`             | No       | SvelteKit port (default: 5173)  |

## Scripts

### npm Scripts

| Script               | Command                                        | Description                          |
|----------------------|------------------------------------------------|--------------------------------------|
| `dev`                | `vite dev`                                     | SvelteKit dev server (port 5173)     |
| `api`                | `node src/server.js`                           | Express API server (port 3000)       |
| `dev:all`            | `concurrently "npm run dev" "npm run api"`     | Run both servers for development     |
| `build`              | `vite build`                                   | Build SvelteKit for production       |
| `start`              | `node build/index.js`                          | Production SvelteKit server only     |
| `start:all`          | `node scripts/start-all.mjs`                   | Production API + frontend together   |
| `test`               | `vitest run`                                   | Run tests                            |
| `db:import-repo-json`| `node scripts/import-repo-json.mjs`            | Import repo snapshot data from JSON  |

### Utility Scripts

| Script                                | Description                                          |
|---------------------------------------|------------------------------------------------------|
| `scripts/migrate-sqlite-to-supabase.mjs` | One-time migration of data from SQLite DB to Supabase |
| `scripts/import-repo-json.mjs`        | Import Docker repo snapshot data from a JSON file    |
| `scripts/apply-rpc-to-cloud.mjs`      | Apply RPC functions to a remote Supabase instance via direct PG connection |
| `scripts/apply-prices-from-csv.mjs`   | Import historical FLUX/USD price data from a CSV file |
| `scripts/header-smoke/`               | Terminal header acceptance harness (headless Edge/Chrome; see its README) |

## Project Structure

```
src/
  server.js                    # Express bootstrap: middleware, CORS, router mounting, startup
  routes/
    +page.svelte               # Main dashboard page
    api/                       # Express route modules (feature-based, issue #123)
      core.js                  # /api/header, /api/stats, /api/health*
      dashboard.js             # /api/carousel/*, /api/apps/activity, /api/busiest-node, /api/decentralization*
      kpi.js                   # /api/kpi/*, /api/kpi-report
      revenue.js               # /api/revenue/*, /api/transactions/*
      history.js               # /api/history/*
      analytics.js             # /api/analytics/*, /api/metrics/*, /api/categories/*
      admin.js                 # /api/admin/* (sync triggers, status/diagnostic reads, manual snapshots)
      admin/
        backup.js               # /api/admin/* failover + Cloudflare R2 backup/restore
        backfill.js             # /api/admin/* data backfills + transaction audit
  lib/
    serverHelpers.js            # Shared route helpers: withDbFallback, createCache, calculateChange
    config.js                   # All configuration (addresses, intervals, categories, API URLs)
    components/                # Svelte components (StatCard, Chart, RevenueTransactions, KpiModal, TerminalHeaderAnimation, etc.)
    kpi/
      periods.js               # KPI period arithmetic (pure, unit-tested)
      metrics.js               # KPI metric definitions, aggregation, formatting
      discord.js               # Discord embed builders (report, Flux Cloud Activity, failure notice)
      rateLimiter.js           # Manual report rate limiting
      schedulerTime.js         # Scheduler due-date math (pure, unit-tested)
    utils/
      terminalAnimation.js     # Header boot/sync animation logic (pure, unit-tested)
    db/
      database.js              # Adapter router (selects Supabase or SQLite)
      adapters/
        supabaseAdapter.js     # Supabase (PostgreSQL) implementation
        sqliteAdapter.js       # SQLite (better-sqlite3) implementation
      supabaseClient.js        # Supabase client initialization (guarded for SQLite mode)
      schemaMigrator.js        # Dynamic column migrations (both backends)
      snapshotManager.js       # Daily snapshot scheduler + backup trigger
      circuitBreaker.js        # DB circuit breaker with auto-failover
      snapshot.js              # Snapshot data access
    services/
      revenueService.js        # Thin re-export hub for revenue/* (issue #124) -- every
                                # existing import from this file keeps working unchanged
      revenue/
        transactionSync.js      # Fetch/process/progressive sync/initial sync/audit
        revenueReporting.js     # Revenue calculation & reporting (date ranges, comparisons)
        revenueBackfill.js      # One-off app_name/app_type backfill utilities
        revenueSyncState.js     # In-memory sync state & failed-tx stats
      fluxNetworkData.js       # Generic FLUX price / block height reads (shared network data)
      revenueScheduler.js      # Revenue sync interval manager
      kpiService.js            # KPI report computation + Discord delivery
      kpiScheduler.js          # Env-configured scheduled KPI reports
      resilientFetch.js        # Shared HTTP GET (retry, timeout, shape validation)
      fetchBreaker.js          # Per-endpoint circuit breaker for outbound fetches
      runningAppsProvider.js   # Shared running-apps payload (one fetch per cycle)
      appSpecsCache.js         # globalappsspecifications cache: name/hash lookup, app-name resolution
      backupService.js         # Cloudflare R2 backup/restore service
      bootstrapService.js      # R2 bootstrap for SQLite mode (first-start data import)
      cloudService.js          # Cloud utilization metrics (CPU, RAM, Storage)
      nodeService.js           # Flux node counts (Cumulus, Nimbus, Stratus)
      gamingService.js         # Gaming app instance tracking
      cryptoService.js         # Crypto node instance tracking
      wordpressService.js      # WordPress instance counting
      priceHistoryService.js   # FLUX/USD price history sync
      hostLocationService.js   # Server geolocation (6h cache)
      busiestNodeService.js    # Network's busiest node: identity, resources, resolved apps
      decentralizationService.js # Node IP datacenter/independent classification + snapshots
      carouselService.js       # Carousel feed data (deployed/expiring apps)
      servicesScheduler.js     # Service test and carousel scheduler
supabase/
  migrations/
    001_initial_schema.sql     # Tables, indexes, seed data
    002_rpc_functions.sql      # PostgreSQL RPC functions
    003_enable_rls.sql         # Row Level Security
    004-006                    # Partial index, app-name index, USD batch update
    007_node_ip_classification.sql          # Per-IP datacenter/independent classification
    008_decentralization_snapshots.sql      # Daily datacenter/independent history
    009_decentralization_country_continent.sql # Country/continent columns + snapshot tables
    010_daily_revenue_from_addresses.sql    # RPC functions behind the Team Funded chart
scripts/                       # Utility scripts
  header-smoke/                # Terminal header acceptance harness (headless browser)
Dockerfile                     # Multi-stage production build
startup.sh                     # Container entrypoint (starts both servers)
.env.example                   # Environment variable template
```

## License

This project is maintained by [2ndTLMining](https://github.com/2ndtlmining).
