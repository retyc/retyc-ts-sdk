import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { downloadTransfer, resolveSessionKey } from '../transfers/download.js'
import {
  generateIdentity,
  encryptString,
  encryptStringWithPassphrase,
  encryptChunk,
} from '../crypto/age.js'
import type { TransferApiClient } from '../transfers/transfer-client.js'

describe('downloadTransfer', () => {
  it('downloads and decrypts files from a transfer', async () => {
    const sessionKey = await generateIdentity()

    const originalData = Buffer.from('File content for testing')

    const nameEnc = await encryptString('report.txt', [sessionKey.publicKey])
    const typeEnc = await encryptString('text/plain', [sessionKey.publicKey])
    const encryptedChunk = await encryptChunk(new Uint8Array(originalData), sessionKey.publicKey)

    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferDetails: vi.fn(),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
      }]),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    const files = await downloadTransfer(transferApi, 'transfer-123', sessionKey.privateKey, {})

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('report.txt')
    expect(files[0].mimeType).toBe('text/plain')
    expect(files[0].data).toEqual(originalData)
  }, 20000)

  it('streams files to outputPath and returns null data', async () => {
    const sessionKey = await generateIdentity()

    const originalData = Buffer.from('Streamed file content for testing')

    const nameEnc = await encryptString('streamed.txt', [sessionKey.publicKey])
    const typeEnc = await encryptString('text/plain', [sessionKey.publicKey])
    const encryptedChunk = await encryptChunk(new Uint8Array(originalData), sessionKey.publicKey)

    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferDetails: vi.fn(),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
      }]),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    const outputPath = mkdtempSync(path.join(tmpdir(), 'retyc-download-'))

    try {
      const files = await downloadTransfer(transferApi, 'transfer-123', sessionKey.privateKey, {
        outputPath,
      })

      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('streamed.txt')
      expect(files[0].mimeType).toBe('text/plain')
      expect(files[0].data).toBeNull()
      expect(files[0].size).toBe(originalData.length)

      const writtenPath = path.join(outputPath, 'streamed.txt')
      expect(existsSync(writtenPath)).toBe(true)
      expect(readFileSync(writtenPath)).toEqual(originalData)
    }
    finally {
      rmSync(outputPath, { recursive: true, force: true })
    }
  }, 20000)

  it('rejects unsafe file names when outputPath is set', async () => {
    const sessionKey = await generateIdentity()

    const originalData = Buffer.from('payload')

    const nameEnc = await encryptString('../escape.txt', [sessionKey.publicKey])
    const typeEnc = await encryptString('text/plain', [sessionKey.publicKey])
    const encryptedChunk = await encryptChunk(new Uint8Array(originalData), sessionKey.publicKey)

    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferDetails: vi.fn(),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
      }]),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    const outputPath = mkdtempSync(path.join(tmpdir(), 'retyc-download-'))

    try {
      await expect(downloadTransfer(transferApi, 'transfer-123', sessionKey.privateKey, {
        outputPath,
      })).rejects.toThrow('Unsafe file name')
    }
    finally {
      rmSync(outputPath, { recursive: true, force: true })
    }
  }, 20000)
})

describe('resolveSessionKey', () => {
  it('resolves session key with privateKey (account mode)', async () => {
    const userIdentity = await generateIdentity()
    const sessionKey = await generateIdentity()

    const sessionKeyEnc = await encryptString(sessionKey.privateKey, [userIdentity.publicKey])

    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn(),
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: sessionKeyEnc,
        session_public_key: sessionKey.publicKey,
      }),
      getTransferFiles: vi.fn(),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    const resolved = await resolveSessionKey(transferApi, 'transfer-123', {
      privateKey: userIdentity.privateKey,
    })

    expect(resolved).toBe(sessionKey.privateKey)
  }, 20000)

  it('resolves session key with transferPassphrase (passphrase mode)', async () => {
    const sessionKey = await generateIdentity()
    const ephemeralKey = await generateIdentity()
    const transferPassphrase = 'transfer-passphrase'

    const ephemeralPrivateKeyEnc = await encryptStringWithPassphrase(
      ephemeralKey.privateKey,
      transferPassphrase,
    )
    const sessionPrivateKeyEncForPassphrase = await encryptString(
      sessionKey.privateKey,
      [ephemeralKey.publicKey],
    )

    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn(),
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: null,
        session_public_key: sessionKey.publicKey,
        ephemeral_private_key_enc: ephemeralPrivateKeyEnc,
        ephemeral_public_key: ephemeralKey.publicKey,
        session_private_key_enc_for_passphrase: sessionPrivateKeyEncForPassphrase,
      }),
      getTransferFiles: vi.fn(),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    const resolved = await resolveSessionKey(transferApi, 'transfer-123', {
      transferPassphrase,
    })

    expect(resolved).toBe(sessionKey.privateKey)
  }, 20000)

  it('throws when neither privateKey nor transferPassphrase is provided', async () => {
    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn(),
      getTransferDetails: vi.fn(),
      getTransferFiles: vi.fn(),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    await expect(resolveSessionKey(transferApi, 'transfer-123', {}))
      .rejects.toThrow('privateKey or transferPassphrase')
  })

  it('throws when transfer has no session key in account mode', async () => {
    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn(),
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: null,
        session_public_key: null,
      }),
      getTransferFiles: vi.fn(),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    await expect(resolveSessionKey(transferApi, 'transfer-123', {
      privateKey: 'AGE-SECRET-KEY-...',
    })).rejects.toThrow('session key')
  })

  it('throws when transferPassphrase is provided but ephemeral fields are null', async () => {
    const transferApi: TransferApiClient = {
      createTransfer: vi.fn(),
      finalizeTransfer: vi.fn(),
      registerFile: vi.fn(),
      uploadChunk: vi.fn(),
      downloadChunk: vi.fn(),
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: 'some-enc-key',
        session_public_key: 'age1...',
        ephemeral_private_key_enc: null,
        ephemeral_public_key: null,
        session_private_key_enc_for_passphrase: null,
      }),
      getTransferFiles: vi.fn(),
      disableTransfer: vi.fn(),
      forceDeleteTransfer: vi.fn(),
    } as unknown as TransferApiClient

    await expect(resolveSessionKey(transferApi, 'transfer-123', {
      transferPassphrase: 'irrelevant',
    })).rejects.toThrow('passphrase-based access')
  })
})
