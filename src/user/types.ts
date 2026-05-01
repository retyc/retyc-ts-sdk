export type UserKeyStatus = 'active' | 'pending' | 'revoked'

export interface UserKeyApiResponse {
  id: string
  user_id: string
  public_key: string
  private_key_enc: string | null
  status: UserKeyStatus
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface UploadCapabilitiesApiResponse {
  max_share_size: number
  max_storage_size: number
  max_count_share: number | null
  max_count_dataroom: number | null
  max_share_expiration_time: number | null
  max_external_users_dataroom: number | null
  feature_share_for_me: boolean
  feature_share_templates: boolean
  feature_transfer_share_dataroom: boolean
  feature_customized_branding: boolean
}

export interface UserQuotaApiResponse {
  count_share: number
  max_count_share: number | null
  count_dataroom: number
  max_count_dataroom: number | null
  used_storage: number
  max_storage: number
  is_upload_read_only: boolean
}

export interface UserApiResponse {
  user: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    full_name: string | null
    locale: string
    status: string
    key_id: string | null
    public_key: string | null
    private_key_enc: string | null
    main_organization_id: string | null
    organization_role: string | null
    organization_plan_id: string | null
    created_at: string
  }
  extra_data: {
    sub: string
    email: string
    email_verified: boolean
    given_name: string
    family_name: string
    locale: string
    organization: string[]
  }
  roles: string[]
}
