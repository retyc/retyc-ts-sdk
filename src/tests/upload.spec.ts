import { describe, it, expect, vi } from 'vitest'
import { uploadTransfer } from '../transfers/upload.js'
import type { TransferApiClient } from '../transfers/transfer-client.js'

function makeApiMock(overrides: Partial<TransferApiClient> = {}): TransferApiClient {
  return {
    createTransfer: vi.fn().mockResolvedValue({
      id: 'transfer-123',
      slug: 'abc123',
      public_keys: [],
      use_passphrase: false,
      session_private_key_enc: null,
      session_public_key: null,
      ephemeral_private_key_enc: null,
      ephemeral_public_key: null,
      session_private_key_enc_for_passphrase: null,
      expires_at: null,
    }),
    finalizeTransfer: vi.fn().mockResolvedValue(undefined),
    registerFile: vi.fn().mockResolvedValue({
      id: 'file-456',
      chunk_count: 1,
      name_enc: '',
      type_enc: '',
      original_size: 5,
      encrypted_size: 100,
      share_id: 'transfer-123',
    }),
    uploadChunk: vi.fn().mockResolvedValue(undefined),
    downloadChunk: vi.fn(),
    getTransferDetails: vi.fn(),
    getTransferFiles: vi.fn(),
    disableTransfer: vi.fn(),
    forceDeleteTransfer: vi.fn(),
    ...overrides,
  } as unknown as TransferApiClient
}

describe('uploadTransfer', () => {
  it('creates a transfer and finalizes it', async () => {
    const api = makeApiMock()

    const result = await uploadTransfer(api, {
      recipients: ['alice@example.com'],
      expires: 3600,
      files: [{ name: 'test.txt', mimeType: 'text/plain', data: Buffer.from('hello'), size: 5 }],
    })

    expect(result.transferId).toBe('transfer-123')
    expect(result.slug).toBe('abc123')
    expect(api.createTransfer).toHaveBeenCalledWith({
      emails: ['alice@example.com'],
      expires: 3600,
      title: null,
      use_passphrase: false,
    })
    expect(api.finalizeTransfer).toHaveBeenCalledOnce()
    expect(api.registerFile).toHaveBeenCalledOnce()
    expect(api.uploadChunk).toHaveBeenCalledOnce()
  })

  it('includes ephemeral key fields when passphrase is provided', async () => {
    const api = makeApiMock()

    await uploadTransfer(api, {
      recipients: [],
      expires: 7200,
      passphrase: 'my-secret',
      files: [{ name: 'doc.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf'), size: 3 }],
    })

    const finalizeCall = (api.finalizeTransfer as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(finalizeCall.ephemeral_public_key).toBeTruthy()
    expect(finalizeCall.ephemeral_private_key_enc).toBeTruthy()
    expect(finalizeCall.session_private_key_enc_for_passphrase).toBeTruthy()
  }, 15000)

  it('splits file into multiple chunks', async () => {
    const api = makeApiMock({
      registerFile: vi.fn().mockResolvedValue({
        id: 'file-789',
        chunk_count: 3,
        name_enc: '',
        type_enc: '',
        original_size: 100,
        encrypted_size: 200,
        share_id: 'transfer-123',
      }),
    })

    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'big.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(100, 0x42), size: 100 }],
    }, 40)

    expect(api.uploadChunk).toHaveBeenCalledTimes(3)
    const calls = (api.uploadChunk as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][1]).toBe(0)
    expect(calls[1][1]).toBe(1)
    expect(calls[2][1]).toBe(2)
  })
})
