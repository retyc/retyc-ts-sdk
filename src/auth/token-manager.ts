import type { TokenSet } from './types.js'
import type { TokenStore } from './token-store.js'
import { fetchOIDCConfig, type OIDCConfig } from './oidc-discovery.js'
import { RetycAuthError } from './errors.js'

const EXPIRY_MARGIN_SECONDS = 10

export class TokenManager {
  private refreshInProgress: Promise<TokenSet> | null = null

  constructor(
    private readonly store: TokenStore,
    private readonly apiUrl: string,
    private oidcConfig: OIDCConfig | null = null,
  ) {}

  setOIDCConfig(config: OIDCConfig): void {
    this.oidcConfig = config
  }

  async getValidToken(): Promise<TokenSet> {
    const tokens = await this.requireTokens()
    return this.isExpiringSoon(tokens) ? this.refreshUnlessRenewed(tokens) : tokens
  }

  async forceRefresh(): Promise<TokenSet> {
    return this.refreshUnlessRenewed(await this.requireTokens())
  }

  // Several requests sharing one access token can all receive a 401. Only the first one may
  // spend the refresh token: with refresh token rotation, replaying it fails and would wipe
  // the freshly stored session. Later callers reuse the tokens the first refresh stored.
  async refreshAfterUnauthorized(rejected: TokenSet): Promise<TokenSet> {
    return this.refreshUnlessRenewed(rejected)
  }

  // `refreshInProgress` only dedupes within this instance. Other contexts sharing the store
  // (another tab, iframe or worker) are covered by re-reading it, under the store's lock when
  // it provides one, and reusing tokens that differ from the ones the caller saw.
  private refreshUnlessRenewed(seen: TokenSet): Promise<TokenSet> {
    if (this.refreshInProgress) return this.refreshInProgress

    const run = async (): Promise<TokenSet> => {
      const current = await this.store.get()
      if (current && current.accessToken !== seen.accessToken) return current
      return this.doRefresh(current?.refreshToken ?? seen.refreshToken)
    }

    this.refreshInProgress = (this.store.withLock ? this.store.withLock(run) : run()).finally(() => {
      this.refreshInProgress = null
    })
    return this.refreshInProgress
  }

  private async requireTokens(): Promise<TokenSet> {
    const tokens = await this.store.get()
    if (!tokens) {
      throw new RetycAuthError('not_authenticated', 'Not authenticated. Call sdk.auth.startDeviceFlow() first.')
    }
    return tokens
  }

  async saveTokens(raw: Record<string, unknown>, fallbackRefreshToken?: string): Promise<TokenSet> {
    const tokens = this.parseTokenResponse(raw, fallbackRefreshToken)
    await this.store.set(tokens)
    return tokens
  }

  async clear(): Promise<void> {
    await this.store.clear()
  }

  private isExpiringSoon(tokens: TokenSet): boolean {
    return Date.now() / 1000 + EXPIRY_MARGIN_SECONDS >= tokens.expiresAt
  }

  private async ensureOIDCConfig(): Promise<OIDCConfig> {
    if (!this.oidcConfig) {
      this.oidcConfig = await fetchOIDCConfig(this.apiUrl)
    }
    return this.oidcConfig
  }

  private async doRefresh(refreshToken: string): Promise<TokenSet> {
    const config = await this.ensureOIDCConfig()

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: refreshToken,
    })

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      // Only a definitive rejection of the grant ends the session. A 5xx or 429 from the
      // identity provider is transient and must not log the user out.
      if (response.status === 400 || response.status === 401) {
        await this.store.clear()
        throw new RetycAuthError('session_expired', `Refresh token expired or invalid (${response.status}). Please log in again.`)
      }
      throw new Error(`Token refresh failed (${response.status}). Please try again later.`)
    }

    const raw = await response.json() as Record<string, unknown>
    // RFC 6749 §6: the server may omit refresh_token, in which case the current one stays valid.
    return this.saveTokens(raw, refreshToken)
  }

  parseTokenResponse(raw: Record<string, unknown>, fallbackRefreshToken?: string): TokenSet {
    const accessToken = raw.access_token
    const refreshToken = raw.refresh_token ?? fallbackRefreshToken
    const expiresIn = raw.expires_in
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('Invalid token response: missing access_token.')
    }
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new Error('Invalid token response: missing refresh_token.')
    }
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
      throw new Error('Invalid token response: missing expires_in.')
    }
    return {
      accessToken,
      refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      tokenType: typeof raw.token_type === 'string' ? raw.token_type : 'Bearer',
    }
  }
}
