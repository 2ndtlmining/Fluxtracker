# Flux Performance Dashboard

A comprehensive real-time monitoring system for the Flux blockchain network that tracks cloud utilization, revenue metrics, node distribution, gaming applications, and cryptocurrency nodes.

## 🎯 Overview

The Flux Performance Dashboard provides live insights into the Flux decentralized cloud computing network. It monitors resource utilization across the network, tracks revenue streams from the Flux blockchain, and displays running applications including gaming servers and crypto nodes. The dashboard features historical analytics with customizable comparison periods (day, week, month, quarter, year) and a scrolling carousel showcasing top-performing applications.

## 📊 Data We Track

### Cloud Utilization
- **CPU**: Total and used CPU cores across the network with utilization percentage
- **RAM**: Total and used memory (GB) with utilization percentage  
- **Storage**: Total and used disk space (GB) with utilization percentage

### Revenue Metrics
- **Daily Revenue**: FLUX earned from network operations
- **Transaction History**: Detailed record of all revenue transactions with block heights, addresses, and timestamps
- **Payment Counts**: Number of transactions per period
- **USD Conversion**: Real-time FLUX price and USD equivalents

### Node Distribution
- **Cumulus**: Entry-level nodes (2 cores, 8GB RAM, 220GB storage)
- **Nimbus**: Mid-tier nodes (4 cores, 32GB RAM, 440GB storage)
- **Stratus**: Premium nodes (8 cores, 64GB RAM, 880GB storage)
- **Total Nodes**: Aggregate count across all tiers

### Dynamic Category Cards (Gaming, Crypto, WordPress)

The dashboard automatically categorizes Docker images running on the Flux network into categories using keyword matching against the `repo_snapshots` table. The top 3 repos per category are shown on the dashboard cards, with 7-day comparison badges when historical data is available.

Categories are defined in `src/lib/config.js` via `CATEGORY_CONFIG`. Adding a new category or keyword automatically includes matching repos - no code changes to components or services needed.

#### Gaming Applications
Keyword matches: `minecraft`, `palworld`, `enshrouded`, `valheim`, `satisfactory`, `ark-survival`, `rust-server`, `terraria`, `factorio`, `7daystodie`, `vrising`, `projectzomboid`, `conan-exiles`, `game-server`

Currently tracked:
- Minecraft (itzg/minecraft-server, itzg/minecraft-bedrock-server)
- Valheim (mbround18/valheim)
- Satisfactory (wolveix/satisfactory-server)
- Enshrouded (sknnr/enshrouded-dedicated-server)
- Terraria (littlestache/terraria)
- Factorio (factoriotools/factorio)
- Rust (littlestache/rust-server)

#### Cryptocurrency Nodes
Keyword matches: `presearch/node`, `streamr/node`, `streamr/broker-node`, `ravencoin`, `kadena-chainweb`, `alephium-standalone`, `alephium/explorer`, `bittensor`, `subtensor`, `timpi-collector`, `timpi-geocore`, `rusty-kaspad`, `bitcoin-core`, `bitcoin-cash-node`, `litecoin`, `dogecoin`, `zcash`, `monero`, `client-go:stable`, `fironode`, `neoxa-node`, `beldex`, `thornode`, `thorchain`

Currently tracked:
- Presearch (presearch/node)
- Kaspa (kaspanet/rusty-kaspad)
- Timpi Collector & Geocore (timpiltd/timpi-collector, timpiltd/timpi-geocore)
- Streamr (streamr/node, streamr/broker-node)
- Alephium (touilleio/alephium-standalone, alephium/explorer)
- Bitcoin (ruimarinho/bitcoin-core)
- Bitcoin Cash (zquestz/bitcoin-cash-node)
- Ethereum (ethereum/client-go:stable)
- Firo (runonflux/fironode)
- Neoxa (runonflux/neoxa-node)
- Beldex (beldex/beldex-master-node)
- THORChain (thorchain/thornode)

#### WordPress
Keyword matches: `wordpress`, `wp-nginx`

**Important:** Crypto keywords are intentionally specific (e.g., `presearch/node` not just `node`) to avoid false positives from Node.js apps or unrelated images. When adding new keywords, test with: `SELECT DISTINCT image_name FROM repo_snapshots WHERE image_name LIKE '%keyword%'`

#### How categorization works

1. **On snapshot creation**: `createRepoSnapshots()` calls `categorizeImage()` for each Docker image, storing the category in the `repo_snapshots.category` column
2. **Keyword matching**: `categorizeImage()` checks if any keyword is a substring of the image name (case-insensitive)
3. **Display names**: `getDisplayName()` converts Docker image names to clean labels (e.g., `kaspanet/rusty-kaspad:latest` -> `Kaspa`) using an override map with fallback cleanup
4. **Backfill**: On startup, uncategorized rows are automatically backfilled. Manual trigger: `POST /api/admin/backfill-repo-categories`

#### Updating categories

All category configuration lives in a single file: `src/lib/config.js`. No component, database, or service changes are needed.

**Step 1: Check what images exist on the network**

Query uncategorized images to find candidates:
```sql
-- All uncategorized images with instance counts (latest snapshot)
SELECT image_name, instance_count
FROM repo_snapshots
WHERE category IS NULL
  AND snapshot_date = (SELECT MAX(snapshot_date) FROM repo_snapshots)
ORDER BY instance_count DESC;

-- Search for a specific keyword before adding it
SELECT DISTINCT image_name FROM repo_snapshots WHERE image_name LIKE '%keyword%';
```

**Step 2: Edit keywords in `CATEGORY_CONFIG`**

Add keywords to an existing category or create a new one:
```javascript
// src/lib/config.js
export const CATEGORY_CONFIG = {
    gaming: { label: 'Gaming', keywords: [..., 'new-game-server'], icon: 'Gamepad2' },
    crypto: { label: 'Crypto Nodes', keywords: [..., 'new-coin/node'], icon: 'Coins' },
    wordpress: { label: 'WordPress', keywords: [...], icon: 'Globe' },
    // New category example:
    // ai: { label: 'AI/ML', keywords: ['ollama', 'llama', 'stable-diffusion'], icon: 'Brain' }
};
```

**Keyword tips:**
- Be specific: use `presearch/node` not `node` (avoids matching Node.js apps)
- Use image path fragments: `firoorg/firod` or just `firod` depending on uniqueness
- Test with `LIKE '%keyword%'` first to check for false positives
- Keywords are matched case-insensitively as substrings of the full image name

**Step 3: Add a display name override**

Without an override, `org/long-image-name-server:latest` becomes `Long Image Name` (auto-cleaned). Add an override for a cleaner label:
```javascript
// src/lib/config.js
const DISPLAY_NAME_OVERRIDES = {
    // key = image name without tag, value = display label
    'org/new-image-name': 'Clean Name',
    ...
};
```

**Step 4: Re-categorize existing data**

```bash
# This resets NULL categories and applies current keywords
curl -X POST http://YOUR_SERVER/api/admin/backfill-repo-categories
```

Note: this only updates rows where `category IS NULL`. To fully re-categorize after changing keywords (e.g., making a keyword more specific, removing a false positive, or adding a new category), use the full recategorize endpoint instead:
```bash
curl -X POST http://YOUR_SERVER/api/admin/recategorize-repos
```
This resets ALL categories to NULL and re-applies the current keywords from `CATEGORY_CONFIG`. The response shows how many images were categorized per category.

**Step 5: Verify**

```bash
# Check what's in each category now
curl http://YOUR_SERVER/api/metrics/category/gaming/top?limit=10
curl http://YOUR_SERVER/api/metrics/category/crypto/top?limit=10
```

New snapshots (daily or manual via `POST /api/admin/repo-snapshot`) will automatically use the updated keywords. The dashboard cards and charts update immediately with no restart needed.

### Additional Metrics
- **WordPress Instances**: Total WordPress sites hosted on Flux
- **Watchtower Apps**: Network monitoring applications
- **Total Apps**: All applications running across the network

## 🔄 Data Refresh Cycles

### Real-Time Updates
- **Revenue Sync**: Every **5 minutes** via Blockbook API
  - Fetches latest transactions from Flux blockchain
  - Incremental sync from last known block height
  - Filters existing transactions to avoid duplicates (99%+ efficiency)
  
- **Service Health Checks**: Every **60 minutes**
  - Tests all gaming services for availability
  - Validates crypto node endpoints
  - Checks API health and response times

- **Carousel Updates**: Every **60 minutes**
  - Refreshes top running applications
  - Updates benchmark statistics
  - Caches data for 1-hour resilience during API failures

### Frontend Refresh
- **Dashboard Auto-Refresh**: Every **5 minutes** (300 seconds)
  - Current metrics update
  - Revenue data refresh
  - Comparison statistics recalculation

## 📸 Snapshot System

### Daily Snapshots
The system automatically captures complete network state snapshots every day:

- **Timing**: Taken daily after midnight UTC with 5-minute grace period
- **Frequency Check**: System verifies snapshot exists every **30 minutes**
- **Automatic Retry**: If snapshot missing, system attempts to create one

### Snapshot Contents
Each daily snapshot includes:
- Complete revenue metrics for the day
- Cloud utilization statistics (CPU, RAM, Storage)
- Node distribution across all tiers
- Gaming application counts
- Cryptocurrency node counts
- WordPress and app totals
- Timestamp and date metadata

### Storage Duration
- **Snapshots**: Retained indefinitely for historical analysis
- **Transactions**: 365 days (configurable retention policy)

### Manual Snapshots
Administrators can trigger manual snapshots via API:
```bash
POST /api/admin/snapshot
```

## 📈 How Comparisons Work

The dashboard compares current metrics against historical snapshots to show trends and changes over time.

### Comparison Periods

Users can toggle between five comparison timeframes:

| Period | Label | Days | Comparison Point |
|--------|-------|------|-----------------|
| **D** | Day | 1 | Yesterday's snapshot |
| **W** | Week | 7 | Snapshot from 7 days ago |
| **M** | Month | 30 | Snapshot from 30 days ago |
| **Q** | Quarter | 90 | Snapshot from 90 days ago |
| **Y** | Year | 365 | Snapshot from 365 days ago |

### Calculation Method

For each metric, the system calculates:

1. **Absolute Change**: `Current Value - Historical Value`
2. **Percentage Change**: `((Current - Historical) / Historical) × 100`
3. **Trend Direction**: 
   - `up` if current > historical
   - `down` if current < historical  
   - `neutral` if unchanged

### Example: Weekly Node Comparison

**Current State** (Today):
- Cumulus: 10,500 nodes
- Nimbus: 5,200 nodes
- Stratus: 1,800 nodes
- **Total: 17,500 nodes**

**Historical Snapshot** (7 days ago):
- Cumulus: 10,200 nodes
- Nimbus: 5,150 nodes
- Stratus: 1,750 nodes
- **Total: 17,100 nodes**

**Comparison Results**:
```javascript
{
  cumulus: {
    change: +300,           // 10,500 - 10,200
    percentage: +2.94%,     // (300 / 10,200) × 100
    trend: 'up'
  },
  nimbus: {
    change: +50,            // 5,200 - 5,150
    percentage: +0.97%,     // (50 / 5,150) × 100
    trend: 'up'
  },
  stratus: {
    change: +50,            // 1,800 - 1,750
    percentage: +2.86%,     // (50 / 1,750) × 100
    trend: 'up'
  },
  total: {
    change: +400,           // 17,500 - 17,100
    percentage: +2.34%,     // (400 / 17,100) × 100
    trend: 'up'
  }
}
```

### Revenue Comparisons

Revenue comparisons work differently because they use **transaction aggregation** rather than snapshots:

**Example: Monthly Revenue Comparison**

**Current Month** (Nov 1-21):
- Total FLUX earned: 45,230
- USD value: $6,784.50
- Transactions: 1,247

**Previous Month** (Oct 1-31):
- Total FLUX earned: 42,100
- USD value: $6,315.00
- Transactions: 1,189

**Comparison**:
```javascript
{
  flux: {
    amount: 45230,
    change: +7.44%,        // ((45,230 - 42,100) / 42,100) × 100
    trend: 'up'
  },
  payments: {
    count: 1247,
    change: +58,           // 1,247 - 1,189
    trend: 'up'
  }
}
```

### Comparison Caching

To improve performance:
- Comparisons are **cached per period** when first loaded
- Cache is automatically refreshed during dashboard auto-refresh (every 5 minutes)
- All five periods are **prefetched in background** after initial page load
- Manual refresh available via period toggle buttons

### Partial Data Handling

If a historical snapshot doesn't exist for the requested comparison period:
- System returns `partialData: true` flag
- Revenue comparison still works (uses transaction aggregation)
- Other metrics show as unavailable for that period
- Dashboard displays appropriate messaging to user

## 🏗️ Technical Architecture

### Backend (Express.js)
- RESTful API endpoints for metrics, snapshots, and analytics
- SQLite database with WAL mode for concurrent access
- Automated schedulers for revenue sync and snapshot management
- Blockbook API integration for blockchain data
- CORS enabled for domain and IP access

### Frontend (SvelteKit)
- Reactive components with real-time updates
- Chart.js integration for historical analytics
- Responsive design with terminal-style aesthetics
- Purple-themed UI matching Flux branding
- Carousel component with automatic scrolling

### Database Schema
- **daily_snapshots**: Historical network state records
- **revenue_transactions**: Complete transaction history with blockchain data
- **current_metrics**: Real-time network statistics
- **sync_status**: Synchronization state tracking

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Backend Server

```bash
# Start Express API server (default port 3000)
node server.js
```

The backend will automatically:
- Initialize SQLite database
- Start revenue sync scheduler (every 5 minutes)
- Start snapshot checker (every 30 minutes)
- Start service test scheduler (every hour)
- Start carousel update scheduler (every hour)

### Environment Configuration

The system supports both IP address and domain access. Update CORS settings in `server.js`:

```javascript
const corsOptions = {
    origin: [
        'http://localhost:5173',                      // Development
        'http://your-ip:37000',                       // Production IP
        'http://your-domain.app.runonflux.io',        // Production Domain
    ]
};
```

## 📡 API Endpoints

### Core Endpoints
- `GET /api/health` - System health check with snapshot status
- `GET /api/metrics/current` - Current network metrics
- `GET /api/stats` - Full statistics including revenue
- `GET /api/analytics/comparison?period=D|W|M|Q|Y` - Period comparisons

### Revenue Endpoints
- `GET /api/revenue/transactions?page=1&limit=50` - Paginated transaction history
- `GET /api/revenue/daily?days=30` - Daily revenue aggregation

### History Endpoints
- `GET /api/history/snapshots?limit=30` - Recent snapshots
- `GET /api/history/range?start=YYYY-MM-DD&end=YYYY-MM-DD` - Date range query
- `GET /api/history/repos/list` - All distinct Docker images in repo_snapshots
- `GET /api/history/repos/history?image=NAME&limit=90` - History for a specific image
- `GET /api/history/repos/latest` - Latest snapshot for all repos

### Category Endpoints (Dynamic)
- `GET /api/metrics/category/:category/top?limit=3` - Top N repos for a category with 7-day comparison
- `GET /api/history/category/:category?limit=90` - Aggregated daily totals for a category (for charts)
- `GET /api/history/category/:category/repos` - List all repos in a category

### Admin Endpoints
- `GET /api/admin/revenue-status` - Revenue sync scheduler health and transaction count
- `GET /api/admin/snapshot-status` - Snapshot system health
- `GET /api/admin/test-status` - Service test scheduler status
- `POST /api/admin/revenue-sync` - Trigger manual revenue sync
- `POST /api/admin/reset-revenue-sync` - Reset sync block pointer (triggers full history re-scan next cycle)
- `POST /api/admin/clear-revenue-data` - **Destructive** — wipe all transactions and force full resync
- `POST /api/admin/backfill-app-names` - Backfill missing app names for transactions with `app_name = NULL`
- `POST /api/admin/backfill-app-types` - Backfill missing app types (git/docker) for known app names
- `POST /api/admin/backfill` - Regenerate daily snapshots from transaction data (last 365 days)
- `POST /api/admin/snapshot` - Trigger manual daily snapshot
- `POST /api/admin/repo-snapshot` - Trigger manual repo snapshot
- `POST /api/admin/backfill-repo-categories` - Categorize repo_snapshots rows where category is NULL
- `POST /api/admin/recategorize-repos` - Full reset + re-categorize ALL repo_snapshots using current keywords
- `POST /api/admin/test-services` - Manually trigger service health tests

### Carousel Endpoint
- `GET /api/carousel/stats` - Top running applications with caching

## 🎨 Features

- **Real-time Monitoring**: Live metrics updating every 5 minutes
- **Historical Analytics**: Interactive charts showing trends over time
- **Flexible Comparisons**: Compare against D/W/M/Q/Y time periods
- **Transaction Browser**: Searchable, paginated revenue transaction history
- **Carousel Display**: Rotating showcase of top applications and benchmarks
- **Responsive Design**: Mobile-friendly interface
- **Terminal Aesthetics**: Developer-friendly UI with purple Flux theming
- **Auto-Recovery**: Resilient schedulers with failure detection
- **Data Validation**: Snapshot verification before storage
- **Efficient Syncing**: Incremental blockchain sync minimizes API calls

## 🔧 Maintenance

### Database Backups
```bash
# Backup database
cp data/flux-performance.db data/flux-performance.db.backup

# Check integrity
sqlite3 data/flux-performance.db "PRAGMA integrity_check;"
```

### Admin Operations

Replace `YOUR_SERVER` with the actual host (e.g. `192.168.10.30:5173` for prod, `localhost:5173` locally).

#### Check status
```bash
# Revenue sync health — last run time, in-progress flag, transaction count
curl http://YOUR_SERVER/api/admin/revenue-status

# Snapshot system health
curl http://YOUR_SERVER/api/admin/snapshot-status
```

#### Trigger a manual revenue sync
Runs the same sync as the automatic 5-minute cycle immediately.
```bash
curl -X POST http://YOUR_SERVER/api/admin/revenue-sync
```

#### Backfill missing app names
Transactions are saved as soon as they appear on-chain. If the permanentmessages API hasn't indexed the app yet at that moment, the transaction lands with `app_name = NULL`. This endpoint re-fetches those transactions and resolves the name.

The auto-sync already handles recent rows (last 30 days, 100 per cycle). Use this endpoint to process a large backlog or historical data. Run multiple times until `remaining` reaches 0 or stops decreasing.

Transactions with no OP_RETURN (direct FLUX payments, not app payments) will stay NULL — that is correct behaviour and they are counted as `noHash` in the response.
```bash
# Default batch (500 rows, all NULL rows regardless of age)
curl -X POST http://YOUR_SERVER/api/admin/backfill-app-names \
  -H "Content-Type: application/json"

# Larger batch to clear a backlog faster (max 2000 per call)
curl -X POST http://YOUR_SERVER/api/admin/backfill-app-names \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 2000}'
```

#### Backfill missing app types (git vs docker)
Fills in `app_type` for transactions that have an `app_name` but no type yet. Safe to run any time.
```bash
curl -X POST http://YOUR_SERVER/api/admin/backfill-app-types
```

#### Backfill historical snapshots
Regenerates daily snapshot records from existing transaction data for the past 365 days. Use if snapshot history has gaps.
```bash
curl -X POST http://YOUR_SERVER/api/admin/backfill
```

#### Trigger a manual snapshot
Creates a daily snapshot for today using current metrics.
```bash
curl -X POST http://YOUR_SERVER/api/admin/snapshot
```

#### Reset sync block (re-scan from history start)
Clears the last-synced block pointer so the next cycle re-scans from the configured lookback window. Does **not** delete any data — it just forces a wider scan next time. Use if you suspect gaps in transaction history.
```bash
curl -X POST http://YOUR_SERVER/api/admin/reset-revenue-sync

# Then trigger an immediate sync to kick it off now
curl -X POST http://YOUR_SERVER/api/admin/revenue-sync
```

#### Clear all revenue data (destructive)
Deletes every revenue transaction and resets sync state to zero. The next sync cycle re-imports all history. Use only as a last resort (corrupted data, clean-slate needed).
```bash
curl -X POST http://YOUR_SERVER/api/admin/clear-revenue-data
```

### Monitoring
- Check `/api/health` for overall system status
- Monitor console logs for sync failures (3+ consecutive = alert)
- Verify daily snapshots exist via `/api/admin/snapshot-status`

## 📝 Logging Configuration

Logging can be configured in `server.js`:

```javascript
const LOGGING_CONFIG = {
    enableRequestLogging: true,      // Master switch
    logHealthChecks: false,          // Skip /health endpoints
    logStatsEndpoints: false,        // Skip /stats endpoints
    logMetricsEndpoints: false,      // Skip /metrics endpoints
    logComparisonEndpoints: false,   // Skip /comparison endpoints
    logHistoryEndpoints: true,       // Log history queries
    logAdminEndpoints: true,         // Always log admin actions
    logErrorsOnly: false             // Only log errors (overrides above)
};
```

## 🐛 Troubleshooting

### Snapshots Not Creating
- Check snapshot status: `GET /api/admin/snapshot-status`
- Verify snapshot checker is running (should log every 30 minutes)
- Check for validation failures in logs
- Ensure metrics are available from external APIs

### Revenue Sync Issues
- Check revenue status: `GET /api/admin/revenue-status`  
- Verify Blockbook API is accessible
- Check for consecutive failures (3+ indicates problem)
- Review last synced block height

### Comparison Data Missing
- Verify historical snapshots exist for requested period
- Check if snapshot exists for target date: `GET /api/history/snapshot/{date}`
- Revenue comparisons should still work (uses transactions)
- Consider running backfill if snapshots are missing

## 📄 License

This project is built for monitoring the Flux blockchain network.

## 🙏 Acknowledgments

- Flux blockchain network and APIs
- Blockbook blockchain explorer
- SvelteKit framework
- Chart.js visualization library