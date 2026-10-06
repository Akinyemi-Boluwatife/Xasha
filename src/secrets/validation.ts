import { decodedLength, invalid, object } from "../protocol";

export function validateCreation(value: unknown) {
  const body = object(value, ["envelope", "expiresIn"]);
  const envelope = object(body.envelope, ["version", "iv", "ciphertext"]);
  if (envelope.version !== 1 || decodedLength(envelope.iv) !== 12)
    throw invalid();
  const length = decodedLength(envelope.ciphertext);
  if (length < 17) throw invalid();
  const expiresIn = body.expiresIn === undefined ? 86400 : body.expiresIn;
  if (
    typeof expiresIn !== "number" ||
    ![3600, 86400, 604800].includes(expiresIn)
  )
    throw invalid();

  return {
    envelope: {
      version: 1,
      iv: envelope.iv as string,
      ciphertext: envelope.ciphertext as string,
    },
    expiresIn,
  };
}

export function validateDeleteToken(value: unknown): string {
  const body = object(value, ["deleteToken"]);
  if (
    typeof body.deleteToken !== "string" ||
    body.deleteToken.length !== 43 ||
    decodedLength(body.deleteToken) !== 32
  ) throw invalid();
  return body.deleteToken;
}
