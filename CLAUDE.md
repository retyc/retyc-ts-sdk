# Retyc TypeScript SDK — instructions for AI assistants

## General

- All comments, strings, and identifiers must be written in English.
- Do not add comments unless they explain a non-obvious WHY (intent, security trade-off, frontend mirror).
- Do not introduce features that are not explicitly requested.

## Source of truth

This SDK mirrors the cryptographic and transfer behaviour of the Retyc Nuxt/Vue frontend.

When in doubt about expected behaviour, the frontend is authoritative:

- `triplesfer/frontend/shared/utils/crypto-core.ts` — age primitives (scrypt, recipients, identity)
- `triplesfer/frontend/app/composables/use-age-crypto.ts` — crypto worker proxy (browser-only)
- `triplesfer/frontend/app/composables/use-share.ts` — share creation, file registration, finalization
- `triplesfer/frontend/app/composables/use-upload-form.ts` — full upload pipeline (session identity, ephemeral, message)
- `triplesfer/frontend/app/composables/use-download.ts` — chunk download + decryption
- `triplesfer/frontend/app/pages/transfer/[slug].vue` — `performDecryption` (account vs passphrase mode)
- `triplesfer/frontend/app/stores/user.ts` — user/key model and unlock flow
- `triplesfer/frontend/openapi/retyc/openapi.json` — canonical API contract

## Architecture

The public surface is a single class `RetycSDK` exposing three namespaces:

- `sdk.auth` — OAuth 2.0 Device Flow (Keycloak), token refresh, persistence via `TokenStore`
- `sdk.user` — `getMe()`, `getActiveKey()`
- `sdk.transfers` — `upload()`, `resolveSessionKey()`, `download()`, `disable()`, `forceDelete()`

Internal modules:

- `auth/` — OIDC discovery (`/login/config/public` + `.well-known/openid-configuration`), device flow polling, refresh, in-memory + file token stores
- `crypto/age.ts` — thin wrappers around `age-encryption` (Node.js, no Web Worker)
- `http/client.ts` — fetch wrapper with automatic 401 → refresh → retry, multipart upload, raw byte download
- `transfers/` — upload/download orchestration and the API client (one method per endpoint)
- `user/` — user API client
- `utils/concurrency.ts` — bounded parallel runner used for chunk upload/download

## Cryptographic conventions (must stay aligned with the frontend)

- **scrypt work factor**: `DEFAULT_SCRYPT_WORK_FACTOR = 18`. Identical to `crypto-core.ts` in the frontend. Used only for passphrase-based encryption (`encryptStringWithPassphrase`).
- **Identity generation**: `generateIdentity()` calls `generateHybridIdentity()` from `age-encryption` — produces a post-quantum hybrid age keypair (`age1pq1...`). Mirrors `generateSessionIdentity` in the frontend.
- **String encryption (`encryptString` / `decryptString`)**: armored output (`AGE ENCRYPTED FILE` PEM-like wrapper). Used for metadata (`name_enc`, `type_enc`, `message_enc`) and key wrapping (`session_private_key_enc`, `ephemeral_private_key_enc`, `session_private_key_enc_for_passphrase`). Mirrors `encryptStringWithRecipients` / `encryptStringWithPassphrase`.
- **Chunk encryption (`encryptChunk` / `decryptChunk`)**: raw bytes (no armor). Recipient-only (no scrypt). Mirrors `encryptChunkWithRecipient` / `decryptChunkWithIdentity`. Each file chunk is independently encrypted with the transfer's `session_public_key`.
- **Recipient list during upload**: the API returns `public_keys` from `POST /share` (one per recipient email that resolves to a registered user). The SDK encrypts the session private key for that exact list — never adds the sender's own key automatically. The frontend supports an `encryptWithMyKey` toggle that pushes the user's own key into that list before calling the API; the SDK does not (callers can pass their own public key as a recipient if they want this).

## Upload pipeline (must match `use-upload-form.ts:performUpload`)

1. `POST /share` with `{ emails, expires, title, use_passphrase }` → returns `id`, `slug`, `public_keys`.
2. Generate session identity (`generateIdentity`).
3. Encrypt `session_identity.privateKey` for `transfer.public_keys` → `session_private_key_enc`.
4. If a passphrase is set:
   - Generate an ephemeral identity.
   - `ephemeral_private_key_enc = encryptStringWithPassphrase(ephemeral.privateKey, passphrase)` (uses scrypt).
   - `session_private_key_enc_for_passphrase = encryptString(session.privateKey, [ephemeral.publicKey])`.
5. If a message is set: `message_enc = encryptString(message, [session.publicKey])`.
6. For each file: encrypt `name`, `mimeType` with `[session.publicKey]`, register with `POST /share/{id}/file`, then upload each chunk encrypted with `session.publicKey` to `POST /file/{file_id}/{chunk_id}`. Files are processed sequentially (bounded peak memory); chunks within a file are uploaded with bounded concurrency.
7. `PUT /share/{id}/complete` with all wrapped keys + `message_enc`.

## Download pipeline (two modes)

`resolveSessionKey(transferId, options)` mirrors `performDecryption`:

- **Account mode** (`{ privateKey }`): caller has already unlocked their age private key (typically via `decryptStringWithPassphrase(user.private_key_enc, keyPassword)`). The SDK reads `session_private_key_enc` from `/share/{id}/details` and decrypts it with the caller's identity. The caller's key password is never seen by the SDK.
- **Passphrase mode** (`{ transferPassphrase }`): the sender configured a passphrase. The SDK reads `ephemeral_private_key_enc` and `session_private_key_enc_for_passphrase`, decrypts the ephemeral private key with the passphrase (scrypt), then uses it to decrypt the session private key. Throws if the transfer was not created with `use_passphrase: true`.

`downloadTransfer(transferId, sessionKey, options)` then:

1. Pages through `/share/{id}/files` (size 100).
2. For each file: decrypts `name_enc` and `type_enc` with the session key, downloads each chunk in parallel (bounded), decrypts with the session key.
3. Files are processed sequentially (bounded peak memory).
4. If `outputPath` is set: each file is streamed to disk and `data` is `null`. File names are validated against path traversal (`..` segments and leading `/` are rejected — same rule as `assertSafePath` in `use-download.ts`).

## Intentional differences from the frontend

The frontend runs in the browser; the SDK runs in Node.js. These deltas are intentional:

- **No Web Worker / Comlink**. The frontend offloads age operations to `crypto.worker.ts` to keep the UI responsive; in Node.js the SDK calls `age-encryption` synchronously on the main thread.
- **No File System Access API / JSZip / `URL.createObjectURL`**. The SDK exposes `outputPath` (Node `fs` streaming) or in-memory `Buffer` instead.
- **No progress callbacks yet**. The frontend tracks per-chunk progress for UI; the SDK is a fire-and-forget API. Add this only if explicitly requested.
- **No streaming chunk upload through the API client**. The SDK reads each file fully into a `Buffer` before chunking. Streaming Readable input is accepted but is consumed fully via `readToBuffer` first. This bounds peak memory to one file at a time, not one chunk.
- **Folder uploads (`webkitRelativePath`)**. Browser-only concept; the SDK uses the literal `name` field of `UploadFile`.
- **No `encryptWithMyKey` shortcut**. The SDK does not know the caller's public key — pass it explicitly via `recipients` if needed.

## API client conventions

- All requests go through `FetchClient` which transparently handles 401 → refresh → retry once.
- Endpoints are typed via interfaces in `transfers/types.ts` and `user/types.ts`. These interfaces are intentionally narrow — they declare only the fields the SDK reads. The OpenAPI source of truth (`openapi.json`) has more fields; do not add ones the SDK does not use.
- Response status `204` returns `undefined` from `request<T>` (used for completion/disable/delete).

## Testing

- Tests live in `src/tests/*.spec.ts` and run with Vitest in the Node environment.
- `setup.ts` polyfills `globalThis.crypto` from `node:crypto.webcrypto` so `age-encryption` works on older Node versions.
- Crypto round-trip tests verify armor format for strings and raw bytes for chunks. Passphrase tests use higher timeouts because `DEFAULT_SCRYPT_WORK_FACTOR = 18` is intentionally slow.
- Mock `TransferApiClient` by passing a partial object cast to `as unknown as TransferApiClient`. Always include all method names listed in `transfer-client.ts` (use `vi.fn()` placeholders) so future additions surface as missing-method errors.

## Validation before merging changes

Always run all three before committing:

```bash
npx tsc --noEmit
npx vitest run
npm run build
```
