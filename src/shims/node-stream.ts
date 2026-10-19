// Stubs for node:stream imports in the artifact issuer. The mobile client never
// writes streamed artifact templates, so these are only needed to satisfy imports.
export class Readable {
  static from(): never {
    throw new Error('Streams are not available in the mobile client')
  }
}

export class Writable {}

export function pipeline(): never {
  throw new Error('Streams are not available in the mobile client')
}

export default { Readable, Writable, pipeline }
