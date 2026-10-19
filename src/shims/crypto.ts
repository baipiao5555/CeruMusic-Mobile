// Browser shim for the subset of node:crypto used by @shiqianjiang/ceru-plugin-issuer.
// Reading/verification works synchronously with noble; signing is intentionally unsupported.
import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'
import { ed25519 } from '@noble/curves/ed25519'

function toBytes(value: any): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('Unsupported crypto input')
}

class Hash {
  private hash: any

  constructor(algorithm: string) {
    const name = algorithm.toLowerCase()
    // Manifest integrity is defined as SHA-256; weak legacy digests are rejected.
    if (name === 'sha256') this.hash = sha256.create()
    else throw new Error('Unsupported digest: ' + algorithm)
  }

  update(data: any) {
    this.hash.update(toBytes(data))
    return this
  }

  digest(encoding?: string) {
    const out = Buffer.from(this.hash.digest())
    return encoding === 'hex' ? out.toString('hex') : out
  }
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return Uint8Array.from(Buffer.from(body, 'base64'))
}

function rawPublicKey(der: Uint8Array): Uint8Array {
  if (der.length === 32) return der
  // Ed25519 SubjectPublicKeyInfo: 12-byte header followed by the 32-byte key.
  if (der.length === 44) return der.slice(12)
  if (der.length > 12) return der.slice(der.length - 32)
  return der
}

export function createHash(algorithm: string) {
  return new Hash(algorithm)
}

export function createPublicKey(input: any): any {
  let der: Uint8Array
  if (typeof input === 'string') der = pemToDer(input)
  else if (input && typeof input === 'object' && input.key) {
    const key = input.key
    der = typeof key === 'string' ? pemToDer(key) : toBytes(key)
  } else if (input instanceof Uint8Array) der = input
  else throw new Error('Unsupported public key input')
  const derBuffer = Buffer.from(der)
  return {
    type: 'public',
    asymmetricKeyType: 'ed25519',
    der,
    raw: rawPublicKey(der),
    export(options?: { type?: string; format?: string }) {
      if (options?.type === 'spki' && options?.format === 'der') return derBuffer
      if (options?.type === 'spki' && options?.format === 'pem') {
        const body = derBuffer.toString('base64').replace(/(.{64})/g, '$1\n')
        return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
      }
      throw new Error('Unsupported public key export')
    }
  }
}

export function createPrivateKey(_input: any): any {
  throw new Error('Private key operations are not available in the mobile client')
}

export function verify(_algorithm: any, data: any, key: any, signature: any): boolean {
  try {
    return ed25519.verify(toBytes(signature), toBytes(data), key.raw ?? rawPublicKey(toBytes(key.der)))
  } catch {
    return false
  }
}

export function sign(): never {
  throw new Error('Signing is not available in the mobile client')
}

export function generateKeyPairSync(): never {
  throw new Error('Key generation is not available in the mobile client')
}

export function randomUUID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default {
  createHash,
  createPublicKey,
  createPrivateKey,
  verify,
  sign,
  generateKeyPairSync,
  randomUUID
}
