import type { ErrorHandler, NotFoundHandler } from "hono";
import { ApiError } from "../protocol";
import type { AppEnv } from "../types";

export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof ApiError)
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  // Do not log request paths, bodies, credentials, or database error details.
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    },
    500,
  );
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
