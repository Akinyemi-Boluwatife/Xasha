import { Hono } from "hono";
import { invalid, jsonBody, readBody } from "../protocol";
import { postOnly } from "../http/post-only";
import { createRateLimit } from "../middleware/create-rate-limit";
import { createSecret, consumeSecret, deleteSecret } from "../secrets/actions";
import { deleteUnavailable, unavailable, validId } from "../secrets/responses";
import { validateCreation, validateDeleteToken } from "../secrets/validation";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.post("/", createRateLimit, async (c) => {
  const { envelope, expiresIn } = validateCreation(await jsonBody(c.req.raw));
  return c.json(await createSecret(c.env, envelope, expiresIn), 201);
});

app.post("/:id/consume", async (c) => {
  if ((await readBody(c.req.raw)).length) throw invalid();
  const id = c.req.param("id");
  if (!validId(id)) return c.json(unavailable, 404);
  const envelope = await consumeSecret(c.env.DB, id);
  return envelope ? c.json({ envelope }) : c.json(unavailable, 404);
});

app.post("/:id/delete", async (c) => {
  const deleteToken = validateDeleteToken(await jsonBody(c.req.raw));
  const id = c.req.param("id");
  if (!validId(id)) return c.json(deleteUnavailable, 404);
  const deleted = await deleteSecret(c.env.DB, id, deleteToken);
  return deleted ? c.body(null, 204) : c.json(deleteUnavailable, 404);
});

for (const path of ["/", "/:id/consume", "/:id/delete"]) {
  postOnly(app, path);
}

export default app;
