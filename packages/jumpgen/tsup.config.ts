import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/generator.ts', 'src/context.ts'],
  format: ['esm'],
  dts: true,
})
