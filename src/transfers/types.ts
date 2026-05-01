import type { Readable } from 'node:stream'

export interface UploadProgressFile {
  name: string
  index: number
  total: number
}

export interface UploadProgress {
  uploadedBytes: number
  totalBytes: number
  /** Clamped 0..1, monotonically non-decreasing. */
  ratio: number
  currentFile: UploadProgressFile
}

export interface CreateTransferOptions {
  recipients: string[]
  title?: string
  expires: number
  passphrase?: string
  message?: string
  files: UploadFile[]
  /**
   * Called after each chunk is successfully uploaded, and may be called one final time
   * after upload completion to ensure `ratio` reaches `1` (for example, for empty files
   * or when `file.size` is larger than the actual uploaded bytes).
   * Exceptions thrown by this callback are silently swallowed and will not abort the upload.
   */
  onProgress?: (progress: UploadProgress) => void
}

export interface UploadFile {
  name: string
  mimeType: string
  data: Readable | Buffer | Uint8Array
  size: number
}

export interface UploadResult {
  transferId: string
  slug: string
  webUrl: string
}

export interface ResolveSessionKeyOptions {
  // Mode account key: provide the age private key in clear (decrypted by the user beforehand)
  privateKey?: string
  // Mode transfer passphrase: provide the passphrase set by the sender
  transferPassphrase?: string
}

export interface DownloadOptions {
  // If provided, each file is streamed to outputPath/<filename> and `data` is null in the result.
  outputPath?: string
}

export interface DownloadedFile {
  name: string
  mimeType: string
  size: number
  // null when outputPath was provided (file was streamed to disk).
  data: Buffer | null
}

export interface TransferCreateApiResponse {
  id: string
  slug: string
  web_url: string
  public_keys: string[]
  use_passphrase: boolean
  session_private_key_enc: string | null
  session_public_key: string | null
  ephemeral_private_key_enc: string | null
  ephemeral_public_key: string | null
  session_private_key_enc_for_passphrase: string | null
  expires_at: string | null
}

export interface TransferCompletePayload {
  session_private_key_enc: string
  session_public_key: string
  ephemeral_private_key_enc: string | null
  ephemeral_public_key: string | null
  session_private_key_enc_for_passphrase: string | null
  message_enc: string | null
}

export interface FileRegisterApiResponse {
  id: string
  chunk_count: number
  name_enc: string
  type_enc: string
  original_size: number
  encrypted_size: number
  share_id: string
  custom_model_name: string | null
}

export interface TransferDetailsApiResponse {
  id: string
  slug: string
  web_url: string
  use_passphrase: boolean
  session_private_key_enc: string | null
  session_public_key: string | null
  ephemeral_private_key_enc: string | null
  ephemeral_public_key: string | null
  session_private_key_enc_for_passphrase: string | null
}

export interface FileMetaApiResponse {
  id: string
  name_enc: string
  type_enc: string
  chunk_count: number
  original_size: number
  encrypted_size: number
  share_id: string
  custom_model_name: string | null
}

export type ShareStatus = 'pending' | 'expired' | 'active' | 'disabled' | 'error' | 'deleted'

export interface TransferApiResponse {
  id: string
  slug: string
  web_url: string
  use_passphrase: boolean
  status: ShareStatus
  is_custom_share: boolean
  title: string | null
  message_enc: string | null
  created_at: string
  deleted_at: string | null
  session_public_key: string | null
  session_private_key_enc: string | null
  ephemeral_public_key: string | null
  ephemeral_private_key_enc: string | null
  session_private_key_enc_for_passphrase: string | null
}

export interface PageApiResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

