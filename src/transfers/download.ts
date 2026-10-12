import { mkdirSync } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import {
  decryptString,
  decryptStringWithPassphrase,
  decryptChunk,
} from '../crypto/age.js'
import { runWithConcurrency } from '../utils/concurrency.js'
import type { TransferApiClient } from './transfer-client.js'
import type { DownloadOptions, DownloadedFile, ResolveSessionKeyOptions } from './types.js'

const DEFAULT_CONCURRENCY = 4

export async function resolveSessionKey(
  transferApi: TransferApiClient,
  transferId: string,
  options: ResolveSessionKeyOptions,
): Promise<string> {
  const { privateKey, transferPassphrase } = options

  if (privateKey === undefined && transferPassphrase === undefined) {
    throw new Error('ResolveSessionKeyOptions must provide either privateKey or transferPassphrase.')
  }

  const details = await transferApi.getTransferDetails(transferId)

  if (transferPassphrase !== undefined) {
    if (!details.ephemeral_private_key_enc || !details.session_private_key_enc_for_passphrase) {
      throw new Error('Transfer does not support passphrase-based access.')
    }

    const ephemeralPrivateKey = await decryptStringWithPassphrase(
      details.ephemeral_private_key_enc,
      transferPassphrase,
    )
    return decryptString(details.session_private_key_enc_for_passphrase, ephemeralPrivateKey)
  }

  if (!details.session_private_key_enc) {
    throw new Error('Transfer has no session key. It may not have been finalized yet.')
  }

  return decryptString(details.session_private_key_enc, privateKey!)
}

export async function downloadTransfer(
  transferApi: TransferApiClient,
  transferId: string,
  sessionKey: string,
  options: DownloadOptions,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<DownloadedFile[]> {
  const { outputPath } = options
  const batchSize = Math.floor(concurrency)
  if (!(batchSize >= 1)) throw new RangeError(`concurrency must be >= 1, got ${concurrency}`)

  const files = await transferApi.getTransferFiles(transferId)

  if (outputPath !== undefined) {
    mkdirSync(outputPath, { recursive: true })
  }

  const results: DownloadedFile[] = []

  // Files are processed sequentially to keep peak memory bounded (one file buffered at a time).
  for (const file of files) {
    const name = await decryptString(file.name_enc, sessionKey)
    const mimeType = await decryptString(file.type_enc, sessionKey)

    const downloadChunks = (from: number, to: number): Promise<Buffer[]> => runWithConcurrency(
      Array.from({ length: to - from }, (_, i) => async () => {
        const encryptedChunk = await transferApi.downloadChunk(file.id, from + i)
        const decrypted = await decryptChunk(encryptedChunk, sessionKey)
        return Buffer.from(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
      }),
      batchSize,
    )

    if (outputPath !== undefined) {
      const destination = resolveSafeDestination(outputPath, name)
      mkdirSync(path.dirname(destination), { recursive: true })

      // Chunks are fetched one batch at a time and flushed in order, so peak memory is
      // `concurrency` chunks rather than the whole file.
      const handle = await open(destination, 'w')
      let totalSize = 0
      try {
        for (let from = 0; from < file.chunk_count; from += batchSize) {
          const batch = await downloadChunks(from, Math.min(from + batchSize, file.chunk_count))
          for (const chunk of batch) {
            await handle.writeFile(chunk)
            totalSize += chunk.length
          }
        }
      }
      finally {
        await handle.close()
      }
      results.push({ name, mimeType, size: totalSize, data: null })
    }
    else {
      const data = Buffer.concat(await downloadChunks(0, file.chunk_count))
      results.push({ name, mimeType, size: data.length, data })
    }
  }

  return results
}

// Mirrors frontend/app/composables/use-download.ts:assertSafePath — guards against path traversal
// when filenames are decrypted from untrusted ciphertext. Names may carry sub-directories
// (folder uploads from the web app), which are recreated under outputPath. Backslashes are
// treated as separators and the resolved path is re-checked so the guard also holds on Windows.
function resolveSafeDestination(outputPath: string, name: string): string {
  const segments = name.split(/[\\/]/)
  const root = path.resolve(outputPath)
  const destination = path.resolve(root, name)
  const relative = path.relative(root, destination)
  if (
    name.length === 0
    || name.includes('\0')
    || /^[\\/]/.test(name)
    || path.isAbsolute(name)
    || segments.some(seg => seg === '..')
    || relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`Unsafe file name: ${name}`)
  }
  return destination
}
