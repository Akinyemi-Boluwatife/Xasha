CREATE TABLE monitor_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 3),
  unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable IN (0, 1)),
  notified_down INTEGER NOT NULL DEFAULT 0 CHECK (notified_down IN (0, 1)),
  last_scheduled_at INTEGER NOT NULL DEFAULT -1,
  last_checked_at INTEGER,
  last_ok_at INTEGER,
  last_http_status INTEGER,
  last_alert_at INTEGER,
  last_alert_error_at INTEGER,
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO monitor_state (singleton) VALUES (1);
