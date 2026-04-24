import type { TokenManager } from '../auth/token-manager.js'

export class FetchClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenManager: TokenManager,
  ) {}

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    return this.request<T>('GET', this.buildUrl(path, params))
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', this.buildUrl(path), body)
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', this.buildUrl(path), body)
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', this.buildUrl(path))
  }

  async postMultipart(path: string, formData: FormData): Promise<void> {
    const url = this.buildUrl(path)
    const token = await this.tokenManager.getValidToken()

    let response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `${token.tokenType} ${token.accessToken}` },
      body: formData,
    })

    if (response.status === 401) {
      const refreshed = await this.tokenManager.refresh(token.refreshToken)
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `${refreshed.tokenType} ${refreshed.accessToken}` },
        body: formData,
      })
    }

    if (!response.ok) await this.throwApiError(response)
  }

  async getBytes(path: string): Promise<Uint8Array> {
    const token = await this.tokenManager.getValidToken()

    let response = await fetch(this.buildUrl(path), {
      headers: { Authorization: `${token.tokenType} ${token.accessToken}` },
    })

    if (response.status === 401) {
      const refreshed = await this.tokenManager.refresh(token.refreshToken)
      response = await fetch(this.buildUrl(path), {
        headers: { Authorization: `${refreshed.tokenType} ${refreshed.accessToken}` },
      })
    }

    if (!response.ok) await this.throwApiError(response)

    return new Uint8Array(await response.arrayBuffer())
  }

  private buildUrl(path: string, params?: Record<string, string | number>): string {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const token = await this.tokenManager.getValidToken()

    const headers: Record<string, string> = {
      Authorization: `${token.tokenType} ${token.accessToken}`,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (response.status === 401) {
      const refreshed = await this.tokenManager.refresh(token.refreshToken)
      response = await fetch(url, {
        method,
        headers: { ...headers, Authorization: `${refreshed.tokenType} ${refreshed.accessToken}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    }

    if (!response.ok) await this.throwApiError(response)
    if (response.status === 204) return undefined as T

    return response.json() as Promise<T>
  }

  private async throwApiError(response: Response): Promise<never> {
    let message = `API error ${response.status}`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = `${message}: ${body.detail}`
    } catch { /* non-JSON body */ }
    throw new Error(message)
  }
}
