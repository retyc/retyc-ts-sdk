import { mkdirSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

// Every Node.js built-in used by downloads lives here: the browser build swaps this module for
// file-sink.browser.ts (see tsup.config.ts), so both files must export the same functions.

export function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true })
}

export function parentDirectory(file: string): string {
  return path.dirname(file)
}

export function openForWrite(destination: string): Promise<Pick<FileHandle, 'writeFile' | 'close'>> {
  return open(destination, 'w')
}

// Mirrors frontend/app/composables/use-download.ts:assertSafePath — guards against path traversal
// when filenames are decrypted from untrusted ciphertext. Names may carry sub-directories
// (folder uploads from the web app), which are recreated under outputPath. Backslashes are
// treated as separators and the resolved path is re-checked so the guard also holds on Windows.
export function resolveSafeDestination(outputPath: string, name: string): string {
  const segments = name.split(/[\\/]/)
  const root = path.resolve(outputPath)
  const destination = path.resolve(root, name)
  const relative = path.relative(root, destination)
  if (
    name.length === 0
    || name.includes('\0')
    || /^[\\/]/.test(name)
    || path.isAbsolute(name)
    || segments.some(seg => seg === '..')
    || relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`Unsafe file name: ${name}`)
  }
  return destination
}
