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
import { RetycSDK, FileTokenStore } from '@retyc/sdk'

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

#### Reloading an existing session

If tokens were persisted (e.g. via `FileTokenStore`), call `preload()` once on startup so the SDK can refresh them without prompting the user again:

```ts
await sdk.preload()

// Check if already authenticated
const tokens = await sdk.auth.getTokens()
if (!tokens) {
  // Run device flow...
}
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
console.log('Share link: https://retyc.com/share/' + result.slug)
```

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

The output directory is created automatically. File names containing `..` or starting with `/` are rejected.

#### Manage transfers

```ts
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

### `sdk.user`

| Method | Returns | Description |
| --- | --- | --- |
| `getMe()` | `UserApiResponse` | Authenticated user profile + OIDC extra data + roles |
| `getActiveKey()` | `UserKeyApiResponse` | Active age keypair (`public_key`, `private_key_enc`, `status`) |

### Token stores

| Class | Description |
| --- | --- |
| `InMemoryTokenStore` | Default. Tokens are lost when the process exits. |
| `FileTokenStore(path)` | Persists tokens to a JSON file on disk. |

You can implement the `TokenStore` interface to use any custom storage backend (keychain, database, etc.).

---

## License

[MIT](LICENSE) — © Retyc / TripleStack SAS
