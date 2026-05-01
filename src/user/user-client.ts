import type { FetchClient } from '../http/client.js'
import type { UploadCapabilitiesApiResponse, UserApiResponse, UserKeyApiResponse, UserQuotaApiResponse } from './types.js'

export class UserApiClient {
  constructor(private readonly http: FetchClient) {}

  async getMe(): Promise<UserApiResponse> {
    return this.http.get<UserApiResponse>('/user/me')
  }

  async getActiveKey(): Promise<UserKeyApiResponse> {
    return this.http.get<UserKeyApiResponse>('/user/me/key/active')
  }

  async getUploadCapabilities(): Promise<UploadCapabilitiesApiResponse> {
    return this.http.get<UploadCapabilitiesApiResponse>('/user/capabilities/upload')
  }

  async getUserQuota(): Promise<UserQuotaApiResponse> {
    return this.http.get<UserQuotaApiResponse>('/user/quota')
  }
}
