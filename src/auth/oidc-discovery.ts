export interface OIDCConfig {
  issuer: string
  clientId: string
  scopes: string[]
  deviceAuthUrl: string
  tokenUrl: string
  endSessionUrl?: string
}

interface PublicLoginConfig {
  issuer: string
  client_id: string
  scopes: string[]
}

interface OIDCDiscovery {
  device_authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
}

export async function fetchOIDCConfig(apiUrl: string): Promise<OIDCConfig> {
  const baseUrl = apiUrl.replace(/\/$/, '')

  const configResponse = await fetch(`${baseUrl}/login/config/public`, {
    headers: { Accept: 'application/json' },
  })
  if (!configResponse.ok) {
    const body = await configResponse.text().catch(() => '')
    throw new Error(`Failed to fetch public OIDC config: ${configResponse.status} ${body}`)
  }
  const pubConfig = await configResponse.json() as PublicLoginConfig

  const discoveryUrl = pubConfig.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration'
  const discoveryResponse = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
  })
  if (!discoveryResponse.ok) {
    const body = await discoveryResponse.text().catch(() => '')
    throw new Error(`OIDC discovery failed: ${discoveryResponse.status} ${body}`)
  }
  const discovery = await discoveryResponse.json() as OIDCDiscovery

  return {
    issuer: pubConfig.issuer,
    clientId: pubConfig.client_id,
    scopes: pubConfig.scopes,
    deviceAuthUrl: discovery.device_authorization_endpoint,
    tokenUrl: discovery.token_endpoint,
    endSessionUrl: discovery.end_session_endpoint,
  }
}
