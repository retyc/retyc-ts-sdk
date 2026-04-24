import type { Readable } from 'node:stream'

export interface CreateTransferOptions {
  recipients: string[]
  title?: string
  expires: number
  passphrase?: string
  message?: string
  files: UploadFile[]
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
}

export interface TransferDetailsApiResponse {
  id: string
  slug: string
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
}

export interface PageApiResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

