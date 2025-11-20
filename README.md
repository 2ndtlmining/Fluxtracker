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

### Gaming Applications
- **Minecraft**: Server instances running on Flux
- **Palworld**: Multiplayer server instances
- **Enshrouded**: Game server instances
- **Total Gaming Apps**: Combined count of all gaming applications

### Cryptocurrency Nodes
- **Presearch**: Decentralized search engine nodes
- **Kaspa**: Kaspa blockchain full nodes
- **Alephium**: Alephium blockchain nodes
- **Ravencoin**: RVN full nodes
- **Kadena**: Kadena blockchain nodes
- **Streamr**: Decentralized data streaming nodes
- **Bittensor**: AI/ML network nodes
- **Timpi**: Privacy-focused search nodes (Collector & Geocore)
- **Total Crypto Nodes**: Aggregate of all cryptocurrency nodes

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

### Admin Endpoints
- `POST /api/admin/snapshot` - Trigger manual snapshot
- `POST /api/admin/revenue-sync` - Trigger manual revenue sync
- `GET /api/admin/snapshot-status` - Snapshot system health

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

### Manual Data Sync
```bash
# Trigger revenue sync via API
curl -X POST http://localhost:3000/api/admin/revenue-sync

# Trigger snapshot creation
curl -X POST http://localhost:3000/api/admin/snapshot
```

### Monitoring
- Check `/api/health` for system status
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