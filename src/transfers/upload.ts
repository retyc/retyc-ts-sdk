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
  const { recipients, title, expires, passphrase, message, files, onProgress } = options

  // Run network create (I/O) in parallel with session identity generation (CPU).
  const [transfer, sessionKey] = await Promise.all([
    api.createTransfer({
      emails: recipients,
      expires,
      title: title ?? null,
      use_passphrase: Boolean(passphrase),
    }),
    generateIdentity(),
  ])

  // All setup encryptions are independent once sessionKey and transfer.public_keys are known.
  // Launch them concurrently — even though age primitives are CPU-bound on the main thread,
  // their internal awaits (WebCrypto) interleave usefully and the passphrase scrypt branch
  // overlaps with the recipient-only encryptions. We deliberately let these run in the
  // background while files upload; they are awaited just before finalizeTransfer.
  // suppressUnhandled keeps the promise chain alive without altering its rejection
  // semantics — if these reject during the upload loop the error still surfaces at the
  // final Promise.all await, but Node won't emit a spurious unhandledRejection warning.
  const sessionEncPromise = suppressUnhandled(encryptString(sessionKey.privateKey, transfer.public_keys))
  const messageEncPromise: Promise<string | null> = message
    ? suppressUnhandled(encryptString(message, [sessionKey.publicKey]))
    : Promise.resolve(null)

  const passphrasePromise: Promise<{
    ephemeral_public_key: string | null
    ephemeral_private_key_enc: string | null
    session_private_key_enc_for_passphrase: string | null
  }> = passphrase
    ? suppressUnhandled((async () => {
        const ephemeralKey = await generateIdentity()
        const [ephPrivEnc, sessForPass] = await Promise.all([
          encryptStringWithPassphrase(ephemeralKey.privateKey, passphrase),
          encryptString(sessionKey.privateKey, [ephemeralKey.publicKey]),
        ])
        return {
          ephemeral_public_key: ephemeralKey.publicKey,
          ephemeral_private_key_enc: ephPrivEnc,
          session_private_key_enc_for_passphrase: sessForPass,
        }
      })())
    : Promise.resolve({
        ephemeral_public_key: null,
        ephemeral_private_key_enc: null,
        session_private_key_enc_for_passphrase: null,
      })

  let totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  let uploadedBytes = 0
  let lastRatio = 0

  // Files are processed sequentially to keep peak memory bounded (one file buffered at a time).
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]

    // readToBuffer (potentially I/O for Readable) is independent from name/type metadata
    // encryption (CPU). Run them concurrently. registerFile is the only API call here and
    // depends on name_enc/type_enc; awaited together with the buffer below.
    const dataPromise = readToBuffer(file.data)
    const registeredFilePromise = (async () => {
      const [name_enc, type_enc] = await Promise.all([
        encryptString(file.name, [sessionKey.publicKey]),
        encryptString(file.mimeType, [sessionKey.publicKey]),
      ])
      return api.registerFile(transfer.id, {
        name_enc,
        type_enc,
        original_size: file.size,
      })
    })()
    const [data, registeredFile] = await Promise.all([dataPromise, registeredFilePromise])

    const chunkCount = Math.max(1, Math.ceil(data.length / chunkSize))
    await runWithConcurrency(
      Array.from({ length: chunkCount }, (_, chunkId) => async () => {
        const chunk = data.subarray(chunkId * chunkSize, (chunkId + 1) * chunkSize)
        const encrypted = await encryptChunk(chunk, sessionKey.publicKey)
        await api.uploadChunk(registeredFile.id, chunkId, encrypted)
        if (onProgress) {
          uploadedBytes += chunk.length
          if (uploadedBytes > totalBytes) totalBytes = uploadedBytes
          const ratio = Math.max(lastRatio, totalBytes > 0 ? Math.min(1, uploadedBytes / totalBytes) : 0)
          lastRatio = ratio
          try {
            onProgress({ uploadedBytes, totalBytes, ratio, currentFile: { name: file.name, index: fileIndex, total: files.length } })
          } catch {}
        }
      }),
      concurrency,
    )
  }

  // Guarantee ratio=1 in case of size drift or all-empty-file transfers.
  if (onProgress && files.length > 0 && lastRatio < 1) {
    try {
      onProgress({
        uploadedBytes,
        totalBytes,
        ratio: 1,
        currentFile: { name: files[files.length - 1].name, index: files.length - 1, total: files.length },
      })
    } catch {}
  }

  const [
    session_private_key_enc,
    message_enc,
    { ephemeral_public_key, ephemeral_private_key_enc, session_private_key_enc_for_passphrase },
  ] = await Promise.all([sessionEncPromise, messageEncPromise, passphrasePromise])

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
    webUrl: transfer.web_url,
  }
}

// Attaches a no-op rejection handler so that a long-lived background promise doesn't
// trigger Node's unhandledRejection warning while the main flow is busy elsewhere.
// The original promise is still returned, so a later `await` still observes the rejection.
function suppressUnhandled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
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
