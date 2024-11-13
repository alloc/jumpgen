import chokidar, { FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { castArray } from 'radashi'
import { ChokidarEvent, JumpgenEventEmitter } from './events'
import { GlobOptions } from './options'
import { stripTrailingSlash } from './util/path'

type Matcher = {
  base: string
  glob: string
  depth: number
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
      for (const matcher of matchers) {
        if (matcher.match(file)) {
          return false
        }
        if (file === matcher.base) {
          return false
        }
      }
      return true
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

  const handleChange = (event: ChokidarEvent, file: string) => {
    if (event === 'add' || event === 'addDir') {
      checkAddedPath(file)
    }
    events.emit('watch', event, file, generatorName)
  }

  const handleError = (error: Error) => {
    events.emit('error', error, generatorName)
  }

  recursiveWatcher.on('all', handleChange)
  recursiveWatcher.on('error', handleError)

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
        childrenWatcher.on('all', (event, file) => {
          if (event !== 'change') {
            handleChange(event, file)
          }
        })
        childrenWatcher.on('error', handleError)
      }

      childrenWatcher.add(file)
    } else {
      recursiveWatcher.add(file)
    }
  }

  function add(
    patterns: string | readonly string[],
    options?: GlobOptions
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
      let { base, glob, isGlobstar } = picomatch.scan(pattern)
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
    watchedFiles.add(file)

    if (options?.critical) {
      criticalFiles.add(file)
    }

    if (options?.cause) {
      let blamed = blamedFiles.get(file)
      if (!blamed) {
        blamed = new Set()
        blamedFiles.set(file, blamed)
      }
      for (const cause of castArray(options.cause)) {
        blamed.add(cause)
      }
    }

    // Once our internal state is ready, ask chokidar to watch the file,
    // which leads to a call to `match()`.
    watch(file)
  }

  function unwatch(file: string): void {
    recursiveWatcher.unwatch(file)
    existenceWatcher?.unwatch(file)

    watchedFiles.delete(file)
    blamedFiles.delete(file)
    criticalFiles.delete(file)

    // If the file is to blame for other files being watched, those files
    // may need to be rewatched if all their blamed files are forgotten.
    for (const [relatedFile, blamed] of blamedFiles) {
      if (blamed.delete(file) && blamed.size === 0) {
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
        handleError
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
  handleError: (error: Error) => void
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
