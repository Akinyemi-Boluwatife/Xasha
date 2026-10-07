import { Hono } from "hono";
import { cors } from "hono/cors";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../types";

export function documentation(getDocument: () => ReturnType<OpenAPIHono["getOpenAPI31Document"]>) {
  const app = new Hono<AppEnv>();
  app.use("/openapi.json", cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"], credentials: false, maxAge: 0 }));
  app.get("/openapi.json", c => c.json(getDocument()));
  app.options("/openapi.json", c => c.body(null, 204));
  return app;
}
