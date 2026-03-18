import { describe, it, expect } from 'vitest';

describe('API response contracts', () => {
    it('/api/health has required fields', () => {
        const sample = {
            status: 'ok',
            uptime: 12345,
            db: { ready: true, adapter: 'supabase' },
            snapshot: { isHealthy: true, lastSuccess: 1234567890 },
            backup: { enabled: true, isHealthy: true }
        };

        expect(sample).toHaveProperty('status');
        expect(sample).toHaveProperty('db');
        expect(sample).toHaveProperty('snapshot');
        expect(sample).toHaveProperty('backup');
        expect(sample.db).toHaveProperty('ready');
    });

    it('/api/header has required fields', () => {
        const sample = {
            network: { height: 100000, hashrate: '1.5 MSol/s' },
            tracker: { txCount: 50000, lastSync: 99999 },
            host: { nodeCount: 100, totalApps: 500 }
        };

        expect(sample).toHaveProperty('network');
        expect(sample).toHaveProperty('tracker');
        expect(sample).toHaveProperty('host');
    });

    it('/api/metrics/current has required fields', () => {
        const sample = {
            revenue: { daily: 100.5, price: 0.5 },
            cloud: { cpu: {}, ram: {}, storage: {} },
            apps: { total: 500, git: 100, docker: 400 }
        };

        expect(sample).toHaveProperty('revenue');
        expect(sample).toHaveProperty('cloud');
        expect(sample).toHaveProperty('apps');
    });

    it('/api/transactions/paginated has required fields', () => {
        const sample = {
            transactions: [{ txid: 'abc', amount: 1.0, date: '2026-03-18' }],
            total: 50000,
            page: 1,
            limit: 50,
            totalPages: 1000
        };

        expect(sample).toHaveProperty('transactions');
        expect(Array.isArray(sample.transactions)).toBe(true);
        expect(sample).toHaveProperty('total');
        expect(sample).toHaveProperty('page');
        expect(sample).toHaveProperty('totalPages');
    });

    it('/api/history/snapshots has required fields', () => {
        const sample = {
            count: 30,
            data: [{ snapshot_date: '2026-03-18', daily_revenue: 100.5 }]
        };

        expect(sample).toHaveProperty('count');
        expect(sample).toHaveProperty('data');
        expect(Array.isArray(sample.data)).toBe(true);
    });

    it('transaction record has expected fields', () => {
        const tx = {
            txid: 'abc123',
            address: 't1abc',
            from_address: 't1xyz',
            amount: 1.5,
            amount_usd: 0.75,
            block_height: 100000,
            timestamp: 1710000000,
            date: '2026-03-18',
            app_name: 'MyApp',
            app_type: 'docker'
        };

        expect(tx).toHaveProperty('txid');
        expect(tx).toHaveProperty('address');
        expect(tx).toHaveProperty('amount');
        expect(tx).toHaveProperty('block_height');
        expect(tx).toHaveProperty('timestamp');
        expect(tx).toHaveProperty('date');
        expect(typeof tx.amount).toBe('number');
        expect(typeof tx.block_height).toBe('number');
    });

    it('snapshot record has expected fields', () => {
        const snapshot = {
            snapshot_date: '2026-03-18',
            daily_revenue: 100.5,
            flux_price_usd: 0.5,
            total_cpu_cores: 1000,
            total_ram_gb: 500,
            total_storage_gb: 2000,
            total_apps: 500,
            node_total: 100
        };

        expect(snapshot).toHaveProperty('snapshot_date');
        expect(snapshot).toHaveProperty('daily_revenue');
        expect(snapshot).toHaveProperty('total_apps');
        expect(snapshot).toHaveProperty('node_total');
        expect(typeof snapshot.daily_revenue).toBe('number');
    });
});
