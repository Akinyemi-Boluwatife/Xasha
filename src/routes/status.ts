import { createRoute, z } from "@hono/zod-openapi";
import { isReady } from "../status/readiness";
import { readinessRateLimit } from "../middleware/rate-limit";
import { createOpenAPIApp, errorSchema, jsonResponse, rateLimited } from "../openapi";

const app = createOpenAPIApp();
const healthSchema = z.strictObject({ status: z.literal("ok"), service: z.literal("xasha") }).openapi("Health");
const readySchema = z.strictObject({ status: z.literal("ready"), service: z.literal("xasha") }).openapi("Ready");
const unavailableSchema = z.strictObject({ status: z.literal("unavailable"), service: z.literal("xasha") }).openapi("NotReady");

app.openapi(createRoute({
  method: "get", path: "/health", operationId: "health", tags: ["Status"], summary: "Check liveness without querying D1",
  responses: { 200: jsonResponse(healthSchema, "Worker responds."), 415: jsonResponse(errorSchema, "Compressed requests are unsupported.") },
}), (c) => c.json({ status: "ok", service: "xasha" } as const, 200));

app.openapi(createRoute({
  method: "get", path: "/ready", operationId: "readiness", tags: ["Status"], summary: "Check active service and D1 metadata",
  description: "Reads schema and aggregate metadata only; never consumes secrets. GET and HEAD share a 60-request/minute IP budget per Cloudflare location.",
  middleware: [readinessRateLimit] as const,
  responses: {
    200: jsonResponse(readySchema, "Ready."),
    429: rateLimited(),
    415: jsonResponse(errorSchema, "Compressed requests are unsupported."),
    503: jsonResponse(z.union([unavailableSchema, errorSchema]), "Not ready, or limiter failed closed."),
  },
}), async (c) => {
  const ready = await isReady(c.env);
  return ready
    ? c.json({ status: "ready", service: "xasha" } as const, 200)
    : c.json({ status: "unavailable", service: "xasha" } as const, 503);
});

export default app;
