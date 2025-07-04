import chokidar, { FSWatcher } from 'chokidar'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { castArray } from 'radashi'
import { debug } from './debug'
import { ChokidarEvent, JumpgenEventEmitter } from './events'
import { GlobOptions } from './options'
import { stripTrailingSlash } from './util/path'

type Matcher = {
  base: string
  glob: string
  depth: number
  ignoreEmptyNewFiles: boolean
  ignoreChangeEvents: boolean
  match: (s: string) => boolean
}

export type JumpgenWatcher = ReturnType<typeof createJumpgenWatcher>

export function createJumpgenWatcher(
  generatorName: string,
  events: JumpgenEventEmitter,
  root: string
) {
  const watchedFiles = new Set<string>()
  const blamedFiles = new Map<string, Set<string>>()
  const criticalFiles = new Set<string>()
  const missingPaths = new Set<string>()
  const fallbackPaths = new Map<string, number>()

  const matchers: Matcher[] = []
  const hasMatch = (file: string, matcher: Matcher) =>
    matcher.match(file) || file === matcher.base

  // For existence checks, we need a separate watcher.
  let existenceWatcher: ExistenceWatcher | undefined

  // For watching only the immediate children of a directory, we need a
  // separate watcher.
  let childrenWatcher: FSWatcher | undefined

  // Recursive file watching.
  const recursiveWatcher = chokidar.watch([], {
    ignored(file) {
      if (watchedFiles.has(file)) {
        return false
      }
      if (fallbackPaths.has(file)) {
        return false
      }
      return !matchers.some(matcher => hasMatch(file, matcher))
    },
    ignoreInitial: true,
    ignorePermissionErrors: true,
  })

  /**
   * Call this whenever the watcher reports an added file. This method will
   * update any internal state that exists to support handling of missing
   * paths.
   */
  const checkAddedPath = (file: string): void => {
    if (missingPaths.delete(file)) {
      const parent = path.dirname(file)
      const childCount = fallbackPaths.get(parent) ?? 0
      if (childCount > 0) {
        if (childCount === 1) {
          fallbackPaths.delete(parent)
        } else {
          fallbackPaths.set(parent, childCount - 1)
        }
      }
    }
  }

  const shouldIgnoreAdd = (file: string) => {
    if (watchedFiles.has(file)) {
      return false
    }
    let skip = false
    for (const matcher of matchers) {
      if (!matcher.ignoreEmptyNewFiles) {
        // Keep the event if an applicable matcher cares about "add" events
        // for empty files, even if other matchers don't care.
        if (hasMatch(file, matcher)) {
          return false
        }
        continue
      }
      // If already skipping, avoid the overhead of path matching and
      // checking the file size.
      if (!skip && hasMatch(file, matcher) && statSync(file).size === 0) {
        skip = true
      }
    }
    return skip
  }

  const shouldIgnoreChange = (file: string) => {
    if (watchedFiles.has(file)) {
      return false
    }
    // Every matcher must be uninterested in the change. If the matchers
    // array is empty, this returns true.
    return matchers.every(
      matcher => matcher.ignoreChangeEvents || !hasMatch(file, matcher)
    )
  }

  const handleChange = (event: ChokidarEvent, file: string) => {
    if (event === 'add' || event === 'addDir') {
      checkAddedPath(file)
    }
    if (event === 'add' && shouldIgnoreAdd(file)) {
      debug('ignoring "add" event for %s', file)
      return
    }
    if (event === 'change' && shouldIgnoreChange(file)) {
      debug('ignoring "change" event for %s', file)
      return
    }
    debug('watched "%s" event for %s', event, file)
    events.emit('watch', event, file, generatorName)
  }

  const handleError = (error: Error) => {
    events.emit('error', error, generatorName)
  }

  recursiveWatcher.on('all', handleChange)
  recursiveWatcher.on('error', handleError)

  const readyPromises = createPromiseMap()
  patchReadyEvent(recursiveWatcher, readyPromises)

  /**
   * Due to unfortunate Chokidar behavior, we need to ensure parent
   * directories of missing files are matchable. If that ever gets fixed,
   * we can remove this method and the `checkAddedPath` method, then revert
   * back to simply calling `watcher?.add(file)`.
   *
   * @see https://github.com/paulmillr/chokidar/issues/1374
   */
  const watch = (
    file: string,
    childrenOnly?: boolean,
    originalFile?: string
  ): void => {
    if (!existsSync(file)) {
      missingPaths.add(file)

      const fallbackPath = path.dirname(file)
      if (fallbackPath !== file) {
        const childCount = fallbackPaths.get(fallbackPath) ?? 0
        fallbackPaths.set(fallbackPath, childCount + 1)
        watch(fallbackPath, childrenOnly, originalFile ?? file)
      }
    }

    if (originalFile) {
      return // Chokidar watches fallback paths automatically.
    }

    if (childrenOnly) {
      if (!childrenWatcher) {
        childrenWatcher = chokidar.watch([], {
          depth: 1,
          ignoreInitial: true,
          ignorePermissionErrors: true,
        })
        childrenWatcher.on('all', handleChange)
        childrenWatcher.on('error', handleError)
        patchReadyEvent(childrenWatcher, readyPromises)
      }

      debug('watching children of %s', file)
      childrenWatcher.add(file)
    } else {
      debug('watching %s', file)
      recursiveWatcher.add(file)
    }
  }

  function add(
    patterns: string | readonly string[],
    options?: GlobOptions & {
      /**
       * Ignore "add" events for empty files.
       */
      ignoreEmptyNewFiles?: boolean
      /**
       * Subscribe to "change" events. Normally, userland needs to call
       * `fs.watch()` on each individual file in order to receive change
       * events (not to be confused with "add" or "unlink" events).
       */
      enableChangeEvents?: boolean
    }
  ): void {
    const positivePatterns: string[] = []
    const negativePatterns: string[] = []

    for (const p of castArray(patterns)) {
      if (p[0] === '!') {
        negativePatterns.push(p.slice(1))
      } else {
        positivePatterns.push(p)
      }
    }

    if (negativePatterns.length > 0) {
      options = {
        ...options,
        ignore: options?.ignore
          ? [...options.ignore, ...negativePatterns]
          : negativePatterns,
      }
    }

    const cwd =
      (options?.cwd
        ? stripTrailingSlash(path.resolve(root, options.cwd))
        : root) + path.sep

    for (const pattern of positivePatterns) {
      let { base, glob, isGlobstar } = picomatch.scan(pattern, {
        // Required for isGlobstar to work.
        scanToEnd: true,
      })
      debug(
        'watching glob "%s" in %s',
        glob,
        base,
        JSON.stringify(options) || ''
      )

      // Base directory must be absolute.
      base = path.resolve(cwd, base)

      // Sort matchers by depth, so that deeper matchers are matched first.
      const depth = base.split(path.sep).length

      let index = matchers.findIndex(m => depth > m.depth)
      if (index === -1) {
        index = matchers.length
      }

      const match = picomatch(pattern, options)

      matchers.splice(index, 0, {
        base,
        glob,
        depth,
        ignoreEmptyNewFiles: options?.ignoreEmptyNewFiles === true,
        ignoreChangeEvents: options?.enableChangeEvents !== true,
        match: path.isAbsolute(pattern)
          ? match
          : file => file.startsWith(cwd) && match(file.slice(cwd.length)),
      })

      // Once our internal state is ready, ask chokidar to watch the
      // directory, which leads to a call to `match()`.
      watch(base, !isGlobstar)
    }
  }

  function addFile(
    file: string,
    options?: { cause?: string | string[]; critical?: boolean }
  ): void {
    let causes = blamedFiles.get(file)
    if (options?.cause) {
      if (!causes) {
        causes = new Set()
        blamedFiles.set(file, causes)

        // If the file was already watched without a cause, we treat it as
        // a cause for itself.
        if (watchedFiles.has(file)) {
          causes.add(file)
        }
      }
      for (const cause of castArray(options.cause)) {
        causes.add(cause)
      }
    }
    // If a file was already watched with a cause, we need to treat the
    // file as a cause for itself.
    else if (causes) {
      causes.add(file)
    }

    if (options?.critical) {
      criticalFiles.add(file)
    }

    watchedFiles.add(file)

    // Once our internal state is ready, ask chokidar to watch the file,
    // which leads to a call to `match()`.
    watch(file)
  }

  /**
   * Stop tracking events for the given file path.
   *
   * **Note:** If a watched glob matches the given path, it won't be
   * completely unwatched. In other words, the glob will continue to track
   * events for the given path.
   */
  function unwatch(file: string): void {
    existenceWatcher?.unwatch(file)

    // Keep watching the file if it's still relevant to a watched glob.
    if (
      matchers.every(
        matcher => matcher.ignoreChangeEvents || !hasMatch(file, matcher)
      )
    ) {
      recursiveWatcher.unwatch(file)
    }

    watchedFiles.delete(file)
    blamedFiles.delete(file)
    criticalFiles.delete(file)

    // If the file is to blame for other files being watched, those files
    // may need to be rewatched if all their blamed files are forgotten.
    for (const [relatedFile, causes] of blamedFiles) {
      if (causes.delete(file) && causes.size === 0) {
        unwatch(relatedFile)
      }
    }
  }

  async function close() {
    recursiveWatcher.removeAllListeners()
    childrenWatcher?.removeAllListeners()
    await Promise.all([
      recursiveWatcher.close(),
      childrenWatcher?.close(),
      existenceWatcher?.close(),
    ])
  }

  return {
    get ready() {
      return Promise.resolve(readyPromises)
    },

    /**
     * All files watched through `this.addFile` calls.
     */
    get files(): ReadonlySet<string> {
      return watchedFiles
    },

    get blamedFiles(): ReadonlyMap<string, ReadonlySet<string>> {
      return blamedFiles
    },

    /**
     * Note: Do not call the `unwatch` or `close` methods of this watcher
     * directly, or you risk instantiating it when it's not needed.
     */
    get exists() {
      return (existenceWatcher ??= createExistenceWatcher(
        watchedFiles,
        handleChange,
        handleError,
        readyPromises
      ))
    },

    isFileCritical(file: string): boolean {
      return criticalFiles.has(file)
    },

    add,
    addFile,
    unwatch,
    close,
  }
}

type ExistenceWatcher = ReturnType<typeof createExistenceWatcher>

// This watcher only cares about add/unlink events. It's only used when
// the `exists` method is called, so we initialize it lazily.
function createExistenceWatcher(
  watchedFiles: ReadonlySet<string>,
  handleChange: (event: ChokidarEvent, file: string) => void,
  handleError: (error: Error) => void,
  readyPromises: PromiseMap
) {
  const watcher = chokidar.watch([], {
    depth: 0,
    ignoreInitial: true,
    ignorePermissionErrors: true,
  })

  let existencePaths: Set<string> | undefined
  let fileExistencePaths: Set<string> | undefined
  let dirExistencePaths: Set<string> | undefined

  /**
   * Existence checks are only concerned with specific events. They're
   * never concerned with "change" events (modification to a file's
   * contents). They're only sometimes concerned with the other event
   * types, depending on whether the path was checked for a particular file
   * type or not.
   */
  const isRelevantChange = (event: ChokidarEvent, file: string): boolean => {
    if (event === 'change') {
      return false
    }

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

  watcher.on('all', (event, file) => {
    if (isRelevantChange(event, file)) {
      handleChange(event, file)
    }
  })
  watcher.on('error', handleError)
  patchReadyEvent(watcher, readyPromises)

  const watch = (file: string, existencePaths: Set<string>) => {
    debug('watching existence of %s', file)
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
    unwatch(file: string) {
      watcher.unwatch(file)
      existencePaths?.delete(file)
      fileExistencePaths?.delete(file)
      dirExistencePaths?.delete(file)
    },
    async close() {
      watcher.removeAllListeners()
      await watcher.close()
    },
  }
}

function patchReadyEvent(watcher: FSWatcher, readyPromises: PromiseMap) {
  // Stop monkey-patching emitReady once chokidar makes the `add` method
  // async: https://github.com/paulmillr/chokidar/issues/1378
  const emitReady = watcher._emitReady
  const patchedEmitReady = (watcher._emitReady = () => {
    emitReady()
    if (watcher._readyEmitted) {
      watcher._readyEmitted = false
      watcher._emitReady = patchedEmitReady
    }
  })
  // Monkey-patch the `FSWatcher#add` method to set up a "ready" listener.
  // This allows us to wait for the watcher to initialize before we resolve
  // the current generator run, where the test suite may immediately
  // perform filesystem calls.
  const add = watcher.add.bind(watcher)
  watcher.add = (...args) => {
    add(...args)
    if (!readyPromises.has(watcher)) {
      readyPromises.set(
        watcher,
        new Promise<void>(resolve => {
          watcher.once('ready', resolve)
        })
      )
    }
    return watcher
  }
}

interface PromiseMap extends PromiseLike<void> {
  has(key: unknown): boolean
  set(key: unknown, promise: Promise<void>): void
}

function createPromiseMap(): PromiseMap {
  const promises = new Map<unknown, Promise<void>>()
  return {
    has(key: unknown) {
      return promises.has(key)
    },
    set(key: unknown, promise: Promise<void>) {
      promises.set(key, promise)
      const unset = () => promises.delete(key)
      promise.then(unset, unset)
    },
    then<TResult1 = void, TResult2 = never>(
      onResolve?: (() => TResult1 | PromiseLike<TResult1>) | undefined | null,
      onReject?:
        | ((reason: any) => TResult2 | PromiseLike<TResult2>)
        | undefined
        | null
    ) {
      return Promise.all(Array.from(promises.values())).then(
        onResolve,
        onReject
      )
    },
  }
}
