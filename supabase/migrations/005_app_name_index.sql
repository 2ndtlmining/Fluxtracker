-- Index on app_name to speed up getUndeterminedAppNames, updateAppTypeForAppName, getAppAnalytics
CREATE INDEX IF NOT EXISTS idx_rt_app_name ON revenue_transactions(app_name);
