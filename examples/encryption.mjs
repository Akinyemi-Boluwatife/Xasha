// Envelope interoperability example. No storage, logging, or network calls.
const encode = bytes => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid base64url encoding.')
  }
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  if (encode(bytes) !== value) throw new Error('Invalid base64url encoding.')
  return bytes
}

export async function encryptText(text) {
  if (typeof text !== 'string') throw new Error('Expected text.')
  const plaintext = new TextEncoder().encode(text)
  if (plaintext.length < 1 || plaintext.length > 32768) throw new Error('Text must be 1–32768 UTF-8 bytes.')
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext)
  return {
    envelope: { version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) },
    keyFragment: encode(new Uint8Array(await crypto.subtle.exportKey('raw', key))),
  }
}

export async function decryptText(envelope, keyFragment) {
  if (envelope?.version !== 1) throw new Error('Unsupported envelope version.')
  const rawKey = decode(keyFragment)
  const iv = decode(envelope.iv)
  const ciphertext = decode(envelope.ciphertext)
  if (rawKey.length !== 32 || iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > 32784) {
    throw new Error('Invalid envelope or key size.')
  }
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext)
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
}
