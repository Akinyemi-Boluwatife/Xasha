import { createMiddleware } from "hono/factory";
import { invalid, jsonBody, readBody } from "../protocol";
import type { AppEnv } from "../types";

export const boundedJson = createMiddleware<AppEnv>(async (c, next) => {
  // Preserve streaming limits and strict UTF-8 before OpenAPI's JSON validator.
  // Hono's public body cache lets that validator reuse the already bounded parse.
  c.req.bodyCache.json = Promise.resolve(await jsonBody(c.req.raw));
  await next();
});
export const emptyBody = createMiddleware<AppEnv>(async (c, next) => {
  if ((await readBody(c.req.raw)).length) throw invalid();
  await next();
});
