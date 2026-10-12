export type RetycAuthErrorCode = 'not_authenticated' | 'session_expired' | 'unauthorized'

export class RetycAuthError extends Error {
  constructor(readonly code: RetycAuthErrorCode, message: string) {
    super(message)
    this.name = 'RetycAuthError'
  }
}
