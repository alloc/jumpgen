import alias from 'esbuild-plugin-alias'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/generator.ts', 'src/context.ts'],
  format: ['esm'],
  dts: true,
  esbuildPlugins: [
    alias({
      fdir: new URL('../fdir/src/index.ts', import.meta.url).pathname,
    }),
  ],
})
