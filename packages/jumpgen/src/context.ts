import chokidar from 'chokidar'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { isArray, isString } from 'radashi'
import { globSync } from 'tinyglobby'
import { dedent } from './util/dedent'
import { MatcherArray } from './util/matcher-array'

export const kJumpgenContext = Symbol('jumpgenContext')

export type JumpgenContext = ReturnType<typeof createJumpgenContext>

export type JumpgenEvents = {
  start: [generatorName: string]
  write: [file: string, generatorName: string]
  finish: [result: any, generatorName: string]
  error: [error: Error, generatorName: string]
}

export type JumpgenEventEmitter = EventEmitter<JumpgenEvents>

export type JumpgenOptions = {
  /**
   * The directory from which all file operations are relative.
   *
   * @default process.cwd()
   */
  root?: string
  /**
   * Enable watch mode. Optionally, provide an array of paths to watch,
   * which will rerun the generator if they are changed.
   *
   * @default false
   */
  watch?: boolean | string[]
  /**
   * Override the default event emitter. Useful for consolidating events
   * across multiple generators.
   */
  events?: JumpgenEventEmitter
}

export type GlobOptions = import('tinyglobby').GlobOptions & {
  /**
   * If set to `false`, the globs won't be watched when jumpgen runs in
   * watch mode.
   *
   * @default true
   */
  watch?: boolean
}

export type ListOptions = {
  /**
   * If set to `true`, the file paths will be absolute.
   *
   * @default false
   */
  absolute?: boolean
  /**
   * If set to `false`, the directory won't be watched when jumpgen runs in
   * watch mode.
   *
   * @default true
   */
  watch?: boolean
}

export function createJumpgenContext(
  generatorName: string,
  options: JumpgenOptions = {}
) {
  const { events = new EventEmitter(), watch = false } = options
  const root = options.root ? path.resolve(options.root) : process.cwd()

  const matcher = new MatcherArray()
  const watcher = watch
    ? chokidar.watch([], {
        ignored(file) {
          return !matcher.match(file)
        },
        ignoreInitial: true,
        ignorePermissionErrors: true,
      })
    : undefined

  // Update the watcher when matchers are added or removed.
  matcher.watcher = watcher

  let ctrl: AbortController

  reset()

  function reset() {
    ctrl = new AbortController()
    matcher.clear()

    const initialPaths = isArray(watch) ? watch : undefined
    initialPaths?.forEach(p => {
      p = path.resolve(root, p)
      if (isExistingFile(p)) {
        matcher.addFile(p)
      } else {
        matcher.add(p)
      }
    })
  }

  /**
   * Scan the filesystem for files matching the given glob pattern. File
   * paths are allowed to be relative. In watch mode, the matching files
   * will be watched for changes, unless this function was called with the
   * `watch` option set to `false`.
   */
  function scan(
    source: string | string[],
    options: GlobOptions = {}
  ): string[] {
    options.cwd = path.resolve(root, options.cwd ?? '.')
    if (options.watch !== false) {
      matcher.add(source, options)
    }
    return globSync(source, options)
  }

  /**
   * List the children of a directory. The directory is allowed to be a
   * relative path. In watch mode, the directory will be watched for
   * changes.
   */
  function list(dir: string, options?: ListOptions): string[] {
    dir = path.resolve(root, dir)
    if (options?.watch !== false) {
      matcher.add(path.join(dir, '*'), { dot: true })
    }
    const children = fs.readdirSync(dir)
    if (options?.absolute) {
      return children.map(child => path.resolve(dir, child))
    }
    return children
  }

  /**
   * Read a file from the filesystem. File paths are allowed to be
   * relative. In watch mode, the file will be watched for changes.
   */
  function read(
    path: string,
    options?: {
      encoding?: null | undefined
      flag?: string | undefined
    } | null
  ): Buffer

  function read(
    path: string,
    options:
      | {
          encoding: BufferEncoding
          flag?: string | undefined
        }
      | BufferEncoding
  ): string

  function read(
    path: string,
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): string | Buffer

  function read(
    file: string,
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): any {
    file = path.resolve(root, file)

    matcher.addFile(file)
    return fs.readFileSync(file, options)
  }

  /**
   * Similar to `read` except that it returns `null` if the file does not
   * exist, instead of throwing an error.
   */
  function tryRead(
    path: string,
    options?: {
      encoding?: null | undefined
      flag?: string | undefined
    } | null
  ): Buffer | null

  function tryRead(
    path: string,
    options:
      | {
          encoding: BufferEncoding
          flag?: string | undefined
        }
      | BufferEncoding
  ): string | null

  function tryRead(
    path: string,
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): string | Buffer | null

  function tryRead(
    file: string,
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): any {
    try {
      return read(file, options)
    } catch {
      return null
    }
  }

  /**
   * Write a file to the filesystem. If a parent directory does not exist,
   * it will be created. File paths are allowed to be relative. Emits a
   * `write` event after the file is written.
   */
  function write(file: string, data: string | Buffer): void {
    file = path.resolve(root, file)

    try {
      if (isString(data)) {
        if (fs.readFileSync(file, 'utf8') === data) {
          return
        }
      } else {
        if (fs.readFileSync(file).equals(data)) {
          return
        }
      }
    } catch {}

    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
    events.emit('write', file, generatorName)
  }

  function abort() {
    ctrl.abort()
  }

  return {
    [kJumpgenContext]: true,
    root,
    get watchedFiles() {
      return matcher.watchedFiles
    },
    watcher,
    /**
     * Events related to the generator.
     *
     * - "write" when a file is written
     * - "finish" when a generator completes
     * - "error" when an error occurs
     */
    events,
    /**
     * If your generator is asynchronous, use this AbortSignal to ensure it
     * can be interrupted when a file is changed.
     */
    get signal() {
      return ctrl.signal
    },
    /**
     * Remove excess indentation from a string or tagged template literal.
     * Multi-line strings are supported.
     *
     * @example
     * ```ts
     * const code = dedent`
     *   console.log('Hello, world!')
     * `
     * // => "console.log('Hello, world!');"
     * ```
     */
    dedent,
    scan,
    list,
    read,
    tryRead,
    write,
    abort,
    reset,
  }
}

function isExistingFile(path: string): boolean {
  try {
    return fs.statSync(path).isFile()
  } catch {
    return false
  }
}
