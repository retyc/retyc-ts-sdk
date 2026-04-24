import type { FetchClient } from '../http/client.js'
import type { UserApiResponse, UserKeyApiResponse } from './types.js'

export class UserApiClient {
  constructor(private readonly http: FetchClient) {}

  async getMe(): Promise<UserApiResponse> {
    return this.http.get<UserApiResponse>('/user/me')
  }

  async getActiveKey(): Promise<UserKeyApiResponse> {
    return this.http.get<UserKeyApiResponse>('/user/me/key/active')
  }
}
