import { createRoute } from "@hono/zod-openapi";
import { invalid } from "../protocol";
import { postOnly } from "../http/post-only";
import { accessRateLimit, createRateLimit } from "../middleware/rate-limit";
import { createSecret, consumeSecret, deleteSecret } from "../secrets/actions";
import { deleteUnavailable, unavailable } from "../secrets/responses";
import { createRequestSchema, createResponseSchema, consumeResponseSchema, deleteRequestSchema, secretParamsSchema } from "../secrets/schemas";
import { boundedJson, emptyBody } from "../middleware/request-body";
import { createOpenAPIApp, errorSchema, jsonResponse, secretErrors, secretHeaders } from "../openapi";

const app = createOpenAPIApp();

app.openapi(createRoute({
  method: "post", path: "/", operationId: "createSecret", tags: ["Secrets"],
  summary: "Create an encrypted secret", description: "Encrypt locally. Send only the envelope and expiry; never send plaintext or keys. Creation is not idempotent.",
  middleware: [createRateLimit, boundedJson] as const,
  request: { body: { required: true, content: { "application/json": { schema: createRequestSchema } } } },
  responses: { ...secretErrors, 201: jsonResponse(createResponseSchema, "Created. The private deletion token is returned once.", secretHeaders) },
}), async (c) => {
  const { envelope, expiresIn } = c.req.valid("json");
  return c.json(await createSecret(c.env, envelope, expiresIn), 201);
});

app.openapi(createRoute({
  method: "post", path: "/{id}/consume", operationId: "consumeSecret", tags: ["Secrets"],
  summary: "Retrieve an encrypted secret once", description: "Send no request body. Call only on an explicit reveal action. Never automatically retry: delivery or decryption can fail after irreversible consumption.",
  middleware: [accessRateLimit, emptyBody] as const,
  request: { params: secretParamsSchema },
  responses: { ...secretErrors, 200: jsonResponse(consumeResponseSchema, "Retrieved and atomically removed.", secretHeaders), 404: jsonResponse(errorSchema, "SECRET_UNAVAILABLE: used, expired, deleted, missing, or malformed reference.", secretHeaders) },
}), async (c) => {
  const { id } = c.req.valid("param");
  const envelope = await consumeSecret(c.env.DB, id);
  return envelope ? c.json({ envelope }, 200) : c.json(unavailable, 404);
}, (result, c) => {
  if (!result.success) return c.json(unavailable, 404);
});

app.openapi(createRoute({
  method: "post", path: "/{id}/delete", operationId: "deleteSecret", tags: ["Secrets"],
  summary: "Delete using a private token", description: "Require explicit confirmation. Send the private deletion token only in the JSON body. Deletion cannot recall a completed retrieval.",
  middleware: [accessRateLimit, boundedJson] as const,
  request: { params: secretParamsSchema, body: { required: true, content: { "application/json": { schema: deleteRequestSchema } } } },
  responses: { ...secretErrors, 204: { description: "This request deleted the available secret.", headers: secretHeaders }, 404: jsonResponse(errorSchema, "DELETE_UNAVAILABLE: unavailable secret or incorrect well-formed token.", secretHeaders) },
}), async (c) => {
  const { deleteToken } = c.req.valid("json");
  const { id } = c.req.valid("param");
  const deleted = await deleteSecret(c.env.DB, id, deleteToken);
  return deleted ? c.body(null, 204) : c.json(deleteUnavailable, 404);
}, (result, c) => {
  if (result.success) return;
  if (result.target === "param") {
    // Preserve body validation before disclosing the uniform invalid-ID result.
    return (async () => {
      if (!deleteRequestSchema.safeParse(await c.req.json()).success) throw invalid();
      return c.json(deleteUnavailable, 404);
    })();
  }
  throw invalid();
});

for (const path of ["/", "/:id/consume", "/:id/delete"]) {
  postOnly(app, path);
}

export default app;
