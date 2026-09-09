// Admin: failover switching + Cloudflare R2 backup/restore. Sub-router of
// src/routes/api/admin.js (mounted with no extra prefix -- final paths are /api/admin/*).
import express from 'express';

import { switchToFailover, getActiveInstanceName, hasFailover } from '../../../lib/db/supabaseClient.js';
import { getCircuitState } from '../../../lib/db/circuitBreaker.js';
import { isBackupEnabled, getBackupStatus, performBackup, listBackups, restoreFromBackup } from '../../../lib/services/backupService.js';

const router = express.Router();

// ============================================
// FAILOVER ADMIN ENDPOINT
// ============================================
router.post('/failover', (req, res) => {
    if (!hasFailover()) {
        return res.status(400).json({
            success: false,
            reason: 'No failover instance configured. Set SUPABASE_FAILOVER_URL and SUPABASE_FAILOVER_KEY.'
        });
    }
    const result = switchToFailover();
    res.json(result);
});

router.get('/failover-status', (_req, res) => {
    res.json({
        activeInstance: getActiveInstanceName(),
        failoverConfigured: hasFailover(),
        circuit: getCircuitState()
    });
});

// ============================================
// BACKUP ENDPOINTS
// ============================================

router.get('/backup-status', (_req, res) => {
    res.json(getBackupStatus());
});

router.post('/backup', async (_req, res) => {
    if (!isBackupEnabled()) {
        return res.status(400).json({ enabled: false, error: 'Backup not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.' });
    }
    const result = await performBackup();
    res.status(result.success ? 200 : 500).json(result);
});

router.get('/backups', async (_req, res) => {
    const result = await listBackups();
    res.status(result.success ? 200 : 500).json(result);
});

router.post('/restore', async (req, res) => {
    const { date } = req.body || {};
    if (!date) {
        return res.status(400).json({ success: false, error: 'Missing "date" in request body (YYYY-MM-DD)' });
    }
    const result = await restoreFromBackup(date);
    res.status(result.success ? 200 : 500).json(result);
});

export default router;
