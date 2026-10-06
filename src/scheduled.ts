import { cleanupExpired } from "./cleanup";
import type { Bindings } from "./types";

export async function scheduled(
  _event: ScheduledController,
  env: Bindings,
): Promise<void> {
  if (env.SERVICE_MODE === "active") await cleanupExpired(env.DB);
}
