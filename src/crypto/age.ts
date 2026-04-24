import {
  Encrypter,
  Decrypter,
  generateHybridIdentity,
  identityToRecipient,
  armor,
} from 'age-encryption'
import type { AgeIdentityPair } from './types.js'

export const DEFAULT_SCRYPT_WORK_FACTOR = 18

export async function generateIdentity(): Promise<AgeIdentityPair> {
  const privateKey = await generateHybridIdentity()
  const publicKey = await identityToRecipient(privateKey)
  return { publicKey, privateKey }
}

export async function encryptString(plaintext: string, recipients: string[]): Promise<string> {
  const e = new Encrypter()
  for (const r of recipients) e.addRecipient(r)
  const ciphertext = await e.encrypt(plaintext)
  return armor.encode(ciphertext)
}

export async function decryptString(ciphertext: string, identity: string): Promise<string> {
  const d = new Decrypter()
  d.addIdentity(identity)
  return d.decrypt(armor.decode(ciphertext), 'text')
}

export async function encryptStringWithPassphrase(
  plaintext: string,
  passphrase: string,
  scryptWorkFactor: number = DEFAULT_SCRYPT_WORK_FACTOR,
): Promise<string> {
  const e = new Encrypter()
  e.setScryptWorkFactor(scryptWorkFactor)
  e.setPassphrase(passphrase)
  const ciphertext = await e.encrypt(plaintext)
  return armor.encode(ciphertext)
}

export async function decryptStringWithPassphrase(ciphertext: string, passphrase: string): Promise<string> {
  const d = new Decrypter()
  d.addPassphrase(passphrase)
  return d.decrypt(armor.decode(ciphertext), 'text')
}

export async function encryptChunk(data: Uint8Array, recipient: string): Promise<Uint8Array> {
  const e = new Encrypter()
  e.addRecipient(recipient)
  return e.encrypt(data)
}

export async function decryptChunk(data: Uint8Array, identity: string): Promise<Uint8Array> {
  const d = new Decrypter()
  d.addIdentity(identity)
  return d.decrypt(data)
}
