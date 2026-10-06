import { probe } from "./probe.ts";
import { notify } from "./notify.ts";
import type { MonitorBindings } from "./types.ts";
export type { MonitorBindings } from "./types.ts";

type State = { failures: number; notified_down: number };
type Dependencies = { fetch: typeof fetch; now: () => number };

export async function runCheck(
  env: MonitorBindings,
  scheduledAt: number,
  dependencies: Dependencies = { fetch, now: Date.now },
): Promise<void> {
  if (env.MONITOR_MODE === "paused") return;
  if (
    env.MONITOR_MODE !== "active" ||
    !["true", "false"].includes(env.ALERTS_ENABLED) ||
    !Number.isSafeInteger(scheduledAt) ||
    scheduledAt < 0
  )
    throw new Error("Invalid monitor configuration.");
  const target = new URL(env.READINESS_URL);
  if (
    target.protocol !== "https:" ||
    target.pathname !== "/ready" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error("Invalid monitor target.");
  const db = env.MONITOR_DB;
  const lease = crypto.randomUUID();
  try {
    const state = await db
      .prepare(
        `UPDATE monitor_state SET lease_id = ?1, lease_until = ?2
       WHERE singleton = 1 AND lease_until <= ?3 AND last_scheduled_at < ?4
       RETURNING failures, notified_down`,
      )
      .bind(lease, dependencies.now() + 120000, dependencies.now(), scheduledAt)
      .first<State>();
    if (!state) {
      if (
        !(await db
          .prepare("SELECT singleton FROM monitor_state WHERE singleton = 1")
          .first())
      ) {
        throw new Error("Monitoring state missing.");
      }
      return; // Overlapping, duplicate, or out-of-order cron invocation.
    }
    try {
      const result = await probe(target.href, dependencies.fetch);
      const at = dependencies.now();
      const failures = result.ready ? 0 : Math.min(3, state.failures + 1);
      const unavailable = failures >= 3;
      const stored = await db
        .prepare(
          `UPDATE monitor_state SET failures = ?1, unavailable = ?2, last_scheduled_at = ?3,
         last_checked_at = ?4, last_ok_at = CASE WHEN ?5 THEN ?4 ELSE last_ok_at END, last_http_status = ?6
         WHERE singleton = 1 AND lease_id = ?7 AND lease_until > ?4`,
        )
        .bind(
          failures,
          Number(unavailable),
          scheduledAt,
          at,
          Number(result.ready),
          result.status,
          lease,
        )
        .run();
      if (!stored.meta.changes) throw new Error("Monitoring lease expired.");
      const kind =
        unavailable && !state.notified_down
          ? "outage"
          : result.ready && state.notified_down
            ? "recovery"
            : null;
      if (kind && env.ALERTS_ENABLED === "true") {
        try {
          await notify(env, kind, at, dependencies.fetch);
          const deliveredAt = dependencies.now();
          const delivered = await db
            .prepare(
              `UPDATE monitor_state SET notified_down = ?1, last_alert_at = ?2, last_alert_error_at = NULL
             WHERE singleton = 1 AND lease_id = ?3 AND lease_until > ?2`,
            )
            .bind(Number(kind === "outage"), deliveredAt, lease)
            .run();
          if (!delivered.meta.changes)
            throw new Error("Monitoring lease expired.");
        } catch {
          await db
            .prepare(
              "UPDATE monitor_state SET last_alert_error_at = ?1 WHERE singleton = 1 AND lease_id = ?2",
            )
            .bind(dependencies.now(), lease)
            .run();
          throw new Error("Monitoring alert failed.");
        }
      }
    } finally {
      await db
        .prepare(
          "UPDATE monitor_state SET lease_id = NULL, lease_until = 0 WHERE singleton = 1 AND lease_id = ?1",
        )
        .bind(lease)
        .run();
    }
  } catch {
    // Never expose request bodies, webhook credentials, or database diagnostics.
    throw new Error("Monitoring execution failed.");
  }
}
