import { FSWatcher } from 'chokidar'
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
  #watchedFiles = new Set<string>()
  #blamedFiles = new Map<string, Set<string>>()
  #criticalFiles = new Set<string>()
  #matchers: Matcher[] = []

  /**
   * When defined, base directories from `this.add` calls and files from
   * `this.addFile` calls are watched for changes.
   */
  watcher: FSWatcher | undefined = undefined

  /**
   * A set of files that have been explicitly watched. Base directories
   * from `this.add` calls are not included. Files added with a `cause`
   * option are not included.
   */
  get watchedFiles(): ReadonlySet<string> {
    return this.#watchedFiles
  }

  get blamedFiles(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.#blamedFiles
  }

  isFileCritical(file: string): boolean {
    return this.#criticalFiles.has(file)
  }

  add(patterns: string | string[], options?: picomatch.PicomatchOptions): void {
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
      const { base, glob } = picomatch.scan(pattern)
      const depth = path.normalize(base).split(path.sep).length

      let index = this.#matchers.findIndex(m => depth > m.depth)
      if (index === -1) {
        index = this.#matchers.length
      }

      this.watcher?.add(base)
      this.#matchers.splice(index, 0, {
        base,
        glob,
        depth,
        match: picomatch(pattern, options),
      })
    }
  }

  addFile(
    file: string,
    options?: { cause?: string | string[]; critical?: boolean }
  ): void {
    this.watcher?.add(file)
    this.#watchedFiles.add(file)

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
  }

  match(file: string): boolean {
    if (this.#watchedFiles.has(file)) {
      return true
    }
    for (const matcher of this.#matchers) {
      if (matcher.match(file)) {
        return true
      }
    }
    return false
  }

  clear(): void {
    if (this.watcher) {
      for (const file of this.#watchedFiles) {
        this.watcher.unwatch(file)
      }
      for (const matcher of this.#matchers) {
        this.watcher.unwatch(matcher.base)
      }
    }
    this.#watchedFiles.clear()
    this.#blamedFiles.clear()
    this.#criticalFiles.clear()
    this.#matchers.length = 0
  }
}
