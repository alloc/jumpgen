import escalade from 'escalade/sync'
import { mkdirSync } from 'fs'
import path from 'path'

export function getOutputFile(file: string, format: string) {
  const id = Math.random().toString(36).substring(2, 15)
  const cacheDir = path.join(nearestNodeModules(file), '.cache/codegentool')
  const outputFile = path.join(
    cacheDir,
    file.replace(
      /\.([mc]?[tj]s|[tj]sx)$/,
      `.bundled_${id}.${format === 'esm' ? 'mjs' : 'cjs'}`
    )
  )

  mkdirSync(path.dirname(outputFile), { recursive: true })
  return outputFile
}

export function nearestNodeModules(file: string) {
  const dir = escalade(path.dirname(file), (dir, names) => {
    if (names.includes('node_modules')) {
      return dir
    }
  })
  if (dir) {
    return path.join(dir, 'node_modules')
  }
  return 'node_modules'
}
