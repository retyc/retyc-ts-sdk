export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number
  tokenType: string
}

export interface DeviceFlowResult {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  poll: () => Promise<TokenSet>
}
