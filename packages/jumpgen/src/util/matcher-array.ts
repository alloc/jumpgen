import { FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import { castArray } from 'radashi'

export type Matcher = {
  base: string
  glob: string
  depth: number
  match: (s: string) => boolean
}

export class MatcherArray {
  #files = new Set<string>()
  #blamedFiles = new Map<string, Set<string>>()
  #criticalFiles = new Set<string>()
  #missingPaths = new Set<string>()
  #fallbackPaths = new Map<string, number>()
  #matchers: Matcher[] = []

  /**
   * When defined, base directories from `this.add` calls and files from
   * `this.addFile` calls are watched for changes.
   */
  watcher: FSWatcher | undefined = undefined

  /**
   * All files watched through `this.addFile` calls.
   */
  get files(): ReadonlySet<string> {
    return this.#files
  }

  get blamedFiles(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.#blamedFiles
  }

  isFileCritical(file: string): boolean {
    return this.#criticalFiles.has(file)
  }

  add(
    patterns: string | readonly string[],
    options: picomatch.PicomatchOptions & { cwd: string }
  ): void {
    const positivePatterns: string[] = []
    const negativePatterns: string[] = []

    for (const p of patterns) {
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

    for (const pattern of positivePatterns) {
      let { base, glob } = picomatch.scan(pattern)

      // Sort matchers by depth, so that deeper matchers are matched first.
      const depth = path.normalize(base).split(path.sep).length

      let index = this.#matchers.findIndex(m => depth > m.depth)
      if (index === -1) {
        index = this.#matchers.length
      }

      const rootDir = options.cwd + path.sep
      const match = picomatch(pattern, options)

      base = path.join(options.cwd, base)

      this.#matchers.splice(index, 0, {
        base,
        glob,
        depth,
        match: file =>
          file.startsWith(rootDir) && match(file.slice(rootDir.length)),
      })

      // Once our internal state is ready, ask chokidar to watch the
      // directory, which leads to a call to `this.match`.
      if (this.watcher) {
        this.#watch(base)
      }
    }
  }

  addFile(
    file: string,
    options?: { cause?: string | string[]; critical?: boolean }
  ): void {
    this.#files.add(file)

    if (options?.critical) {
      this.#criticalFiles.add(file)
    }

    if (options?.cause) {
      let blamedFiles = this.#blamedFiles.get(file)
      if (!blamedFiles) {
        blamedFiles = new Set()
        this.#blamedFiles.set(file, blamedFiles)
      }
      for (const cause of castArray(options.cause)) {
        blamedFiles.add(cause)
      }
    }

    // Once our internal state is ready, ask chokidar to watch the file,
    // which leads to a call to `this.match`.
    if (this.watcher) {
      this.#watch(file)
    }
  }

  /**
   * Call this whenever the watcher reports an added file. This method will
   * update any internal state that exists to support handling of missing
   * paths.
   */
  checkAddedPath(file: string): void {
    if (this.#missingPaths.delete(file)) {
      const parent = path.dirname(file)
      const childCount = this.#fallbackPaths.get(parent) ?? 0
      if (childCount > 0) {
        if (childCount === 1) {
          this.#fallbackPaths.delete(parent)
        } else {
          this.#fallbackPaths.set(parent, childCount - 1)
        }
      }
    }
  }

  /**
   * Due to unfortunate Chokidar behavior, we need to ensure parent
   * directories of missing files are matchable. If that ever gets fixed,
   * we can remove this method and the `checkAddedPath` method, then revert
   * back to simply calling `watcher?.add(file)`.
   *
   * @see https://github.com/paulmillr/chokidar/issues/1374
   */
  #watch(file: string, originalFile?: string): void {
    if (!existsSync(file)) {
      this.#missingPaths.add(file)

      const fallbackPath = path.dirname(file)
      if (fallbackPath !== file) {
        const childCount = this.#fallbackPaths.get(fallbackPath) ?? 0
        this.#fallbackPaths.set(fallbackPath, childCount + 1)
        this.#watch(fallbackPath, originalFile ?? file)
      }
    }
    if (!originalFile) {
      this.watcher!.add(file)
    }
  }

  forgetFile(file: string): void {
    this.watcher?.unwatch(file)

    this.#files.delete(file)
    this.#blamedFiles.delete(file)
    this.#criticalFiles.delete(file)

    // If the file is to blame for other files being watched, those files
    // may need to be rewatched if all their blamed files are forgotten.
    for (const [relatedFile, blamedFiles] of this.#blamedFiles) {
      if (blamedFiles.delete(file) && blamedFiles.size === 0) {
        this.forgetFile(relatedFile)
      }
    }
  }

  match(file: string): boolean {
    if (this.#files.has(file)) {
      return true
    }
    if (this.#fallbackPaths.has(file)) {
      return true
    }
    for (const matcher of this.#matchers) {
      if (matcher.match(file)) {
        return true
      }
      if (file === matcher.base) {
        return true
      }
    }
    return false
  }

  clear(): void {
    if (this.watcher) {
      for (const file of this.#files) {
        this.watcher.unwatch(file)
      }
      for (const matcher of this.#matchers) {
        this.watcher.unwatch(matcher.base)
      }
    }
    this.#files.clear()
    this.#blamedFiles.clear()
    this.#criticalFiles.clear()
    this.#missingPaths.clear()
    this.#fallbackPaths.clear()
    this.#matchers.length = 0
  }
}
