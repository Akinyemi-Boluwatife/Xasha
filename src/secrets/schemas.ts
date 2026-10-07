import { z } from "@hono/zod-openapi";
import { decodedLength } from "../protocol";

const base64url = "^[A-Za-z0-9_-]+$";
function encodedBytes(min: number, max: number, minLength: number, maxLength: number) {
  return z.string().superRefine((value, context) => {
    const length = decodedLength(value);
    if (length < min || length > max)
      context.addIssue({ code: "custom", message: "Invalid encoded length." });
  }).openapi({ pattern: base64url, minLength, maxLength, description: "Canonical, unpadded base64url." });
}

export const secretIdSchema = z.string().length(32).regex(/^[A-Za-z0-9_-]+$/).openapi("SecretId");
export const secretParamsSchema = z.object({ id: secretIdSchema });
export const deleteTokenSchema = z.string().length(43).refine(value => decodedLength(value) === 32)
  .openapi("DeleteToken", { pattern: base64url, description: "Private deletion credential, sent only in the JSON body." });
export const envelopeSchema = z.strictObject({
  version: z.literal(1),
  iv: encodedBytes(12, 12, 16, 16),
  ciphertext: encodedBytes(17, 32784, 23, 43712),
}).openapi("Envelope", { description: "AES-256-GCM ciphertext with appended 128-bit tag; fresh 12-byte IV. No plaintext or encryption key." });
export const createRequestSchema = z.strictObject({
  envelope: envelopeSchema,
  expiresIn: z.union([z.literal(3600), z.literal(86400), z.literal(604800)]).default(86400),
}).openapi("CreateRequest");
export const createResponseSchema = z.strictObject({
  id: secretIdSchema,
  deleteToken: deleteTokenSchema,
  expiresAt: z.iso.datetime(),
}).openapi("CreateResponse");
export const consumeResponseSchema = z.strictObject({ envelope: envelopeSchema }).openapi("ConsumeResponse");
export const deleteRequestSchema = z.strictObject({ deleteToken: deleteTokenSchema }).openapi("DeleteRequest");
