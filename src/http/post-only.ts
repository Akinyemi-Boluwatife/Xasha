import type { Hono } from "hono";
import type { AppEnv } from "../types";

// Register after the POST handler so other methods cannot perform the action.
export function postOnly(app: Hono<AppEnv>, path: string): void {
  app.options(path, (c) => {
    c.header("Allow", "POST, OPTIONS");
    return c.body(null, 204);
  });
  app.all(path, (c) => {
    c.header("Allow", "POST, OPTIONS");
    return c.json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
    );
  });
}
