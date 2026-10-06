CREATE TABLE storage_usage (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  secret_count INTEGER NOT NULL CHECK(secret_count >= 0),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes >= 0)
) STRICT;

-- Budget stored envelope/credential bytes, plus 16 bytes for timestamps.
INSERT INTO storage_usage
SELECT 1, COUNT(*), COALESCE(SUM(length(ciphertext) + 128), 0) FROM secrets;

CREATE TRIGGER secrets_usage_insert AFTER INSERT ON secrets BEGIN
  UPDATE storage_usage SET secret_count = secret_count + 1,
    payload_bytes = payload_bytes + length(NEW.ciphertext) + 128 WHERE singleton = 1;
END;

CREATE TRIGGER secrets_usage_delete AFTER DELETE ON secrets BEGIN
  UPDATE storage_usage SET secret_count = secret_count - 1,
    payload_bytes = payload_bytes - length(OLD.ciphertext) - 128 WHERE singleton = 1;
END;

CREATE TRIGGER secrets_usage_update AFTER UPDATE OF ciphertext ON secrets BEGIN
  UPDATE storage_usage SET payload_bytes = payload_bytes + length(NEW.ciphertext) - length(OLD.ciphertext)
  WHERE singleton = 1;
END;
