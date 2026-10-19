import { Buffer } from 'buffer'

const g = globalThis as any
if (!g.Buffer) g.Buffer = Buffer
if (!g.global) g.global = globalThis
