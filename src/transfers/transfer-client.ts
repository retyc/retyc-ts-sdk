import type { FetchClient } from '../http/client.js'
import type {
  TransferCreateApiResponse,
  TransferCompletePayload,
  FileRegisterApiResponse,
  TransferDetailsApiResponse,
  FileMetaApiResponse,
  PageApiResponse,
} from './types.js'

export class TransferApiClient {
  constructor(private readonly http: FetchClient) {}

  async createTransfer(payload: {
    emails: string[]
    expires: number
    title?: string | null
    use_passphrase: boolean
  }): Promise<TransferCreateApiResponse> {
    return this.http.post<TransferCreateApiResponse>('/share', payload)
  }

  async finalizeTransfer(transferId: string, payload: TransferCompletePayload): Promise<void> {
    await this.http.put<void>(`/share/${transferId}/complete`, payload)
  }

  async registerFile(transferId: string, payload: {
    name_enc: string
    type_enc: string
    original_size: number
  }): Promise<FileRegisterApiResponse> {
    return this.http.post<FileRegisterApiResponse>(`/share/${transferId}/file`, payload)
  }

  async uploadChunk(fileId: string, chunkId: number, data: Uint8Array): Promise<void> {
    const formData = new FormData()
    formData.append('upload_file', new Blob([data.slice()]))
    await this.http.postMultipart(`/file/${fileId}/${chunkId}`, formData)
  }

  async downloadChunk(fileId: string, chunkId: number): Promise<Uint8Array> {
    return this.http.getBytes(`/file/${fileId}/${chunkId}`)
  }

  async getTransferDetails(transferId: string): Promise<TransferDetailsApiResponse> {
    return this.http.get<TransferDetailsApiResponse>(`/share/${transferId}/details`)
  }

  async getTransferFiles(transferId: string): Promise<FileMetaApiResponse[]> {
    const all: FileMetaApiResponse[] = []
    let page = 1
    while (true) {
      const res = await this.http.get<PageApiResponse<FileMetaApiResponse>>(
        `/share/${transferId}/files`,
        { page, size: 100 },
      )
      all.push(...res.items)
      if (page >= res.pages) break
      page++
    }
    return all
  }

  async disableTransfer(transferId: string): Promise<void> {
    await this.http.delete<void>(`/share/${transferId}`)
  }

  async forceDeleteTransfer(transferId: string): Promise<void> {
    await this.http.delete<void>(`/share/${transferId}/force`)
  }
}
