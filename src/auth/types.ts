export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number
  tokenType: string
}

export function isTokenSet(value: unknown): value is TokenSet {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.accessToken === 'string' && candidate.accessToken !== ''
    && typeof candidate.refreshToken === 'string' && candidate.refreshToken !== ''
    && typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt)
    && typeof candidate.tokenType === 'string' && candidate.tokenType !== ''
}

export interface DeviceFlowOptions {
  /** Extra OAuth scopes requested in addition to the default `openid`. */
  scopes?: string[]
}

export interface DeviceFlowResult {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  poll: () => Promise<TokenSet>
}
