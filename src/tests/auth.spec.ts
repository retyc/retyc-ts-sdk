import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileTokenStore, InMemoryTokenStore } from '../auth/token-store.js'
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
    manager = new TokenManager(store, 'https://api.example.com', mockOIDCConfig)
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

  it('parseTokenResponse rejects a response without access_token', () => {
    expect(() => manager.parseTokenResponse({ refresh_token: 'rt', expires_in: 3600 })).toThrow('access_token')
  })

  it('keeps the current refresh token when the refresh response omits it', async () => {
    await store.set({ accessToken: 'old', refreshToken: 'rt', expiresAt: 0, tokenType: 'Bearer' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new', expires_in: 3600 }),
    }))

    const result = await manager.getValidToken()
    expect(result.accessToken).toBe('new')
    expect(result.refreshToken).toBe('rt')
    vi.unstubAllGlobals()
  })

  it('clears the session when the refresh token is rejected', async () => {
    await store.set({ accessToken: 'old', refreshToken: 'rt', expiresAt: 0, tokenType: 'Bearer' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))

    await expect(manager.getValidToken()).rejects.toThrow('Please log in again')
    expect(await store.get()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('keeps the session when the refresh fails with a transient error', async () => {
    const tokens = { accessToken: 'old', refreshToken: 'rt', expiresAt: 0, tokenType: 'Bearer' }
    await store.set(tokens)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

    await expect(manager.getValidToken()).rejects.toThrow('Token refresh failed (503)')
    expect(await store.get()).toEqual(tokens)
    vi.unstubAllGlobals()
  })

  it('refreshAfterUnauthorized reuses tokens already refreshed by another request', async () => {
    const rejected = { accessToken: 'old', refreshToken: 'old-rt', expiresAt: 9999999999, tokenType: 'Bearer' }
    const current = { accessToken: 'new', refreshToken: 'new-rt', expiresAt: 9999999999, tokenType: 'Bearer' }
    await store.set(current)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await manager.refreshAfterUnauthorized(rejected)).toEqual(current)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('refreshAfterUnauthorized refreshes when the rejected token is still the stored one', async () => {
    const rejected = { accessToken: 'old', refreshToken: 'rt', expiresAt: 9999999999, tokenType: 'Bearer' }
    await store.set(rejected)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new', refresh_token: 'new-rt', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([
      manager.refreshAfterUnauthorized(rejected),
      manager.refreshAfterUnauthorized(rejected),
    ])
    expect(a.accessToken).toBe('new')
    expect(b.accessToken).toBe('new')
    expect(fetchMock).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})

describe('FileTokenStore', () => {
  const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 9999999999, tokenType: 'Bearer' }

  it('round-trips tokens and clears them', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'retyc-tokens-'))
    try {
      const store = new FileTokenStore(path.join(dir, 'nested', 'tokens.json'))
      expect(await store.get()).toBeNull()
      await store.set(tokens)
      expect(await store.get()).toEqual(tokens)
      await store.clear()
      expect(await store.get()).toBeNull()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('restricts the token file to its owner', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'retyc-tokens-'))
    try {
      const filePath = path.join(dir, 'tokens.json')
      writeFileSync(filePath, '{}', { mode: 0o644 })
      await new FileTokenStore(filePath).set(tokens)
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    const manager = new TokenManager(store, 'https://api.example.com', mockOIDCConfig)

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
    const manager = new TokenManager(store, 'https://api.example.com', mockOIDCConfig)

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
