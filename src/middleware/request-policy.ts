import { createMiddleware } from "hono/factory";
import { ApiError } from "../protocol";
import type { AppEnv } from "../types";

export const requestPolicy = createMiddleware<AppEnv>(async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    c.req.header("Content-Encoding") &&
    c.req.header("Content-Encoding") !== "identity"
  ) {
    throw new ApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Compressed requests are unsupported.",
    );
  }
  await next();
});
