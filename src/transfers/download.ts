import { createWriteStream, mkdirSync } from 'node:fs'
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

  const files = await transferApi.getTransferFiles(transferId)

  if (outputPath !== undefined) {
    mkdirSync(outputPath, { recursive: true })
  }

  const results: DownloadedFile[] = []

  // Files are processed sequentially to keep peak memory bounded (one file buffered at a time).
  for (const file of files) {
    const name = await decryptString(file.name_enc, sessionKey)
    const mimeType = await decryptString(file.type_enc, sessionKey)

    const chunks = await runWithConcurrency(
      Array.from({ length: file.chunk_count }, (_, chunkId) => async () => {
        const encryptedChunk = await transferApi.downloadChunk(file.id, chunkId)
        const decrypted = await decryptChunk(encryptedChunk, sessionKey)
        return Buffer.from(decrypted)
      }),
      concurrency,
    )

    if (outputPath !== undefined) {
      assertSafePath(name)
      const destination = path.join(outputPath, name)
      const totalSize = await writeChunksToFile(destination, chunks)
      results.push({ name, mimeType, size: totalSize, data: null })
    }
    else {
      const data = Buffer.concat(chunks)
      results.push({ name, mimeType, size: data.length, data })
    }
  }

  return results
}

// Mirrors frontend/app/composables/use-download.ts:assertSafePath — guards against path traversal
// when filenames are decrypted from untrusted ciphertext.
function assertSafePath(name: string): void {
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`Unsafe file name: ${name}`)
  }
}

async function writeChunksToFile(destination: string, chunks: Buffer[]): Promise<number> {
  const stream = createWriteStream(destination)
  let total = 0

  try {
    for (const chunk of chunks) {
      total += chunk.length
      if (!stream.write(chunk)) {
        await new Promise<void>((resolve) => stream.once('drain', () => resolve()))
      }
    }
  }
  catch (err) {
    stream.destroy()
    throw err
  }

  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(() => resolve())
  })

  return total
}
