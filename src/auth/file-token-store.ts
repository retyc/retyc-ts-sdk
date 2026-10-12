import { chmodSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TokenSet } from './types.js'
import type { TokenStore } from './token-store.js'

export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<TokenSet | null> {
    try {
      const content = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(content) as TokenSet
    } catch {
      return null
    }
  }

  async set(tokens: TokenSet): Promise<void> {
    // Tokens are bearer credentials: keep the file (and any directory we create) owner-only.
    // `mode` only applies on creation, so chmod also tightens a file written by an older version.
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    writeFileSync(this.filePath, JSON.stringify(tokens, null, 2), { encoding: 'utf-8', mode: 0o600 })
    chmodSync(this.filePath, 0o600)
  }

  async clear(): Promise<void> {
    try {
      unlinkSync(this.filePath)
    } catch {
      // File not found, nothing to clear
    }
  }
}
