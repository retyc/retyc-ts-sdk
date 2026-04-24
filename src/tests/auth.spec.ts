import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryTokenStore } from '../auth/token-store.js'
import { TokenManager } from '../auth/token-manager.js'
import type { OIDCConfig } from '../auth/oidc-discovery.js'

const mockOIDCConfig: OIDCConfig = {
  issuer: 'https://auth.example.com/realms/test',
  clientId: 'sdk-test',
  scopes: ['openid', 'profile', 'offline_access'],
  deviceAuthUrl: 'https://auth.example.com/realms/test/protocol/openid-connect/auth/device',
  tokenUrl: 'https://auth.example.com/realms/test/protocol/openid-connect/token',
}

describe('InMemoryTokenStore', () => {
  it('returns null when empty', async () => {
    const store = new InMemoryTokenStore()
    expect(await store.get()).toBeNull()
  })

  it('stores and returns tokens', async () => {
    const store = new InMemoryTokenStore()
    const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 9999999999, tokenType: 'Bearer' }
    await store.set(tokens)
    expect(await store.get()).toEqual(tokens)
  })

  it('clear removes tokens', async () => {
    const store = new InMemoryTokenStore()
    await store.set({ accessToken: 'at', refreshToken: 'rt', expiresAt: 9999999999, tokenType: 'Bearer' })
    await store.clear()
    expect(await store.get()).toBeNull()
  })
})

describe('TokenManager', () => {
  let store: InMemoryTokenStore
  let manager: TokenManager

  beforeEach(() => {
    store = new InMemoryTokenStore()
    manager = new TokenManager(store, mockOIDCConfig)
  })

  it('throws when not authenticated', async () => {
    await expect(manager.getValidToken()).rejects.toThrow('Not authenticated')
  })

  it('returns valid token directly', async () => {
    const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 9999999999, tokenType: 'Bearer' }
    await store.set(tokens)
    expect(await manager.getValidToken()).toEqual(tokens)
  })

  it('refreshes token when expiring soon', async () => {
    const expiringTokens = {
      accessToken: 'old',
      refreshToken: 'rt',
      expiresAt: Math.floor(Date.now() / 1000) + 5,
      tokenType: 'Bearer',
    }
    await store.set(expiringTokens)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new',
        refresh_token: 'new-rt',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await manager.getValidToken()
    expect(result.accessToken).toBe('new')
    vi.unstubAllGlobals()
  })

  it('parseTokenResponse computes expiresAt correctly', () => {
    const before = Math.floor(Date.now() / 1000)
    const result = manager.parseTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'Bearer',
    })
    const after = Math.floor(Date.now() / 1000)
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3600)
    expect(result.expiresAt).toBeLessThanOrEqual(after + 3600)
  })
})

describe('fetchOIDCConfig', () => {
  it('fetches OIDC config in two steps', async () => {
    const { fetchOIDCConfig } = await import('../auth/oidc-discovery.js')

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/login/config/public')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            issuer: 'https://auth.example.com/realms/test',
            client_id: 'sdk-public',
            scopes: ['openid', 'profile', 'offline_access'],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          device_authorization_endpoint: 'https://auth.example.com/realms/test/protocol/openid-connect/auth/device',
          token_endpoint: 'https://auth.example.com/realms/test/protocol/openid-connect/token',
          end_session_endpoint: 'https://auth.example.com/realms/test/protocol/openid-connect/logout',
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const config = await fetchOIDCConfig('https://api.example.com')
    expect(config.clientId).toBe('sdk-public')
    expect(config.deviceAuthUrl).toContain('auth/device')
    expect(config.tokenUrl).toContain('token')
    expect(config.scopes).toContain('offline_access')
    vi.unstubAllGlobals()
  })
})

describe('Device Flow polling', () => {
  it('returns tokens when user authorizes', async () => {
    const { startDeviceFlow } = await import('../auth/device-flow.js')
    const store = new InMemoryTokenStore()
    const manager = new TokenManager(store, mockOIDCConfig)

    let callCount = 0
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('auth/device')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            device_code: 'dc123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://auth.example.com/activate',
            expires_in: 300,
            interval: 0,
          }),
        })
      }
      callCount++
      if (callCount < 3) {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'authorization_pending' }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer' }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const flow = await startDeviceFlow(mockOIDCConfig, manager)
    expect(flow.userCode).toBe('ABCD-1234')
    expect(flow.verificationUri).toBe('https://auth.example.com/activate')

    const tokens = await flow.poll()
    expect(tokens.accessToken).toBe('at')
    vi.unstubAllGlobals()
  })

  it('throws when access denied', async () => {
    const { startDeviceFlow } = await import('../auth/device-flow.js')
    const store = new InMemoryTokenStore()
    const manager = new TokenManager(store, mockOIDCConfig)

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('auth/device')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ device_code: 'dc123', user_code: 'ABCD-1234', verification_uri: 'https://x', expires_in: 300, interval: 0 }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'access_denied' }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const flow = await startDeviceFlow(mockOIDCConfig, manager)
    await expect(flow.poll()).rejects.toThrow('Access denied')
    vi.unstubAllGlobals()
  })
})
