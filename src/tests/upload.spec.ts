import { describe, it, expect, vi } from 'vitest'
import { uploadTransfer } from '../transfers/upload.js'
import type { TransferApiClient } from '../transfers/transfer-client.js'
import type { UploadProgress } from '../transfers/types.js'

function makeApiMock(overrides: Partial<TransferApiClient> = {}): TransferApiClient {
  return {
    createTransfer: vi.fn().mockResolvedValue({
      id: 'transfer-123',
      slug: 'abc123',
      web_url: 'https://retyc.io/t/abc123',
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
      custom_model_name: null,
    }),
    uploadChunk: vi.fn().mockResolvedValue(undefined),
    downloadChunk: vi.fn(),
    getTransfer: vi.fn(),
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
    expect(result.webUrl).toBe('https://retyc.io/t/abc123')
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
        custom_model_name: null,
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

describe('uploadTransfer — onProgress', () => {
  it('emits correct cumulative ratio for a single multi-chunk file (concurrency=1)', async () => {
    // 100-byte file, chunkSize=40 → chunks 40/40/20 → ratios 0.4, 0.8, 1.0
    const api = makeApiMock({
      registerFile: vi.fn().mockResolvedValue({
        id: 'file-progress',
        chunk_count: 3,
        name_enc: '',
        type_enc: '',
        original_size: 100,
        encrypted_size: 200,
        share_id: 'transfer-123',
        custom_model_name: null,
      }),
    })

    const events: UploadProgress[] = []
    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(100, 0x01), size: 100 }],
      onProgress: (p) => events.push(p),
    }, 40, 1)

    expect(events).toHaveLength(3)
    expect(events[0].ratio).toBeCloseTo(0.4)
    expect(events[1].ratio).toBeCloseTo(0.8)
    expect(events[2].ratio).toBeCloseTo(1.0)
    expect(events[2].uploadedBytes).toBe(100)
    expect(events[2].totalBytes).toBe(100)
    expect(events[0].currentFile).toEqual({ name: 'f.bin', index: 0, total: 1 })
  })

  it('accumulates progress across multiple files', async () => {
    // toto.txt 10 bytes (1 chunk) + plop.bin 30 bytes (2 chunks of 20+10) = 40 total
    // → milestones: 10/40=0.25, 30/40=0.75, 40/40=1.0
    let registerCallCount = 0
    const api = makeApiMock({
      registerFile: vi.fn().mockImplementation(() => {
        return Promise.resolve({
          id: `file-${++registerCallCount}`,
          chunk_count: 1,
          name_enc: '',
          type_enc: '',
          original_size: 0,
          encrypted_size: 0,
          share_id: 'transfer-123',
          custom_model_name: null,
        })
      }),
    })

    const events: UploadProgress[] = []
    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [
        { name: 'toto.txt', mimeType: 'text/plain', data: Buffer.alloc(10), size: 10 },
        { name: 'plop.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(30), size: 30 },
      ],
      onProgress: (p) => events.push(p),
    }, 20, 1)

    expect(events).toHaveLength(3)
    expect(events[0].ratio).toBeCloseTo(10 / 40)
    expect(events[1].ratio).toBeCloseTo(30 / 40)
    expect(events[2].ratio).toBeCloseTo(1.0)
    expect(events[0].currentFile).toMatchObject({ name: 'toto.txt', index: 0, total: 2 })
    expect(events[2].currentFile).toMatchObject({ name: 'plop.bin', index: 1, total: 2 })
  })

  it('ratios are monotonically non-decreasing when chunks complete out of order', async () => {
    // uploadChunk resolves in reverse order: chunk 2 (20 B) first at 10ms, chunk 1 (40 B) at 20ms, chunk 0 (40 B) at 30ms
    // Without Math.max protection the shared counter still produces monotone values,
    // but this test catches any regression that would break that invariant under real concurrency.
    const api = makeApiMock({
      registerFile: vi.fn().mockResolvedValue({
        id: 'file-conc',
        chunk_count: 3,
        name_enc: '',
        type_enc: '',
        original_size: 100,
        encrypted_size: 200,
        share_id: 'transfer-123',
        custom_model_name: null,
      }),
      uploadChunk: vi.fn().mockImplementation((_fileId: string, chunkId: number) =>
        new Promise<void>(resolve => setTimeout(resolve, (3 - chunkId) * 10)),
      ),
    })

    const events: UploadProgress[] = []
    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(100, 0x01), size: 100 }],
      onProgress: (p) => events.push(p),
    }, 40, 3)

    expect(events).toHaveLength(3)
    // Chunk 2 (20 bytes) resolves first → first reported ratio is 0.2
    expect(events[0].ratio).toBeCloseTo(0.2)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ratio).toBeGreaterThanOrEqual(events[i - 1].ratio)
    }
    expect(events[events.length - 1].ratio).toBeCloseTo(1.0)
  }, 5000)

  it('adjusts totalBytes dynamically when actual data exceeds declared size across files', async () => {
    // file1: size=10 but data=80 bytes (severely underestimated).
    // file2: size=30, data=30 bytes.
    // Initial totalBytes=40. Without adjustment, totalBytes stays 40 and the events report
    // stale numbers. With adjustment, totalBytes grows to 80 then 110.
    let registerCallCount = 0
    const api = makeApiMock({
      registerFile: vi.fn().mockImplementation(() => Promise.resolve({
        id: `file-${++registerCallCount}`,
        chunk_count: 1,
        name_enc: '',
        type_enc: '',
        original_size: 0,
        encrypted_size: 0,
        share_id: 'transfer-123',
        custom_model_name: null,
      })),
    })

    const events: UploadProgress[] = []
    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [
        { name: 'f1.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(80), size: 10 },
        { name: 'f2.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(30), size: 30 },
      ],
      onProgress: (p) => events.push(p),
    }, 200, 1)

    expect(events).toHaveLength(2)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ratio).toBeGreaterThanOrEqual(events[i - 1].ratio)
    }
    expect(events[events.length - 1].ratio).toBe(1)
    // totalBytes in the events must have been adjusted upward to reflect actual bytes
    expect(events[0].totalBytes).toBeGreaterThanOrEqual(80)
    expect(events[1].totalBytes).toBeGreaterThanOrEqual(110)
  })

  it('emits guaranteed ratio=1 when file.size is larger than actual data', async () => {
    // size=100 but data is only 50 bytes → ratio from chunk = 0.5, then guaranteed 1.0
    const api = makeApiMock({
      registerFile: vi.fn().mockResolvedValue({
        id: 'file-drift',
        chunk_count: 1,
        name_enc: '',
        type_enc: '',
        original_size: 100,
        encrypted_size: 80,
        share_id: 'transfer-123',
        custom_model_name: null,
      }),
    })

    const events: UploadProgress[] = []
    await uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(50), size: 100 }],
      onProgress: (p) => events.push(p),
    }, 200, 1)

    expect(events.at(-1)!.ratio).toBe(1)
  })

  it('emits guaranteed ratio=1 for all-empty-file transfers', async () => {
    // size=0, data=empty → chunk.length=0 → ratio stays 0 → guaranteed 1.0 fires
    const events: UploadProgress[] = []
    await uploadTransfer(makeApiMock(), {
      recipients: [],
      expires: 0,
      files: [{ name: 'empty.txt', mimeType: 'text/plain', data: Buffer.alloc(0), size: 0 }],
      onProgress: (p) => events.push(p),
    })

    expect(events.at(-1)!.ratio).toBe(1)
  })

  it('swallows callback errors and completes the upload', async () => {
    let callCount = 0

    const result = await uploadTransfer(makeApiMock(), {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.txt', mimeType: 'text/plain', data: Buffer.from('hi'), size: 2 }],
      onProgress: () => {
        callCount++
        throw new Error('UI crash')
      },
    })

    expect(result.transferId).toBe('transfer-123')
    expect(callCount).toBeGreaterThan(0)
  })

  it('works without onProgress callback', async () => {
    await expect(uploadTransfer(makeApiMock(), {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.txt', mimeType: 'text/plain', data: Buffer.from('hi'), size: 2 }],
    })).resolves.toBeDefined()
  })
})

describe('uploadTransfer — error cleanup', () => {
  it('disables the transfer when finalizeTransfer fails', async () => {
    const api = makeApiMock({
      finalizeTransfer: vi.fn().mockRejectedValue(new Error('network error')),
      disableTransfer: vi.fn().mockResolvedValue(undefined),
    })

    await expect(uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.txt', mimeType: 'text/plain', data: Buffer.from('hi'), size: 2 }],
    })).rejects.toThrow('network error')

    expect(api.disableTransfer).toHaveBeenCalledWith('transfer-123')
  })

  it('still throws the original error even if disableTransfer also fails', async () => {
    const api = makeApiMock({
      finalizeTransfer: vi.fn().mockRejectedValue(new Error('finalize failed')),
      disableTransfer: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    })

    await expect(uploadTransfer(api, {
      recipients: [],
      expires: 0,
      files: [{ name: 'f.txt', mimeType: 'text/plain', data: Buffer.from('hi'), size: 2 }],
    })).rejects.toThrow('finalize failed')
  })
})
