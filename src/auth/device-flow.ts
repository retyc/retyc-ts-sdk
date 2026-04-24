import type { DeviceFlowResult, TokenSet } from './types.js'
import type { OIDCConfig } from './oidc-discovery.js'
import type { TokenManager } from './token-manager.js'

const DEFAULT_POLL_INTERVAL = 5

export async function startDeviceFlow(
  config: OIDCConfig,
  tokenManager: TokenManager,
): Promise<DeviceFlowResult> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(' '),
  })

  const response = await fetch(config.deviceAuthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Device Flow initialization failed: ${response.status} ${text}`)
  }

  const data = await response.json() as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }

  const interval = data.interval ?? DEFAULT_POLL_INTERVAL

  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    poll: () => pollDeviceToken(config, tokenManager, data.device_code, interval, data.expires_in),
  }
}

async function pollDeviceToken(
  config: OIDCConfig,
  tokenManager: TokenManager,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<TokenSet> {
  const deadline = Date.now() + expiresIn * 1000
  let currentInterval = intervalSeconds

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: config.clientId,
    device_code: deviceCode,
  })

  while (Date.now() < deadline) {
    await sleep(currentInterval * 1000)

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (response.ok) {
      const raw = await response.json() as Record<string, unknown>
      return tokenManager.saveTokens(raw)
    }

    const error = await response.json() as { error: string }

    if (error.error === 'authorization_pending') continue
    if (error.error === 'slow_down') { currentInterval += 5; continue }
    if (error.error === 'expired_token') throw new Error('Device code expired. Please restart the authentication flow.')
    if (error.error === 'access_denied') throw new Error('Access denied by the user.')

    throw new Error(`Authentication error: ${error.error}`)
  }

  throw new Error('Authentication timed out.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
