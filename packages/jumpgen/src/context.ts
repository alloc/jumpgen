import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { castArray, isArray, isFunction, isObject, isString } from 'radashi'
import { globSync } from 'tinyglobby'
import { File } from './file'
import {
  FindUpOptions,
  GlobOptions,
  JumpgenOptions,
  ListOptions,
  ReadOptions,
  resolveOptions,
  ScanOptions,
  WatchOptions,
} from './options'
import { kJumpgenContext } from './symbols'
import { dedent } from './util/dedent'
import { createJumpgenWatcher } from './watcher'

/**
 * A map of file paths to their corresponding change events.
 */
export type FileChangeLog = Map<string, FileChange>
export type FileChange = {
  event: 'add' | 'change' | 'unlink'
  /**
   * Equals `S_IFDIR` or `S_IFREG` exported by `node:constants`.
   */
  type: number
  /** File path, relative to root directory. */
  file: string
}

export enum JumpgenStatus {
  Pending = 'pending',
  Running = 'running',
  Finished = 'finished',
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
    ? createJumpgenWatcher(generatorName, events, root)
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
          watcher = createJumpgenWatcher(generatorName, events, root)
        } else {
          isHardReset = false
          for (const { file, event } of changes.values()) {
            if (event !== 'add') {
              watcher.unwatch(path.resolve(root, file))
            }
          }
        }
      }

      if (isHardReset && isArray(options.watch)) {
        for (const input of options.watch) {
          if (input[0] === '!') {
            throw new Error(
              'The `watch` option does not support negative globs.'
            )
          }
          const resolvedInput = path.resolve(root, input)
          const stat = statSync(resolvedInput, { throwIfNoEntry: false })
          if (stat?.isFile()) {
            watcher.addFile(resolvedInput)
          } else if (stat?.isDirectory()) {
            watcher.add(path.join(input, '**/*'))
          } else {
            watcher.add(input)
          }
        }
      }
    }
  }

  class fs {
    /**
     * Scan the filesystem for files matching the given glob pattern. File
     * paths are allowed to be relative. In watch mode, the matching files
     * will be watched for changes, unless this function was called with the
     * `watch` option set to `false`.
     */
    static scan(
      source: string | readonly string[],
      options?: ScanOptions
    ): string[] {
      if (options?.watch !== false) {
        watcher?.add(source, options)
      }
      return globSync(source as string | string[], {
        ...options,
        cwd: options?.cwd ? path.resolve(root, options.cwd) : root,
      })
    }

    /**
     * Find a file by searching up the directory tree. You may provide a glob
     * pattern to match against the file names.
     *
     * By default, the returned path is relative to the generator's root
     * directory. Use the `absolute` option to return an absolute path.
     *
     * By default, the search stops at the root directory, but the `stop`
     * option lets you control this behavior with a glob or function (i.e.
     * stop when a `.git` directory is found).
     *
     * Globstars (`**`) and separators (`/`) are not allowed in the source
     * glob(s).
     */
    static findUp(
      source: string | string[],
      options?: FindUpOptions
    ): string | null {
      const watchOptions = {
        glob: source,
        globOptions: options,
      }

      let dir = options?.cwd ? path.resolve(root, options.cwd) : root
      let children: string[]
      let stop: (dir: string) => boolean

      if (options?.stop) {
        if (isFunction(options.stop)) {
          stop = options.stop
        } else if (isString(options.stop) && path.isAbsolute(options.stop)) {
          // Stop at a specific parent directory.
          stop = dir => dir === options.stop
        } else {
          // Stop when a matching path is found.
          const match = picomatch(options.stop, { noglobstar: true })
          stop = () => children.some(match)

          // Ensure the stop globs are also watched.
          watchOptions.glob = [source, options.stop].flat()
        }
      } else {
        // Stop at the root directory. (default behavior)
        stop =
          dir === root
            ? () => true
            : dir.startsWith(root + path.sep)
            ? dir => dir === root
            : () => false
      }

      const match = picomatch(source, {
        ...options,
        noglobstar: true,
      })

      const finalDirectory = path.parse(dir).root

      let dirExists = false

      while (true) {
        // Keep checking existence until we find a directory that exists.
        if (!dirExists) {
          if (statSync(dir, { throwIfNoEntry: false })) {
            dirExists = true
          } else {
            watcher?.exists.watchDirectory(dir)
          }
        }

        // Avoid trying to read a directory that doesn't exist.
        if (dirExists) {
          this.watchReaddir(dir, watchOptions)
          children = readdirSync(dir)

          for (const name of children) {
            if (match(name)) {
              return options?.absolute
                ? path.join(dir, name)
                : path.relative(root, path.join(dir, name))
            }
          }
        }

        if (stop(dir) || dir === finalDirectory) {
          return null
        }
        dir = path.dirname(dir)
      }
    }

    /**
     * List the children of a directory. The directory is allowed to be a
     * relative path. In watch mode, the directory will be watched for
     * changes.
     *
     * You may want to filter the list of files using the `glob` option, if
     * you're only interested in a subset of the directory's contents.
     */
    static list(dir: string, options?: ListOptions): string[] {
      dir = path.resolve(root, dir)

      if (options?.watch !== false) {
        this.watchReaddir(dir, options)
      }

      let children = readdirSync(dir)
      if (options?.glob) {
        children = children.filter(
          picomatch(options.glob, {
            dot: true,
            ...options.globOptions,
            noglobstar: true,
          })
        )
      }

      if (options?.absolute) {
        return children.map(child => path.join(dir, child))
      }
      return children
    }

    static watchReaddir(
      dir: string,
      options?: {
        glob?: string | string[]
        globOptions?: Omit<GlobOptions, 'cwd' | 'noglobstar'>
      }
    ): void {
      let glob = castArray(options?.glob ?? '*')
      let cwd: string | undefined
      if (path.isAbsolute(dir)) {
        cwd = dir
      } else {
        glob = glob.map(pattern => joinWithGlob(dir, pattern))
      }
      watcher?.add(glob, {
        dot: true,
        ...options?.globOptions,
        cwd,
        noglobstar: true,
      })
    }

    /**
     * Read a file from the filesystem. File paths are allowed to be
     * relative. In watch mode, the file will be watched for changes.
     */
    static read(
      path: string,
      options?: (ReadOptions & { encoding?: null | undefined }) | null
    ): Buffer

    static read(
      path: string,
      options: (ReadOptions & { encoding: BufferEncoding }) | BufferEncoding
    ): string

    static read(
      path: string,
      options?: ReadOptions | BufferEncoding | null
    ): string | Buffer

    static read(
      file: string,
      options?: ReadOptions | BufferEncoding | null
    ): any {
      file = path.resolve(root, file)
      watcher?.addFile(file, isObject(options) ? options : undefined)

      return readFileSync(file, options)
    }

    /**
     * Similar to `read` except that it returns `null` if the file does not
     * exist, instead of throwing an error.
     */
    static tryRead(
      path: string,
      options?: (ReadOptions & { encoding?: null | undefined }) | null
    ): Buffer | null

    static tryRead(
      path: string,
      options: (ReadOptions & { encoding: BufferEncoding }) | BufferEncoding
    ): string | null

    static tryRead(
      path: string,
      options?: ReadOptions | BufferEncoding | null
    ): string | Buffer | null

    static tryRead(
      file: string,
      options?: ReadOptions | BufferEncoding | null
    ): any {
      try {
        return this.read(file, options)
      } catch {
        return null
      }
    }

    static stat(file: string): Stats | undefined {
      file = path.resolve(root, file)
      watcher?.addFile(file)

      return statSync(file, { throwIfNoEntry: false })
    }

    static lstat(file: string): Stats | undefined {
      file = path.resolve(root, file)
      watcher?.addFile(file)

      return lstatSync(file, { throwIfNoEntry: false })
    }

    static exists(file: string): boolean {
      file = path.resolve(root, file)
      watcher?.exists.watch(file)

      return existsSync(file)
    }

    static fileExists(file: string): boolean {
      file = path.resolve(root, file)
      watcher?.exists.watchFile(file)

      const stats = statSync(file, { throwIfNoEntry: false })
      return stats !== undefined && stats.isFile()
    }

    static symlinkExists(file: string): boolean {
      file = path.resolve(root, file)
      watcher?.exists.watch(file)

      const stats = statSync(file, { throwIfNoEntry: false })
      return stats !== undefined && stats.isSymbolicLink()
    }

    static directoryExists(file: string): boolean {
      file = path.resolve(root, file)
      watcher?.exists.watchDirectory(file)

      const stats = statSync(file, { throwIfNoEntry: false })
      return stats !== undefined && stats.isDirectory()
    }

    /**
     * Write a file to the filesystem. If a parent directory does not exist,
     * it will be created. File paths are allowed to be relative. Emits a
     * `write` event after the file is written.
     */
    static write(file: string, data: string | Buffer): void {
      file = path.resolve(root, file)

      try {
        if (isString(data)) {
          if (readFileSync(file, 'utf8') === data) {
            return
          }
        } else {
          if (readFileSync(file).equals(data)) {
            return
          }
        }
      } catch {}

      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, data)
      events.emit('write', file, generatorName)
    }

    /**
     * Add files to trigger a generator rerun when they are changed. This is
     * only useful for files that weren't read using Jumpgen context methods
     * (for example, if you're using a library that reads from the filesystem
     * on its own).
     */
    static watch(files: string | readonly string[], options?: WatchOptions) {
      if (watcher) {
        for (const file of castArray(files)) {
          watcher.addFile(path.resolve(root, file), options)
        }
      }
    }
  }

  /**
   * Emit a custom event.
   */
  function emit(event: TEvent) {
    events.emit('custom', event, generatorName)
  }

  function abort(reason?: any) {
    if (context.status === JumpgenStatus.Running) {
      ctrl.abort(reason)
      events.emit('abort', reason, generatorName)
    }
  }

  async function destroy() {
    ctrl.abort('destroy')
    await watcher?.close()
    events.emit('destroy', generatorName)
  }

  const context = {
    [kJumpgenContext]: true,
    /**
     * The current status of the generator.
     */
    status: JumpgenStatus.Pending,
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
     * Exists when the generator is running in watch mode.
     */
    watcher: watcher && {
      /**
       * Await this promise before making any file system calls that depend
       * on the watcher being ready.
       */
      get ready() {
        return watcher!.ready
      },
      /**
       * Files that have been accessed with `read` or watched with `watch`.
       */
      get watchedFiles() {
        return watcher!.files
      },
      /**
       * Any files passed to `watch`, mapped to the files blamed for their
       * changes (i.e. the files that caused them to be watched in the
       * first place).
       *
       * If you didn't set the `cause` option when calling `watch`, the
       * watched files won't be in here.
       */
      get blamedFiles() {
        return watcher!.blamedFiles
      },
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
    fs,
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

function joinWithGlob(dir: string, glob: string) {
  let prefix = ''
  if (glob[0] === '!') {
    prefix = '!'
    glob = glob.slice(1)
  }
  return prefix + path.join(dir, glob)
}
