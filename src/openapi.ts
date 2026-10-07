import { OpenAPIHono, z } from "@hono/zod-openapi";
import { invalid } from "./protocol";
import type { AppEnv } from "./types";

export function createOpenAPIApp() {
  return new OpenAPIHono<AppEnv>({ defaultHook: result => { if (!result.success) throw invalid(); } });
}

export const errorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
}).openapi("Error");
export const cacheHeaders = {
  "Cache-Control": { description: "All responses prohibit caching.", schema: { type: "string" as const, enum: ["no-store"] } },
};
export const secretHeaders = {
  ...cacheHeaders,
  "Access-Control-Allow-Origin": {
    description: "Hosted public CORS; earlier policy rejections may omit this header.",
    schema: { type: "string" as const, enum: ["*"] },
  },
};
type ResponseHeaders = Record<string, { description?: string; schema: { type: "string"; enum?: string[] } }>;
export function jsonResponse<S extends z.ZodType>(schema: S, description: string, headers: ResponseHeaders = cacheHeaders) {
  return { description, headers, content: { "application/json": { schema } } };
}
export function rateLimited(headers: ResponseHeaders = cacheHeaders) {
  return jsonResponse(errorSchema, "RATE_LIMITED: IP budget exhausted before database access. No secret mutation.", {
    ...headers, "Retry-After": { description: "Currently 60 seconds.", schema: { type: "string" as const } },
  });
}
export const secretErrors = {
  400: jsonResponse(errorSchema, "INVALID_REQUEST: invalid JSON, fields, or encoding.", secretHeaders),
  403: jsonResponse(errorSchema, "ORIGIN_NOT_ALLOWED on restricted deployments.", secretHeaders),
  405: jsonResponse(errorSchema, "METHOD_NOT_ALLOWED for unsupported methods.", {
    ...secretHeaders, Allow: { schema: { type: "string" as const, enum: ["POST, OPTIONS"] } },
  }),
  413: jsonResponse(errorSchema, "PAYLOAD_TOO_LARGE: JSON exceeds 49152 bytes or ciphertext exceeds 32784 decoded bytes.", secretHeaders),
  415: jsonResponse(errorSchema, "UNSUPPORTED_MEDIA_TYPE: use uncompressed application/json.", secretHeaders),
  429: rateLimited(secretHeaders),
  500: jsonResponse(errorSchema, "INTERNAL_ERROR: fixed message without internal details.", secretHeaders),
  503: jsonResponse(errorSchema, "SERVICE_UNAVAILABLE: dependency failure, maintenance, invalid configuration, or capacity exhaustion.", secretHeaders),
};
export const openAPIConfiguration = {
  openapi: "3.1.2",
  info: {
    title: "Xasha API", version: "1.0.0",
    description: "Account-free, one-time encrypted text sharing. Never send plaintext or encryption keys. Never automatically retry consumption. Public secret routes allow any browser origin without credentials. Opening a client share page must not consume a secret.",
    license: { name: "ISC", identifier: "ISC" },
  },
  servers: [{ url: "https://api.xasha.site", description: "Hosted service" }],
  security: [],
  tags: [{ name: "Secrets", description: "Create, retrieve once, and privately delete encrypted text." }, { name: "Status" }],
};
