import type { TokenSet } from './types.js'
import type { TokenStore } from './token-store.js'
import { fetchOIDCConfig, type OIDCConfig } from './oidc-discovery.js'

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
    const tokens = await this.store.get()
    if (!tokens) {
      throw new Error('Not authenticated. Call sdk.auth.startDeviceFlow() first.')
    }

    if (this.isExpiringSoon(tokens)) {
      return this.refresh(tokens.refreshToken)
    }
    return tokens
  }

  async forceRefresh(): Promise<TokenSet> {
    const tokens = await this.store.get()
    if (!tokens) {
      throw new Error('Not authenticated. Call sdk.auth.startDeviceFlow() first.')
    }
    return this.refresh(tokens.refreshToken)
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (this.refreshInProgress) return this.refreshInProgress

    this.refreshInProgress = this.doRefresh(refreshToken).finally(() => {
      this.refreshInProgress = null
    })
    return this.refreshInProgress
  }

  async saveTokens(raw: Record<string, unknown>): Promise<TokenSet> {
    const tokens = this.parseTokenResponse(raw)
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
      await this.store.clear()
      throw new Error(`Refresh token expired or invalid (${response.status}). Please log in again.`)
    }

    const raw = await response.json() as Record<string, unknown>
    return this.saveTokens(raw)
  }

  parseTokenResponse(raw: Record<string, unknown>): TokenSet {
    const expiresIn = raw.expires_in as number
    return {
      accessToken: raw.access_token as string,
      refreshToken: raw.refresh_token as string,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      tokenType: (raw.token_type as string) ?? 'Bearer',
    }
  }
}
