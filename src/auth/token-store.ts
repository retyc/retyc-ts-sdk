import type { TokenSet } from './types.js'

export interface TokenStore {
  get(): Promise<TokenSet | null>
  set(tokens: TokenSet): Promise<void>
  clear(): Promise<void>
  /**
   * Optional mutual exclusion across every context sharing this store (tabs, iframes, workers).
   * When provided, token refreshes run inside it so a single context spends the refresh token.
   */
  withLock?<T>(fn: () => Promise<T>): Promise<T>
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
