import { describe, it, expect } from 'vitest'
import {
  generateIdentity,
  encryptString,
  decryptString,
  encryptStringWithPassphrase,
  decryptStringWithPassphrase,
  encryptChunk,
  decryptChunk,
} from '../crypto/age.js'

describe('age crypto — string round-trip', () => {
  it('encrypts and decrypts with public/private key', async () => {
    const identity = await generateIdentity()
    const plaintext = 'Hello, world!'

    const encrypted = await encryptString(plaintext, [identity.publicKey])
    expect(encrypted).toContain('AGE ENCRYPTED FILE')

    const decrypted = await decryptString(encrypted, identity.privateKey)
    expect(decrypted).toBe(plaintext)
  })

  it('encrypts for multiple recipients', async () => {
    const alice = await generateIdentity()
    const bob = await generateIdentity()
    const plaintext = 'Secret message'

    const encrypted = await encryptString(plaintext, [alice.publicKey, bob.publicKey])

    expect(await decryptString(encrypted, alice.privateKey)).toBe(plaintext)
    expect(await decryptString(encrypted, bob.privateKey)).toBe(plaintext)
  })

  it('throws with wrong key', async () => {
    const alice = await generateIdentity()
    const bob = await generateIdentity()

    const encrypted = await encryptString('secret', [alice.publicKey])
    await expect(decryptString(encrypted, bob.privateKey)).rejects.toThrow()
  })
})

describe('age crypto — passphrase round-trip', () => {
  it('encrypts and decrypts with passphrase', async () => {
    const passphrase = 'my-secure-passphrase'
    const plaintext = 'AGE-SECRET-KEY-1ABCDEF...'

    const encrypted = await encryptStringWithPassphrase(plaintext, passphrase)
    expect(encrypted).toContain('AGE ENCRYPTED FILE')

    const decrypted = await decryptStringWithPassphrase(encrypted, passphrase)
    expect(decrypted).toBe(plaintext)
  }, 15000)

  it('throws with wrong passphrase', async () => {
    const encrypted = await encryptStringWithPassphrase('secret', 'correct-passphrase')
    await expect(decryptStringWithPassphrase(encrypted, 'wrong-passphrase')).rejects.toThrow()
  }, 15000)
})

describe('age crypto — binary chunk round-trip', () => {
  it('encrypts and decrypts a data buffer', async () => {
    const identity = await generateIdentity()
    const data = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255])

    const encrypted = await encryptChunk(data, identity.publicKey)
    expect(encrypted).not.toEqual(data)

    const decrypted = await decryptChunk(encrypted, identity.privateKey)
    expect(decrypted).toEqual(data)
  })

  it('encrypts a 1 MB chunk', async () => {
    const identity = await generateIdentity()
    const data = new Uint8Array(1024 * 1024).fill(42)

    const encrypted = await encryptChunk(data, identity.publicKey)
    const decrypted = await decryptChunk(encrypted, identity.privateKey)
    expect(decrypted).toEqual(data)
  }, 10000)
})

describe('generateIdentity', () => {
  it('generates keys in the correct format', async () => {
    const { publicKey, privateKey } = await generateIdentity()
    expect(publicKey).toMatch(/^age1/)
    expect(privateKey).toMatch(/^AGE-SECRET-KEY-/)
  })

  it('generates unique keys on each call', async () => {
    const a = await generateIdentity()
    const b = await generateIdentity()
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(a.privateKey).not.toBe(b.privateKey)
  })
})
