# Fluxtracker

Real-time performance dashboard for the Flux decentralized cloud network. Tracks revenue transactions, node metrics, deployed app statistics, price history, and Docker repository snapshots.

## Features

- **Real-time Flux network monitoring** -- Node counts by tier (Cumulus, Nimbus, Stratus), cloud resource utilization (CPU, RAM, Storage), and deployed app totals
- **Revenue transaction tracking** -- Syncs with the Flux blockchain daemon, attributes payments to deployed apps, and classifies app type (git/docker)
- **Price history** -- FLUX/USD price via CoinGecko and CryptoCompare, stored daily for historical charts and USD revenue calculations
- **Docker repository snapshots** -- Daily tracking of running instances for every Docker image on the network, with automatic category breakdowns (Gaming, Crypto Nodes, WordPress)
- **Historical data visualization** -- Interactive Chart.js charts with configurable time ranges and category filters
- **Period-over-period comparisons** -- Toggle between daily, weekly, monthly, quarterly, and yearly comparisons across all metrics
- **CSV export** -- Download revenue transaction data as CSV
- **Carousel dashboard** -- Live feed of recently deployed and expiring apps on the network
- **Automated sync** -- Background schedulers for revenue sync (5 min), service tests (1 hr), carousel updates (1 hr), and daily snapshots
- **Automated backups** -- Daily backup of critical snapshot tables to Cloudflare R2 with 30-day retention and one-click restore
- **Auto-failover** -- Circuit breaker automatically switches to a failover Supabase instance when the primary is unreachable

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

### Database Setup

Run the SQL migration files in your Supabase SQL Editor, in order:

1. `supabase/migrations/001_initial_schema.sql` -- Creates all tables, indexes, and seed data
2. `supabase/migrations/002_rpc_functions.sql` -- Creates RPC functions for aggregation queries
3. `supabase/migrations/003_enable_rls.sql` -- Enables Row Level Security on all tables (service_role bypasses it)

The schema migrator (`src/lib/db/schemaMigrator.js`) also runs on startup to add any dynamic columns needed by the current config (e.g., new gaming or crypto repo columns).

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
npm run start    # Serves the built SvelteKit app
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

### RPC Functions

Defined in `supabase/migrations/002_rpc_functions.sql`:

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

### Row Level Security

RLS is enabled on all tables via `003_enable_rls.sql`. No permissive policies are defined, so the anon key gets zero access. The backend uses the `service_role` key, which bypasses RLS entirely.

## API Endpoints

Base URL: `/api`

### Health and Stats

| Method | Endpoint        | Description                              |
|--------|-----------------|------------------------------------------|
| GET    | `/api/health`   | Health check with snapshot system status  |
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

Query parameters for history endpoints: `limit`, `start_date`, `end_date`

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

### Admin

| Method | Endpoint                              | Description                                    |
|--------|---------------------------------------|------------------------------------------------|
| GET    | `/api/admin/snapshot-status`          | Snapshot system health and state                |
| GET    | `/api/admin/revenue-status`           | Revenue sync status, block height, tx count    |
| GET    | `/api/admin/test-status`              | Service test scheduler status                  |
| POST   | `/api/admin/revenue-sync`             | Trigger manual revenue sync                    |
| POST   | `/api/admin/clear-revenue-data`       | Delete all transactions and reset sync (destructive) |
| POST   | `/api/admin/reset-revenue-sync`       | Reset sync block to trigger full re-scan       |
| POST   | `/api/admin/backfill-app-types`       | Backfill git/docker app type                   |
| POST   | `/api/admin/backfill-app-names`       | Backfill app names from OP_RETURN data         |
| POST   | `/api/admin/backfill-usd`             | Backfill USD amounts using price history       |
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

## Backup & Resilience

### Automated Backups (Cloudflare R2)

The `daily_snapshots` and `repo_snapshots` tables contain irreplaceable point-in-time data that cannot be re-derived from blockchain or external APIs. Backups protect against data loss if the Supabase instance is lost.

- **Trigger**: Automatically after each successful daily snapshot (fire-and-forget, never blocks the snapshot)
- **Manual**: `POST /api/admin/backup`
- **Storage**: Cloudflare R2 at `backups/{YYYY-MM-DD}/daily_snapshots.json` + `repo_snapshots.json`
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

### Circuit Breaker

States: CLOSED (normal) -> OPEN (DB unreachable, all requests blocked) -> HALF_OPEN (probing with one request)

- Failure threshold: 5 consecutive failures
- Cooldown: 60 seconds before probing

### Health Endpoint

`GET /api/health` returns combined status:

```json
{
  "status": "ok",
  "db": { "status": "connected", "circuit": "CLOSED", "activeInstance": "primary" },
  "snapshot": { "healthy": true, "todaySnapshotExists": true },
  "backup": { "enabled": true, "healthy": true, "lastBackup": 1710720300000, "ageHours": 2.1 }
}
```

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
| `start`              | `node build/index.js`                          | Start production SvelteKit server    |
| `test`               | `vitest run`                                   | Run tests                            |
| `db:migrate-data`    | `node scripts/migrate-sqlite-to-supabase.mjs`  | Migrate data from SQLite to Supabase |
| `db:import-repo-json`| `node scripts/import-repo-json.mjs`            | Import repo snapshot data from JSON  |

### Utility Scripts

| Script                                | Description                                          |
|---------------------------------------|------------------------------------------------------|
| `scripts/migrate-sqlite-to-supabase.mjs` | One-time migration of data from SQLite DB to Supabase |
| `scripts/import-repo-json.mjs`        | Import Docker repo snapshot data from a JSON file    |
| `scripts/apply-rpc-to-cloud.mjs`      | Apply RPC functions to a remote Supabase instance via direct PG connection |
| `scripts/apply-prices-from-csv.mjs`   | Import historical FLUX/USD price data from a CSV file |

## Project Structure

```
src/
  server.js                    # Express API server + scheduler startup
  routes/
    +page.svelte               # Main dashboard page
  lib/
    config.js                  # All configuration (addresses, intervals, categories, API URLs)
    components/                # Svelte components (StatCard, Chart, RevenueTransactions, etc.)
    db/
      database.js              # Adapter router (selects Supabase or SQLite)
      adapters/
        supabaseAdapter.js     # Supabase (PostgreSQL) implementation
        sqliteAdapter.js       # SQLite (better-sqlite3) implementation
      supabaseClient.js        # Supabase client initialization (guarded for SQLite mode)
      schemaMigrator.js        # Dynamic column migrations (both backends)
      snapshotManager.js       # Daily snapshot scheduler + backup trigger
      circuitBreaker.js        # Circuit breaker with auto-failover
      snapshot.js              # Snapshot data access
    services/
      revenueService.js        # Blockchain transaction sync logic
      revenueScheduler.js      # Revenue sync interval manager
      backupService.js         # Cloudflare R2 backup/restore service
      bootstrapService.js      # R2 bootstrap for SQLite mode (first-start data import)
      cloudService.js          # Cloud utilization metrics (CPU, RAM, Storage)
      nodeService.js           # Flux node counts (Cumulus, Nimbus, Stratus)
      gamingService.js         # Gaming app instance tracking
      cryptoService.js         # Crypto node instance tracking
      wordpressService.js      # WordPress instance counting
      priceHistoryService.js   # FLUX/USD price history sync
      carouselService.js       # Carousel feed data (deployed/expiring apps)
      servicesScheduler.js     # Service test and carousel scheduler
supabase/
  migrations/
    001_initial_schema.sql     # Tables, indexes, seed data
    002_rpc_functions.sql      # PostgreSQL RPC functions
    003_enable_rls.sql         # Row Level Security
scripts/                       # One-time utility scripts
Dockerfile                     # Multi-stage production build
startup.sh                     # Container entrypoint (starts both servers)
.env.example                   # Environment variable template
```

## License

This project is maintained by [2ndTLMining](https://github.com/2ndtlmining).
