import fs from 'node:fs'
import path from 'node:path'
import { castArray, isArray, isObject, isString } from 'radashi'
import { globSync } from 'tinyglobby'
import { File } from './file'
import {
  GlobOptions,
  JumpgenOptions,
  ListOptions,
  ReadOptions,
  resolveOptions,
  WatchOptions,
} from './options'
import { kJumpgenContext } from './symbols'
import { dedent } from './util/dedent'
import { stripTrailingSlash } from './util/path'
import { createJumpgenWatcher } from './util/watcher'

/**
 * A map of file paths to their corresponding change events.
 */
export type FileChangeLog = Map<string, FileChange>
export type FileChange = {
  event: 'add' | 'change' | 'unlink'
  /** File path, relative to root directory. */
  file: string
}

export type JumpgenContext<
  TStore extends Record<string, any> = Record<string, never>,
  TEvent extends { type: string } = never
> = ReturnType<typeof createJumpgenContext<TStore, TEvent>>

export type JumpgenFS = JumpgenContext['fs']

export function createJumpgenContext<
  TStore extends Record<string, any> = Record<string, never>,
  TEvent extends { type: string } = never
>(generatorName: string, rawOptions: JumpgenOptions<TEvent> = {}) {
  const options = resolveOptions(rawOptions)
  const { root, events } = options

  let store = {} as TStore

  let watcher = options.watch
    ? createJumpgenWatcher(generatorName, events)
    : undefined

  let ctrl: AbortController

  reset()

  /**
   * @internal You should not call this method directly.
   */
  function reset(changes?: FileChangeLog) {
    ctrl = new AbortController()

    if (watcher) {
      let isHardReset = true
      if (changes) {
        if (some(changes.keys(), watcher.isFileCritical)) {
          store = {} as TStore
          watcher.close()
          watcher = createJumpgenWatcher(generatorName, events)
        } else {
          isHardReset = false
          for (let { file, event } of changes.values()) {
            if (event !== 'add') {
              file = path.resolve(root, file)
              watcher.unwatch(file)
            }
          }
        }
      }

      if (isHardReset && isArray(options.watch)) {
        for (const input of options.watch) {
          const resolvedInput = path.resolve(root, input)
          const stat = fs.statSync(resolvedInput, { throwIfNoEntry: false })
          if (stat?.isFile()) {
            watcher.addFile(resolvedInput)
          } else if (stat?.isDirectory()) {
            watcher.add(path.join(input, '**/*'), { cwd: root })
          } else {
            watcher.add(input, { cwd: root })
          }
        }
      }
    }
  }

  /**
   * Scan the filesystem for files matching the given glob pattern. File
   * paths are allowed to be relative. In watch mode, the matching files
   * will be watched for changes, unless this function was called with the
   * `watch` option set to `false`.
   */
  function scan(
    source: string | readonly string[],
    options?: GlobOptions
  ): string[] {
    const cwd = options?.cwd
      ? stripTrailingSlash(path.resolve(root, options.cwd))
      : root

    const globOptions = { ...options, cwd }

    if (globOptions.watch !== false) {
      watcher?.add(source, globOptions)
    }

    return globSync(source as string | string[], globOptions)
  }

  /**
   * List the children of a directory. The directory is allowed to be a
   * relative path. In watch mode, the directory will be watched for
   * changes.
   */
  function list(dir: string, options?: ListOptions): string[] {
    if (options?.watch !== false) {
      watcher?.add(path.join(dir, '*'), { cwd: root, dot: true })
    }
    dir = path.resolve(root, dir)
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
    options?: (ReadOptions & { encoding?: null | undefined }) | null
  ): Buffer

  function read(
    path: string,
    options: (ReadOptions & { encoding: BufferEncoding }) | BufferEncoding
  ): string

  function read(
    path: string,
    options?: ReadOptions | BufferEncoding | null
  ): string | Buffer

  function read(
    file: string,
    options?: ReadOptions | BufferEncoding | null
  ): any {
    file = path.resolve(root, file)
    watcher?.addFile(file, isObject(options) ? options : undefined)

    return fs.readFileSync(file, options)
  }

  /**
   * Similar to `read` except that it returns `null` if the file does not
   * exist, instead of throwing an error.
   */
  function tryRead(
    path: string,
    options?: (ReadOptions & { encoding?: null | undefined }) | null
  ): Buffer | null

  function tryRead(
    path: string,
    options: (ReadOptions & { encoding: BufferEncoding }) | BufferEncoding
  ): string | null

  function tryRead(
    path: string,
    options?: ReadOptions | BufferEncoding | null
  ): string | Buffer | null

  function tryRead(
    file: string,
    options?: ReadOptions | BufferEncoding | null
  ): any {
    try {
      return read(file, options)
    } catch {
      return null
    }
  }

  function stat(file: string): fs.Stats | undefined {
    file = path.resolve(root, file)
    watcher?.addFile(file)

    return fs.statSync(file, { throwIfNoEntry: false })
  }

  function lstat(file: string): fs.Stats | undefined {
    file = path.resolve(root, file)
    watcher?.addFile(file)

    return fs.lstatSync(file, { throwIfNoEntry: false })
  }

  function exists(file: string): boolean {
    file = path.resolve(root, file)
    watcher?.exists.watch(file)

    return fs.existsSync(file)
  }

  function fileExists(file: string): boolean {
    file = path.resolve(root, file)
    watcher?.exists.watchFile(file)

    const stats = fs.statSync(file, { throwIfNoEntry: false })
    return stats !== undefined && stats.isFile()
  }

  function symlinkExists(file: string): boolean {
    file = path.resolve(root, file)
    watcher?.exists.watch(file)

    const stats = fs.statSync(file, { throwIfNoEntry: false })
    return stats !== undefined && stats.isSymbolicLink()
  }

  function directoryExists(file: string): boolean {
    file = path.resolve(root, file)
    watcher?.exists.watchDirectory(file)

    const stats = fs.statSync(file, { throwIfNoEntry: false })
    return stats !== undefined && stats.isDirectory()
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

  /**
   * Add files to trigger a generator rerun when they are changed. This is
   * only useful for files that weren't read using Jumpgen context methods
   * (for example, if you're using a library that reads from the filesystem
   * on its own).
   */
  function watch(files: string | readonly string[], options?: WatchOptions) {
    if (watcher) {
      files = isArray(files) ? files : [files]
      for (const file of castArray(files)) {
        watcher.addFile(path.resolve(root, file), options)
      }
    }
  }

  /**
   * Emit a custom event.
   */
  function emit(event: TEvent) {
    events.emit('custom', event, generatorName)
  }

  function abort() {
    ctrl.abort()
  }

  async function destroy() {
    ctrl.abort()
    await watcher?.close()
  }

  const context = {
    [kJumpgenContext]: true,
    /**
     * The root directory from which all file operations are relative.
     */
    get root() {
      return root
    },
    /**
     * Any data that should be preserved between generator runs.
     *
     * Note: This gets cleared if a critical file is changed.
     */
    get store() {
      return store
    },
    /**
     * Any files passed to `watch`, mapped to the files blamed for their
     * changes (i.e. the files that caused them to be watched in the first
     * place).
     *
     * If you didn't set the `cause` option when calling `watch`, the
     * watched files won't be in here.
     */
    get blamedFiles(): ReadonlyMap<string, ReadonlySet<string>> {
      return watcher?.blamedFiles ?? new Map()
    },
    /**
     * Whether the generator is running in watch mode.
     */
    get isWatchMode() {
      return !!watcher
    },
    /**
     * Files that have been accessed with `read` or watched with `watch`.
     */
    get watchedFiles() {
      return watcher?.files ?? new Set()
    },
    /**
     * Events related to the generator.
     *
     * - "start" when a generator run begins
     * - "watch" when something happens to a watched path
     * - "write" when a file is written
     * - "finish" when a generator run completes
     * - "error" when an error occurs
     * - "custom" when the generator emits a custom event
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
     * Files that were modified, added, or deleted between the current
     * generator run and the previous one. If empty, this is the
     * generator's first run. The file paths within are always relative to
     * the root directory.
     */
    changes: [] as FileChange[],
    /**
     * Wrap a file path in a `File` object to make it a first-class citizen
     * that can be passed around and read/written without direct access to
     * the Jumpgen context.
     */
    File: class extends File {
      constructor(path: string) {
        super(path, context)
      }
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
    /**
     * A collection of filesystem-related methods.
     */
    fs: {
      scan,
      list,
      read,
      tryRead,
      stat,
      lstat,
      exists,
      fileExists,
      symlinkExists,
      directoryExists,
      write,
      watch,
    },
    emit,
    abort,
    destroy,
    reset,
  }

  return context
}

function some<T>(
  iterable: Iterable<T>,
  predicate: (value: T) => boolean
): boolean {
  for (const value of iterable) {
    if (predicate(value)) {
      return true
    }
  }
  return false
}
