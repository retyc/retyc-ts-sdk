import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TokenSet } from './types.js'

export interface TokenStore {
  get(): Promise<TokenSet | null>
  set(tokens: TokenSet): Promise<void>
  clear(): Promise<void>
}

export class InMemoryTokenStore implements TokenStore {
  private tokens: TokenSet | null = null

  async get(): Promise<TokenSet | null> {
    return this.tokens
  }

  async set(tokens: TokenSet): Promise<void> {
    this.tokens = tokens
  }

  async clear(): Promise<void> {
    this.tokens = null
  }
}

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
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(tokens, null, 2), 'utf-8')
  }

  async clear(): Promise<void> {
    try {
      unlinkSync(this.filePath)
    } catch {
      // File not found, nothing to clear
    }
  }
}
