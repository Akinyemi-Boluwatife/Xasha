export type MonitorBindings = {
  MONITOR_DB: D1Database;
  READINESS_URL: string;
  MONITOR_MODE: string;
  ALERTS_ENABLED: string;
  WEBHOOK_FORMAT: string;
  ALERT_WEBHOOK_URL?: string;
};
