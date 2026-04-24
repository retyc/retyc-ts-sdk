import type { TokenStore } from './auth/token-store.js'

export interface SDKConfig {
  apiUrl: string
  tokenStore?: TokenStore
  chunkSize?: number
  /** Max concurrent chunk uploads (default: 4) */
  uploadConcurrency?: number
  /** Max concurrent chunk downloads (default: 4) */
  downloadConcurrency?: number
}
