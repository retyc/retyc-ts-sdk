<p align="center"><img width="200" src="https://raw.githubusercontent.com/retyc/retyc-ts-sdk/master/.media/Retyc_Logo_Blue.png" alt="Retyc logo" /></p>

<p align="center">
  <a href="https://github.com/retyc/retyc-ts-sdk/actions/workflows/ci.yml"><img src="https://github.com/retyc/retyc-ts-sdk/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/retyc/retyc-ts-sdk/releases/latest"><img src="https://img.shields.io/github/v/release/retyc/retyc-ts-sdk" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

# Retyc TypeScript SDK

> Official TypeScript SDK for [Retyc](https://retyc.com) — manage file transfers programmatically

---

## What is Retyc?

[Retyc](https://retyc.com) is a European sovereign file-sharing platform with end-to-end post-quantum encryption. Data stays in Europe, GDPR-compliant by design.

`@retyc/sdk` lets you integrate Retyc transfers into your scripts, pipelines and workflows — no browser required.

---

## Installation

```bash
npm install @retyc/sdk
# or
pnpm add @retyc/sdk
# or
yarn add @retyc/sdk
```

---

## Usage

### Initialize the client

```ts
import { RetycSDK } from '@retyc/sdk'
import { FileTokenStore } from '@retyc/sdk/node'

const sdk = new RetycSDK({
  apiUrl: 'https://api.retyc.com',
  // Persist tokens across restarts (optional, defaults to in-memory)
  tokenStore: new FileTokenStore('/home/user/.retyc/tokens.json'),
})
```

---

### Authentication (Device Flow)

Retyc uses the OAuth 2.0 Device Authorization Grant. The user authenticates in their browser while your script polls for the token.

```ts
// Start the device flow
const flow = await sdk.auth.startDeviceFlow()

// Show the user where to authenticate
console.log(`Open ${flow.verificationUri} and enter code: ${flow.userCode}`)
// Or use the direct link if available:
// console.log(`Or visit: ${flow.verificationUriComplete}`)

// Wait until the user completes authentication
const tokens = await flow.poll()

console.log('Authenticated! Access token expires at:', tokens.expiresAt)
```

The SDK requests the `openid` scope. Pass `scopes` to request more (duplicates are ignored):

```ts
const flow = await sdk.auth.startDeviceFlow({ scopes: ['offline_access'] })
```

#### Reloading an existing session

If tokens were persisted (e.g. via `FileTokenStore`), the SDK auto-refreshes them on the first request — no extra setup needed.

```ts
const tokens = await sdk.auth.getTokens()
if (!tokens) {
  // Run device flow...
}
```

Optionally, call `preload()` once on startup to pre-fetch the OIDC config and avoid latency on the first refresh:

```ts
await sdk.preload()
```

#### Manual refresh

The SDK refreshes tokens automatically when needed (on expiry or on a 401). You can also force a refresh manually:

```ts
const tokens = await sdk.auth.refresh()
```

#### Logout

```ts
await sdk.auth.logout()
```

---

### User

```ts
// Fetch the authenticated user's profile
const { user, extra_data, roles } = await sdk.user.getMe()
console.log(user.email, user.full_name, roles)

// Fetch the active age keypair (encrypted private key + public key)
const key = await sdk.user.getActiveKey()
console.log(key.public_key, key.status) // status: 'active' | 'pending' | 'revoked'
```

---

### Transfers

#### Upload

```ts
import { readFileSync, statSync } from 'node:fs'

const result = await sdk.transfers.upload({
  recipients: ['alice@example.com', 'bob@example.com'],
  title: 'Q1 Report',
  expires: 7, // days
  files: [
    {
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: readFileSync('./report.pdf'),
      size: statSync('./report.pdf').size,
    },
  ],
})

console.log('Transfer created:', result.transferId)
console.log('Share link:', result.webUrl)
```

Optional settings:

```ts
await sdk.transfers.upload({
  recipients: ['alice@example.com'],
  expires: 7,
  files: [/* ... */],
  // Lets recipients without a Retyc account decrypt the transfer
  passphrase: 'a-strong-passphrase',
  // End-to-end encrypted message shown to recipients
  message: 'Here is the report.',
  // Default: true. Also wraps the session key for your own active key so you can
  // decrypt your own transfer. Set to false for accounts without an active key.
  encryptWithMyKey: true,
  onProgress: ({ ratio, currentFile }) => {
    console.log(`${Math.round(ratio * 100)}% (${currentFile.name})`)
  },
})
```

`data` accepts a `Buffer`, a `Uint8Array` or a `Readable`. Each file is fully read into memory before being chunked, so peak memory is roughly the size of the largest file.

#### Download

Downloading requires two steps: resolve the transfer session key, then download the files.

#### With a Retyc account (private key)

```ts
import { writeFileSync } from 'node:fs'
import { decryptStringWithPassphrase } from '@retyc/sdk'

// 1. Fetch your encrypted private key and unlock it with your key password
const { private_key_enc } = await sdk.user.getActiveKey()
const privateKey = await decryptStringWithPassphrase(private_key_enc!, 'your-key-password')

// 2. Resolve the transfer session key
const sessionKey = await sdk.transfers.resolveSessionKey('transfer-id', { privateKey })

// 3. Download and decrypt files
const files = await sdk.transfers.download('transfer-id', sessionKey)

for (const file of files) {
  writeFileSync(file.name, file.data!)
}
```

#### Without an account (transfer passphrase)

When the sender protected the transfer with a passphrase, no account key is needed.

```ts
const sessionKey = await sdk.transfers.resolveSessionKey('transfer-id', {
  transferPassphrase: 'the-passphrase-shared-by-the-sender',
})

const files = await sdk.transfers.download('transfer-id', sessionKey)
```

#### Streaming to disk (large files)

By default files are buffered in memory (`file.data: Buffer`). For large transfers, pass `outputPath` to stream directly to disk — `file.data` will be `null`.

```ts
const files = await sdk.transfers.download('transfer-id', sessionKey, {
  outputPath: '/tmp/retyc-downloads',
})

for (const file of files) {
  console.log(`Saved ${file.name} (${file.size} bytes)`)
}
```

The output directory is created automatically, as are sub-directories carried by file names (folder uploads from the web app). Absolute file names and names with a `..` segment are rejected. Files with the same name overwrite each other.

#### Manage transfers

```ts
// Fetch a transfer's metadata (status, title, creation date...)
const transfer = await sdk.transfers.get('transfer-id')
console.log(transfer.status)

// Disable a transfer (recipients can no longer access it)
await sdk.transfers.disable('transfer-id')

// Permanently delete a transfer and all its files
await sdk.transfers.forceDelete('transfer-id')
```

---

## API Reference

### `new RetycSDK(config)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiUrl` | `string` | — | Retyc API base URL |
| `tokenStore` | `TokenStore` | `InMemoryTokenStore` | Where to persist OAuth tokens |
| `chunkSize` | `number` | `8388608` (8 MB) | Upload chunk size in bytes |
| `uploadConcurrency` | `number` | `4` | Max concurrent chunk uploads |
| `downloadConcurrency` | `number` | `4` | Max concurrent chunk downloads |

### `sdk.auth`

| Method | Returns | Description |
| --- | --- | --- |
| `startDeviceFlow(options?)` | `DeviceFlowResult` | Initiate the OAuth 2.0 Device Authorization Grant. `options.scopes` adds scopes to the default `openid`. Call `.poll()` on the result to wait for the user. |
| `refresh()` | `TokenSet` | Force a token refresh using the stored refresh token. Refreshes are otherwise triggered automatically. |
| `getTokens()` | `TokenSet \| null` | Read the currently stored tokens (or `null` if not authenticated). |
| `logout()` | `void` | Clear stored tokens. |

`sdk.preload()` optionally pre-fetches the OIDC configuration.

### `sdk.user`

| Method | Returns | Description |
| --- | --- | --- |
| `getMe()` | `UserApiResponse` | Authenticated user profile + OIDC extra data + roles |
| `getActiveKey()` | `UserKeyApiResponse` | Active age keypair (`public_key`, `private_key_enc`, `status`) |
| `getUploadCapabilities()` | `UploadCapabilitiesApiResponse` | Plan limits (max transfer size, max expiration...) and feature flags |
| `getUserQuota()` | `UserQuotaApiResponse` | Current usage against the plan quota |

### `sdk.transfers`

| Method | Returns | Description |
| --- | --- | --- |
| `upload(options)` | `UploadResult` | Create, encrypt and upload a transfer. Returns `transferId`, `slug` and `webUrl`. |
| `get(transferId)` | `TransferApiResponse` | Transfer metadata |
| `resolveSessionKey(transferId, options)` | `string` | Decrypt the transfer session key with `{ privateKey }` or `{ transferPassphrase }` |
| `download(transferId, sessionKey, options?)` | `DownloadedFile[]` | Download and decrypt all files, in memory or to `outputPath` |
| `disable(transferId)` | `void` | Revoke access to a transfer |
| `forceDelete(transferId)` | `void` | Permanently delete a transfer and its files |

### Token stores

| Class | Description |
| --- | --- |
| `InMemoryTokenStore` | Default. Tokens are lost when the process exits. |
| `FileTokenStore(path)` | Node.js only, imported from `@retyc/sdk/node`. Persists tokens to a JSON file on disk, readable by the current OS user only (`0600`). Not encrypted at rest. |

You can implement the `TokenStore` interface (`get`, `set`, `clear`) to use any custom storage backend (keychain, database, browser extension storage, etc.). `isTokenSet(value)` validates data read back from your storage.

When several contexts share one store (tabs, iframes, workers), implement the optional `withLock(fn)` method — for example on top of `navigator.locks` — so that only one of them spends the refresh token; the others reuse the tokens it stored.

Authentication failures throw a `RetycAuthError` whose `code` is `not_authenticated` (no stored session), `session_expired` (refresh token rejected, session cleared) or `unauthorized` (the API still answered `401` after a token refresh).

Bundlers targeting the browser resolve `@retyc/sdk` to a build with no dependency on Node.js built-in modules (`browser` export condition). `download()` with `outputPath` is Node.js only and throws in that build; a global `Buffer` is still required.

---

## License

[MIT](LICENSE) — © Retyc / TripleStack SAS
