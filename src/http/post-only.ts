import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { errorSchema, jsonResponse, secretHeaders } from "../openapi";
import type { AppEnv } from "../types";

// Register after the POST handler so other methods cannot perform the action.
export function postOnly(app: OpenAPIHono<AppEnv>, path: string): void {
  app.openapi(createRoute({
    method: "options", path: path.replace(/:id/g, "{id}"), tags: ["Secrets"],
    summary: "Side-effect-free browser preflight",
    ...(path.includes(":id") ? { parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const } }] } : {}),
    responses: {
      204: { description: "No mutation or rate-limit budget spent. Allowed preflight permits POST and Content-Type without credentials.", headers: secretHeaders },
      403: jsonResponse(errorSchema, "Origin or requested preflight method/headers are not allowed.", secretHeaders),
      415: jsonResponse(errorSchema, "Compressed requests are unsupported.", secretHeaders),
      503: jsonResponse(errorSchema, "Invalid configuration or maintenance.", secretHeaders),
    },
  }), (c) => {
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
