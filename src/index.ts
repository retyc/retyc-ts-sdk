import { InMemoryTokenStore } from './auth/token-store.js'
import { TokenManager } from './auth/token-manager.js'
import { fetchOIDCConfig } from './auth/oidc-discovery.js'
import { startDeviceFlow } from './auth/device-flow.js'
import { FetchClient } from './http/client.js'
import { UserApiClient } from './user/user-client.js'
import { TransferApiClient } from './transfers/transfer-client.js'
import { uploadTransfer } from './transfers/upload.js'
import { downloadTransfer, resolveSessionKey } from './transfers/download.js'
import type { SDKConfig } from './types.js'
import type { DeviceFlowResult, TokenSet } from './auth/types.js'
import type { UploadCapabilitiesApiResponse, UserApiResponse, UserKeyApiResponse, UserQuotaApiResponse } from './user/types.js'
import type {
  CreateTransferOptions,
  TransferApiResponse,
  UploadResult,
  DownloadOptions,
  DownloadedFile,
  ResolveSessionKeyOptions,
} from './transfers/types.js'

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024

export class RetycSDK {
  private readonly tokenManager: TokenManager
  private readonly http: FetchClient
  private readonly userApi: UserApiClient
  private readonly transferApi: TransferApiClient
  private readonly chunkSize: number
  private readonly uploadConcurrency: number
  private readonly downloadConcurrency: number
  private readonly apiUrl: string

  readonly auth: {
    startDeviceFlow(): Promise<DeviceFlowResult>
    refresh(): Promise<TokenSet>
    logout(): Promise<void>
    getTokens(): Promise<TokenSet | null>
  }

  readonly user: {
    getMe(): Promise<UserApiResponse>
    getActiveKey(): Promise<UserKeyApiResponse>
    getUploadCapabilities(): Promise<UploadCapabilitiesApiResponse>
    getUserQuota(): Promise<UserQuotaApiResponse>
  }

  readonly transfers: {
    get(transferId: string): Promise<TransferApiResponse>
    resolveSessionKey(transferId: string, options: ResolveSessionKeyOptions): Promise<string>
    upload(options: CreateTransferOptions): Promise<UploadResult>
    download(transferId: string, sessionKey: string, options?: DownloadOptions): Promise<DownloadedFile[]>
    disable(transferId: string): Promise<void>
    forceDelete(transferId: string): Promise<void>
  }

  // Pre-fetches the OIDC config to avoid latency on the first refresh. Optional:
  // doRefresh() lazy-loads the config on demand if this was not called.
  async preload(): Promise<void> {
    const oidcConfig = await fetchOIDCConfig(this.apiUrl)
    this.tokenManager.setOIDCConfig(oidcConfig)
  }

  constructor(config: SDKConfig) {
    const store = config.tokenStore ?? new InMemoryTokenStore()
    this.tokenManager = new TokenManager(store, config.apiUrl)
    this.http = new FetchClient(config.apiUrl, this.tokenManager)
    this.userApi = new UserApiClient(this.http)
    this.transferApi = new TransferApiClient(this.http)
    this.chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.uploadConcurrency = config.uploadConcurrency ?? 4
    this.downloadConcurrency = config.downloadConcurrency ?? 4
    this.apiUrl = config.apiUrl

    const self = this

    this.auth = {
      async startDeviceFlow(): Promise<DeviceFlowResult> {
        const oidcConfig = await fetchOIDCConfig(self.apiUrl)
        self.tokenManager.setOIDCConfig(oidcConfig)
        return startDeviceFlow(oidcConfig, self.tokenManager)
      },
      refresh(): Promise<TokenSet> {
        return self.tokenManager.forceRefresh()
      },
      async logout(): Promise<void> {
        await self.tokenManager.clear()
      },
      async getTokens(): Promise<TokenSet | null> {
        return store.get()
      },
    }

    this.user = {
      getMe(): Promise<UserApiResponse> {
        return self.userApi.getMe()
      },
      getActiveKey(): Promise<UserKeyApiResponse> {
        return self.userApi.getActiveKey()
      },
      getUploadCapabilities(): Promise<UploadCapabilitiesApiResponse> {
        return self.userApi.getUploadCapabilities()
      },
      getUserQuota(): Promise<UserQuotaApiResponse> {
        return self.userApi.getUserQuota()
      },
    }

    this.transfers = {
      get(transferId: string): Promise<TransferApiResponse> {
        return self.transferApi.getTransfer(transferId)
      },
      resolveSessionKey(transferId: string, options: ResolveSessionKeyOptions): Promise<string> {
        return resolveSessionKey(self.transferApi, transferId, options)
      },
      upload(options: CreateTransferOptions): Promise<UploadResult> {
        return uploadTransfer(self.transferApi, options, self.chunkSize, self.uploadConcurrency)
      },
      download(transferId: string, sessionKey: string, options?: DownloadOptions): Promise<DownloadedFile[]> {
        return downloadTransfer(self.transferApi, transferId, sessionKey, options ?? {}, self.downloadConcurrency)
      },
      async disable(transferId: string): Promise<void> {
        await self.transferApi.disableTransfer(transferId)
      },
      async forceDelete(transferId: string): Promise<void> {
        await self.transferApi.forceDeleteTransfer(transferId)
      },
    }
  }
}

export { decryptStringWithPassphrase } from './crypto/age.js'
export type { SDKConfig } from './types.js'
export type { TokenStore } from './auth/token-store.js'
export { InMemoryTokenStore, FileTokenStore } from './auth/token-store.js'
export type { TokenSet, DeviceFlowResult } from './auth/types.js'
export type { OIDCConfig } from './auth/oidc-discovery.js'
export type { UploadCapabilitiesApiResponse, UserApiResponse, UserKeyApiResponse, UserKeyStatus, UserQuotaApiResponse } from './user/types.js'
export type {
  CreateTransferOptions,
  ShareStatus,
  TransferApiResponse,
  UploadFile,
  UploadResult,
  DownloadOptions,
  DownloadedFile,
  ResolveSessionKeyOptions,
} from './transfers/types.js'
