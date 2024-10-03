#!/usr/bin/env node
import builtinModules from 'builtin-modules'
import { Options as RequireOptions, bundleRequire } from 'bundle-require'
import cac from 'cac'
import { watch } from 'chokidar'
import dedent from 'dedent'
import { dequal } from 'dequal'
import glob from 'fast-glob'
import fs from 'fs'
import kleur from 'kleur'
import { parseModule } from 'meriyah'
import path from 'path'
import resolve from 'resolve'
import serialize from 'serialize-javascript'
import { transform } from 'sucrase'
import { Config, readConfig } from '../packages/jumpgen-cli/src/config'
import type { API, ParseModuleOptions } from './api'
import { getOutputFile } from './util'

const program = cac('codegentool')

type Options = {
  watch: boolean
}

program
  .command('')
  .option('--watch, -w', 'Enable file watching and automatic reruns')
  .action(options => start(process.cwd(), options))

program.parse()

async function start(cwd: string, options: Options) {
  const { config, configPath, watchPaths } = readConfig(cwd)
  if (configPath) {
    process.chdir(path.dirname(configPath))
  }

  const generators = new Map<string, Promise<() => void>>()
  const watcher = watch([...config.generators, ...watchPaths], {
    ignoreInitial: false,
  })

  const regenerateQueue = new Set<string>()
  const regenerate = debounce(() => {
    for (const name of regenerateQueue) {
      const promise = generators.get(name) ?? Promise.resolve()
      promise
        .then(close => close?.())
        .then(() => {
          generators.set(name, generate(name, config))
        })
    }
    regenerateQueue.clear()
  }, 100)

  let initialized = false
  watcher.on('all', (event, name) => {
    if (name.endsWith('package.json')) {
      if (!initialized) return

      const configResult = readConfig(process.cwd())
      if (
        !dequal(config, configResult.config) ||
        !dequal(watchPaths, configResult.watchPaths)
      ) {
        watcher.close()
        generators.forEach(async close => (await close)())
        start(cwd, options)
      }
    } else if (event == 'add' || event == 'change') {
      regenerateQueue.add(name)
      regenerate()
    }
  })

  await new Promise<void>(resolve => {
    watcher.once('ready', () => {
      initialized = true
      if (options.watch) {
        resolve()
      } else {
        watcher.close()
        // Wait for the generators map to be populated.
        setTimeout(resolve, 100)
      }
    })
  })

  if (options.watch) {
    console.log(`⌘ Watching for changes...`)
  } else {
    generators.forEach(async close => (await close)())
  }
}

async function generate(generatorPath: string, config: Config) {
  const watcher = watch([], {
    ignoreInitial: true,
  })

  let close = Promise.resolve(() => {
    watcher.close()
  })

  // Regenerate when a file changes.
  watcher.on(
    'all',
    debounce(() => {
      watcher.close()
      close = generate(generatorPath, config)
    }, 500)
  )

  // Support module resolution for TypeScript and JavaScript files.
  const resolveModule = (id: string, importer: string) =>
    resolve.sync(id, {
      extensions: ['.ts', '.js', '.mts', '.cts', '.mjs', '.cjs'],
      basedir: path.dirname(importer),
    })

  const resolvePlugin = {
    name: 'resolve-module',
    setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => {
        if (builtinModules.includes(args.path)) {
          return
        }
        try {
          return {
            path: resolveModule(args.path, args.importer),
          }
        } catch {}
      })
    },
  }

  const requireOptions: Partial<RequireOptions> = {
    tsconfig: config.tsconfig,
    format: config.format,
    esbuildOptions: {
      sourcemap: 'inline',
      logLevel: 'silent',
      plugins: [resolvePlugin],
    },
  }

  try {
    console.log(
      `▶ Running %s`,
      kleur.cyan(path.relative(process.cwd(), generatorPath))
    )

    let outputPath!: string

    // Note: You can use BUNDLE_REQUIRE_PRESERVE=1 to prevent deletion of the bundle on process exit
    // (for debugging purposes).
    const {
      mod: { default: generator },
      dependencies,
    } = await bundleRequire({
      ...requireOptions,
      filepath: generatorPath,
      getOutputFile: (file, format) => {
        return (outputPath = getOutputFile(file, format))
      },
    })

    if (typeof generator !== 'function') {
      throw new Error(`Generator must default export a function`)
    }

    watcher.add(dependencies.filter(file => file !== generatorPath))

    let filesGenerated = 0

    const seenErrors = new Set<string>()
    const watchPaths = new Set<string>()

    const read = (
      file: string,
      options?:
        | {
            encoding?: BufferEncoding | null | undefined
            flag?: string | undefined
          }
        | BufferEncoding
        | null
    ): any => {
      file = path.resolve(file)
      watchPaths.add(file)
      return fs.readFileSync(file, options)
    }

    const api: API = {
      scan: (source, options) => {
        const cwd = path.resolve(options?.cwd || '.')
        if (Array.isArray(source)) {
          source.forEach(s => watchPaths.add(path.resolve(cwd, s)))
        } else {
          watchPaths.add(path.resolve(cwd, source))
        }
        return glob.sync(source, options)
      },
      read,
      write: (file, data) => {
        if (typeof data === 'string') {
          let current: string | undefined
          try {
            current = fs.readFileSync(file, 'utf8')
          } catch {}

          if (data !== current) {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, data)

            filesGenerated++
            console.log(
              `✔️ Generated %s`,
              kleur.green(path.relative(process.cwd(), file))
            )
          }
        } else {
          let current: Buffer | undefined
          try {
            current = fs.readFileSync(file)
          } catch {}

          if (!current?.equals(data)) {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, data)

            filesGenerated++
            console.log(
              `✔️ Generated %s`,
              kleur.green(path.relative(process.cwd(), file))
            )
          }
        }
      },
      writeEnv: (file, data) => {
        const encodeValue = (value: string) =>
          JSON.stringify(String(value)).slice(1, -1)

        if (fs.existsSync(file)) {
          let changed = false

          // Parse the existing env file and replace the keys defined in data.
          const existing = fs.readFileSync(file, 'utf8')
          const existingLines = existing.trimEnd().split('\n')

          const foundKeys = new Set<string>()
          const newLines = existingLines.map(line => {
            if (line[0] === '#' || line.trim() === '') {
              return line
            }

            let [key, value] = line.split('=')
            key = key.trim()
            value = value.trim()
            foundKeys.add(key)

            if (data[key] !== undefined && data[key] !== value) {
              changed = true
              if (data[key] === null) {
                return null
              }
              return `${key}=${encodeValue(data[key])}`
            }
            return line
          })
          for (const key of Object.keys(data)) {
            if (!foundKeys.has(key) && data[key] != null) {
              changed = true
              newLines.push(`${key}=${encodeValue(data[key])}`)
            }
          }

          if (changed) {
            fs.writeFileSync(
              file,
              newLines.filter(line => line !== null).join('\n') +
                (existing.endsWith('\n') ? '\n' : '')
            )
            console.log(
              `✔️ Updated env file %s`,
              kleur.green(path.relative(process.cwd(), file))
            )
          }
        } else {
          fs.writeFileSync(
            file,
            Object.entries(data)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}=${encodeValue(v)}`)
              .join('\n') + '\n'
          )
          console.log(
            `✔️ Created env file %s`,
            kleur.green(path.relative(process.cwd(), file))
          )
        }
      },
      dedent,
      serialize,
      parseModule: (file, options) => {
        file = path.resolve(file)
        return parse(read(file, 'utf8'), file, options)
      },
      parseModuleText: (code, options, file) => {
        return parse(code, file ?? '<unknown>', options)
      },
      loadModule: async (id, basedir) => {
        const isBareSpec = !id.startsWith('./') && !id.startsWith('../')
        try {
          if (!isBareSpec) {
            id = path.resolve(basedir ?? path.dirname(generatorPath), id)
          }
          id = resolveModule(id, outputPath)
        } catch (error: any) {
          console.error(error.message)
          return null
        }

        try {
          if (isBareSpec) {
            return await import(id)
          } else {
            // Note: You can use BUNDLE_REQUIRE_PRESERVE=1 to prevent deletion of the bundle on
            // process exit (for debugging purposes).
            const { mod, dependencies } = await bundleRequire({
              ...requireOptions,
              filepath: id,
              getOutputFile,
            })
            watcher.add(dependencies)
            return mod
          }
        } catch (error: any) {
          const message = (error && (error.stack || error.message)) || error
          if (seenErrors.has(message)) {
            return null
          }
          seenErrors.add(message)
          console.error(`Error loading module "${id}"`)
          if (error.errors) {
            console.error(error.message)
          } else {
            console.error(error)
          }
          return null
        }
      },
    }

    await generator(api)

    if (!filesGenerated) {
      console.log(
        `✔️ Nothing updated by %s`,
        kleur.cyan(path.relative(process.cwd(), generatorPath))
      )
    }

    // If the generator throws, only the generator is watched.
    watcher.add([...watchPaths])
  } catch (error: any) {
    console.error(`Error in ${path.resolve(generatorPath)}`)
    console.error(error)
  }

  return async () => (await close)()
}

function debounce<T extends (...args: any[]) => any>(fn: T, wait: number): T {
  let timeout: NodeJS.Timeout
  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timeout)
    timeout = setTimeout(() => fn.apply(this, args), wait)
  } as T
}

function parse(code: string, filePath: string, options?: ParseModuleOptions) {
  const type = filePath.match(/\.[^.]+$/)?.[0]
  const isJSX = type === '.jsx' || type === '.tsx'
  const isTS =
    type === '.ts' || type === '.tsx' || type === '.mts' || type === '.cts'

  try {
    let transforms = options?.transforms || []
    if (isTS && !transforms.includes('typescript')) {
      transforms = [...transforms, 'typescript']
    }
    let transformOptions = options?.transformOptions || {}
    if (isJSX && !transforms.includes('jsx')) {
      transformOptions = { ...transformOptions, jsxRuntime: 'preserve' }
      transforms = [...transforms, 'jsx']
    }
    if (transforms.length) {
      const transformResult = transform(code, {
        ...options?.transformOptions,
        transforms,
        filePath,
      })
      code = transformResult.code
    }
    return parseModule(code, { next: true, jsx: isJSX, ...options })
  } catch (error: any) {
    error.message = `Error parsing ${filePath}: ${error.message}`
    throw error
  }
}
