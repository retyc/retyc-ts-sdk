import { Readable } from 'node:stream'
import {
  generateIdentity,
  encryptString,
  encryptStringWithPassphrase,
  encryptChunk,
} from '../crypto/age.js'
import { runWithConcurrency } from '../utils/concurrency.js'
import type { TransferApiClient } from './transfer-client.js'
import type { CreateTransferOptions, UploadResult } from './types.js'

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024
const DEFAULT_CONCURRENCY = 4

export async function uploadTransfer(
  api: TransferApiClient,
  options: CreateTransferOptions,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<UploadResult> {
  const { recipients, title, expires, passphrase, message, files } = options

  const transfer = await api.createTransfer({
    emails: recipients,
    expires,
    title: title ?? null,
    use_passphrase: Boolean(passphrase),
  })

  const sessionKey = await generateIdentity()

  const session_private_key_enc = await encryptString(sessionKey.privateKey, transfer.public_keys)

  let ephemeral_private_key_enc: string | null = null
  let ephemeral_public_key: string | null = null
  let session_private_key_enc_for_passphrase: string | null = null

  if (passphrase) {
    const ephemeralKey = await generateIdentity()
    ephemeral_public_key = ephemeralKey.publicKey
    ephemeral_private_key_enc = await encryptStringWithPassphrase(ephemeralKey.privateKey, passphrase)
    session_private_key_enc_for_passphrase = await encryptString(sessionKey.privateKey, [ephemeralKey.publicKey])
  }

  let message_enc: string | null = null
  if (message) {
    message_enc = await encryptString(message, [sessionKey.publicKey])
  }

  // Files are processed sequentially to keep peak memory bounded (one file buffered at a time).
  for (const file of files) {
    const data = await readToBuffer(file.data)

    const name_enc = await encryptString(file.name, [sessionKey.publicKey])
    const type_enc = await encryptString(file.mimeType, [sessionKey.publicKey])

    const registeredFile = await api.registerFile(transfer.id, {
      name_enc,
      type_enc,
      original_size: file.size,
    })

    const chunkCount = Math.max(1, Math.ceil(data.length / chunkSize))
    await runWithConcurrency(
      Array.from({ length: chunkCount }, (_, chunkId) => async () => {
        const chunk = data.subarray(chunkId * chunkSize, (chunkId + 1) * chunkSize)
        const encrypted = await encryptChunk(chunk, sessionKey.publicKey)
        await api.uploadChunk(registeredFile.id, chunkId, encrypted)
      }),
      concurrency,
    )
  }

  await api.finalizeTransfer(transfer.id, {
    session_private_key_enc,
    session_public_key: sessionKey.publicKey,
    ephemeral_private_key_enc,
    ephemeral_public_key,
    session_private_key_enc_for_passphrase,
    message_enc,
  })

  return {
    transferId: transfer.id,
    slug: transfer.slug,
  }
}

async function readToBuffer(data: Readable | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)

  const chunks: Buffer[] = []
  for await (const chunk of data) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks)
}
