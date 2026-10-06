import { Hono } from "hono";
import { isReady } from "../status/readiness";
import { readinessRateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok", service: "xasha" }));

app.get("/ready", readinessRateLimit, async (c) => {
  const ready = await isReady(c.env);
  return c.json(
    { status: ready ? "ready" : "unavailable", service: "xasha" },
    ready ? 200 : 503,
  );
});

export default app;
