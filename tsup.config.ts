import { defineConfig } from 'tsup'

const shared = {
  dts: false,
  splitting: false,
  sourcemap: true,
} as const

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/node.ts'],
    format: ['esm', 'cjs'],
    clean: true,
    target: 'node22',
  },
  {
    ...shared,
    entry: { 'index.browser': 'src/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    esbuildPlugins: [{
      name: 'browser-file-sink',
      setup(build) {
        build.onResolve({ filter: /\/file-sink\.js$/ }, args => ({
          path: `${args.resolveDir}/file-sink.browser.ts`,
        }))
      },
    }],
  },
])
