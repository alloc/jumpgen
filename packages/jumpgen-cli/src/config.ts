import escalade from 'escalade/sync'
import fs from 'fs'

export interface Config {
  generators: string[]
  tsconfig?: string
  format: 'esm' | 'cjs'
}

export function readConfig(cwd: string) {
  let config: Config | undefined
  let configPath: string | undefined

  const watchPaths: string[] = []
  escalade(cwd, (dir, names) => {
    watchPaths.push(dir + '/package.json')

    if (names.includes('package.json')) {
      let pkg: any
      try {
        pkg = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8'))
      } catch {}

      // Stop when we find the "codegentool" field.
      if (pkg?.codegentool && typeof pkg.codegentool === 'object') {
        config = pkg.codegentool
        configPath = dir + '/package.json'
        return dir
      }
    }

    // Stop at the repository root.
    if (names.includes('.git')) {
      return dir
    }
  })

  config = {
    generators: ['generators/**/*.{ts,mts,js,mjs}', '!**/node_modules/**'],
    format: 'cjs',
    ...config,
  }

  return {
    config,
    configPath,
    watchPaths,
  }
}
