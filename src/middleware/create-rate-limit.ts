import { createMiddleware } from "hono/factory";
import { database } from "../protocol";
import type { AppEnv } from "../types";

export const createRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  // Cloudflare sets this header on incoming requests. Do not use caller-supplied
  // X-Forwarded-For. Missing addresses share one conservative fallback bucket.
  const key = `create:${c.req.header("CF-Connecting-IP") || "unknown"}`;
  const allowed = await database(() => c.env.CREATE_LIMITER.limit({ key }));
  if (!allowed.success) {
    c.header("Retry-After", "60");
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many creation requests. Try again later.",
        },
      },
      429,
    );
  }
  await next();
});
