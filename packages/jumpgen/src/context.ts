import chokidar, { EmitArgs } from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import { isArray, isObject, isString } from 'radashi'
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
import { MatcherArray } from './util/matcher-array'

/**
 * A map of file paths to their corresponding change events.
 */
export type FileChangeLog = Map<string, FileChange>
export type FileChange = {
  event: 'add' | 'change' | 'unlink'
  /** File path, relative to root directory. */
  file: string
}

export type JumpgenContext = ReturnType<typeof createJumpgenContext>

export function createJumpgenContext<
  TStore extends Record<string, any> = Record<string, never>
>(generatorName: string, rawOptions: JumpgenOptions = {}) {
  const options = resolveOptions(rawOptions)
  const { root, events } = options

  let store = {} as TStore

  const matcher = new MatcherArray()
  const watcher = options.watch
    ? chokidar.watch([], {
        ignored(file) {
          return !matcher.match(file)
        },
        ignoreInitial: true,
        ignorePermissionErrors: true,
      })
    : undefined

  // Certain methods require only watching a path for its existence or for specific events.
  let existenceWatcher: ExistenceWatcher | undefined

  // Update the watcher when matchers are added or removed.
  matcher.watcher = watcher

  let ctrl: AbortController

  reset()

  /**
   * @internal You should not call this method directly.
   */
  function reset(changes?: FileChangeLog) {
    ctrl = new AbortController()

    let isHardReset = true
    if (changes) {
      if (some(changes.keys(), file => matcher.isFileCritical(file))) {
        store = {} as TStore
        matcher.clear()
        existenceWatcher?.close()
        existenceWatcher = undefined
      } else {
        isHardReset = false
        for (let { file, event } of changes.values()) {
          if (event !== 'add') {
            file = path.resolve(root, file)
            matcher.forgetFile(file)
            existenceWatcher?.forget(file)
          }
        }
      }
    }

    if (isHardReset && isArray(options.watch)) {
      options.watch.forEach(p => {
        p = path.resolve(root, p)
        if (isExistingFile(p)) {
          matcher.addFile(p)
        } else {
          matcher.add(p)
        }
      })
    }
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

    matcher.addFile(file, isObject(options) ? options : undefined)
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

    matcher.addFile(file)
    return fs.statSync(file, { throwIfNoEntry: false })
  }

  function exists(file: string): boolean {
    file = path.resolve(root, file)
    if (options.watch) {
      existenceWatcher ??= createExistenceWatcher(matcher.files)
      existenceWatcher.watch(file)
    }
    return fs.existsSync(file)
  }

  function fileExists(file: string): boolean {
    file = path.resolve(root, file)
    if (options.watch) {
      existenceWatcher ??= createExistenceWatcher(matcher.files)
      existenceWatcher.watchFile(file)
    }
    const stats = fs.statSync(file, { throwIfNoEntry: false })
    return stats !== undefined && stats.isFile()
  }

  function directoryExists(file: string): boolean {
    file = path.resolve(root, file)
    if (options.watch) {
      existenceWatcher ??= createExistenceWatcher(matcher.files)
      existenceWatcher.watchDirectory(file)
    }
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
  function watch(files: string | string[], options?: WatchOptions) {
    files = isArray(files) ? files : [files]
    files.forEach(file => {
      matcher.addFile(path.resolve(root, file), options)
    })
  }

  function abort() {
    ctrl.abort()
  }

  async function destroy() {
    ctrl.abort()
    if (watcher) {
      await Promise.all([watcher.close(), existenceWatcher?.close()])
    }
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
    get blamedFiles() {
      return matcher.blamedFiles
    },
    /**
     * Files that have been accessed with `read` or watched with `watch`.
     */
    get watchedFiles() {
      return matcher.files
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
    scan,
    list,
    read,
    tryRead,
    stat,
    exists,
    fileExists,
    directoryExists,
    write,
    watch,
    abort,
    destroy,
    reset,
  }

  return context
}

function isExistingFile(path: string): boolean {
  try {
    return fs.statSync(path).isFile()
  } catch {
    return false
  }
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

type ExistenceWatcher = ReturnType<typeof createExistenceWatcher>

// This watcher only cares about add/unlink events. It's only used when
// the `exists` method is called, so we initialize it lazily.
function createExistenceWatcher(watchedFiles: ReadonlySet<string>) {
  const watcher = chokidar.watch([], {
    depth: 0,
    ignoreInitial: true,
    ignorePermissionErrors: true,
  })

  let existencePaths: Set<string> | undefined
  let fileExistencePaths: Set<string> | undefined
  let dirExistencePaths: Set<string> | undefined

  const isRelevantEvent = (args: EmitArgs): boolean => {
    const [event] = args

    if (event === 'error') {
      return true
    }

    if (event === 'change') {
      return false
    }

    const [, file] = args as [string, string]

    // If a file is both checked for existence and accessed, bail out to
    // avoid sending duplicate events.
    if (watchedFiles.has(file)) {
      return false
    }

    if (existencePaths?.has(file)) {
      return true
    }

    if (event === 'add' || event === 'unlink') {
      if (fileExistencePaths?.has(file)) {
        return true
      }
      return !dirExistencePaths?.has(file)
    }

    if (dirExistencePaths?.has(file)) {
      return true
    }
    return !fileExistencePaths?.has(file)
  }

  // Forward existence events to the main watcher.
  watcher.on('all', (...args) => {
    if (isRelevantEvent(args as EmitArgs)) {
      watcher!.emitWithAll(args[0], args as EmitArgs)
    }
  })

  const watch = (file: string, existencePaths: Set<string>) => {
    existencePaths.add(file)
    watcher.add(file)
  }

  return {
    watch(file: string) {
      watch(file, (existencePaths ??= new Set()))
    },
    watchFile(file: string) {
      watch(file, (fileExistencePaths ??= new Set()))
    },
    watchDirectory(dir: string) {
      watch(dir, (dirExistencePaths ??= new Set()))
    },
    forget(file: string) {
      watcher.unwatch(file)
      existencePaths?.delete(file)
      fileExistencePaths?.delete(file)
      dirExistencePaths?.delete(file)
    },
    close() {
      return watcher.close()
    },
  }
}
