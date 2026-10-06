import { createMiddleware } from "hono/factory";
import { database } from "../protocol";
import type { AppEnv } from "../types";

function rateLimit(
  binding: "CREATE_LIMITER" | "ACCESS_LIMITER" | "READINESS_LIMITER",
  action: string,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Cloudflare sets this header. Never trust caller-supplied X-Forwarded-For.
    // Missing addresses share a conservative fallback bucket.
    const key = `${action}:${c.req.header("CF-Connecting-IP") || "unknown"}`;
    const allowed = await database(() => c.env[binding].limit({ key }));
    if (!allowed.success) {
      c.header("Retry-After", "60");
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } },
        429,
      );
    }
    await next();
  });
}

export const createRateLimit = rateLimit("CREATE_LIMITER", "create");
export const accessRateLimit = rateLimit("ACCESS_LIMITER", "access");
export const readinessRateLimit = rateLimit("READINESS_LIMITER", "ready");
