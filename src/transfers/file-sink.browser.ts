import type * as NodeFileSink from './file-sink.js'

function unsupported(): never {
  throw new Error('outputPath is only supported on Node.js.')
}

export const ensureDirectory: typeof NodeFileSink.ensureDirectory = unsupported
export const parentDirectory: typeof NodeFileSink.parentDirectory = unsupported
export const openForWrite: typeof NodeFileSink.openForWrite = unsupported
export const resolveSafeDestination: typeof NodeFileSink.resolveSafeDestination = unsupported
