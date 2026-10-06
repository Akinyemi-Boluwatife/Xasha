import { createMiddleware } from "hono/factory";
import { ApiError } from "../protocol";
import type { AppEnv } from "../types";

export const requireActiveService = createMiddleware<AppEnv>(
  async (c, next) => {
    // Fail closed for missing or invalid configuration; health remains available.
    if (c.env.SERVICE_MODE !== "active") {
      throw new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        "The service is temporarily unavailable.",
      );
    }
    await next();
  },
);
