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

function makeTransferApiMock(overrides: Partial<TransferApiClient> = {}): TransferApiClient {
  return {
    createTransfer: vi.fn(),
    finalizeTransfer: vi.fn(),
    registerFile: vi.fn(),
    uploadChunk: vi.fn(),
    downloadChunk: vi.fn(),
    getTransfer: vi.fn(),
    getTransferDetails: vi.fn(),
    getTransferFiles: vi.fn(),
    disableTransfer: vi.fn(),
    forceDeleteTransfer: vi.fn(),
    ...overrides,
  } as unknown as TransferApiClient
}

describe('downloadTransfer', () => {
  it('downloads and decrypts files from a transfer', async () => {
    const sessionKey = await generateIdentity()

    const originalData = Buffer.from('File content for testing')

    const nameEnc = await encryptString('report.txt', [sessionKey.publicKey])
    const typeEnc = await encryptString('text/plain', [sessionKey.publicKey])
    const encryptedChunk = await encryptChunk(new Uint8Array(originalData), sessionKey.publicKey)

    const transferApi = makeTransferApiMock({
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
        custom_model_name: null,
      }]),
    })

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

    const transferApi = makeTransferApiMock({
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
        custom_model_name: null,
      }]),
    })

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

    const transferApi = makeTransferApiMock({
      downloadChunk: vi.fn().mockResolvedValue(encryptedChunk),
      getTransferFiles: vi.fn().mockResolvedValue([{
        id: 'file-001',
        name_enc: nameEnc,
        type_enc: typeEnc,
        chunk_count: 1,
        original_size: originalData.length,
        encrypted_size: encryptedChunk.length,
        share_id: 'transfer-123',
        custom_model_name: null,
      }]),
    })

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

    const transferApi = makeTransferApiMock({
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: sessionKeyEnc,
        session_public_key: sessionKey.publicKey,
      }),
    })

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

    const transferApi = makeTransferApiMock({
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: null,
        session_public_key: sessionKey.publicKey,
        ephemeral_private_key_enc: ephemeralPrivateKeyEnc,
        ephemeral_public_key: ephemeralKey.publicKey,
        session_private_key_enc_for_passphrase: sessionPrivateKeyEncForPassphrase,
      }),
    })

    const resolved = await resolveSessionKey(transferApi, 'transfer-123', {
      transferPassphrase,
    })

    expect(resolved).toBe(sessionKey.privateKey)
  }, 20000)

  it('throws when neither privateKey nor transferPassphrase is provided', async () => {
    const transferApi = makeTransferApiMock()

    await expect(resolveSessionKey(transferApi, 'transfer-123', {}))
      .rejects.toThrow('privateKey or transferPassphrase')
  })

  it('throws when transfer has no session key in account mode', async () => {
    const transferApi = makeTransferApiMock({
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: null,
        session_public_key: null,
      }),
    })

    await expect(resolveSessionKey(transferApi, 'transfer-123', {
      privateKey: 'AGE-SECRET-KEY-...',
    })).rejects.toThrow('session key')
  })

  it('throws when transferPassphrase is provided but ephemeral fields are null', async () => {
    const transferApi = makeTransferApiMock({
      getTransferDetails: vi.fn().mockResolvedValue({
        id: 'transfer-123',
        slug: 'abc',
        session_private_key_enc: 'some-enc-key',
        session_public_key: 'age1...',
        ephemeral_private_key_enc: null,
        ephemeral_public_key: null,
        session_private_key_enc_for_passphrase: null,
      }),
    })

    await expect(resolveSessionKey(transferApi, 'transfer-123', {
      transferPassphrase: 'irrelevant',
    })).rejects.toThrow('passphrase-based access')
  })
})

describe('getTransfer', () => {
  const mockTransfer = {
    id: 'transfer-123',
    slug: 'abc123',
    web_url: 'https://retyc.io/t/abc123',
    use_passphrase: false,
    status: 'active' as const,
    is_custom_share: false,
    title: 'My transfer',
    message_enc: null,
    created_at: '2026-05-01T00:00:00Z',
    deleted_at: null,
    session_public_key: null,
    session_private_key_enc: null,
    ephemeral_public_key: null,
    ephemeral_private_key_enc: null,
    session_private_key_enc_for_passphrase: null,
  }

  it('returns the transfer from the API', async () => {
    const transferApi = makeTransferApiMock({
      getTransfer: vi.fn().mockResolvedValue(mockTransfer),
    })

    const result = await transferApi.getTransfer('transfer-123')

    expect(transferApi.getTransfer).toHaveBeenCalledWith('transfer-123')
    expect(result.id).toBe('transfer-123')
    expect(result.slug).toBe('abc123')
    expect(result.web_url).toBe('https://retyc.io/t/abc123')
    expect(result.status).toBe('active')
    expect(result.use_passphrase).toBe(false)
  })

  it('returns transfer with passphrase fields when use_passphrase is true', async () => {
    const transferApi = makeTransferApiMock({
      getTransfer: vi.fn().mockResolvedValue({
        ...mockTransfer,
        use_passphrase: true,
        ephemeral_public_key: 'age1pq1abc...',
        ephemeral_private_key_enc: 'AGE ENCRYPTED FILE...',
        session_private_key_enc_for_passphrase: 'AGE ENCRYPTED FILE...',
      }),
    })

    const result = await transferApi.getTransfer('transfer-123')

    expect(result.use_passphrase).toBe(true)
    expect(result.ephemeral_public_key).toBeTruthy()
    expect(result.ephemeral_private_key_enc).toBeTruthy()
    expect(result.session_private_key_enc_for_passphrase).toBeTruthy()
  })
})
