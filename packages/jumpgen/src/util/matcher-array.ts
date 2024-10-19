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
  #files = new Set<string>()
  #blamedFiles = new Map<string, Set<string>>()
  #criticalFiles = new Set<string>()
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
      const { base, glob } = picomatch.scan(pattern)
      const depth = path.normalize(base).split(path.sep).length

      let index = this.#matchers.findIndex(m => depth > m.depth)
      if (index === -1) {
        index = this.#matchers.length
      }

      const rootDir = options.cwd + path.sep
      const match = picomatch(pattern, options)

      this.#matchers.splice(index, 0, {
        base,
        glob,
        depth,
        match: file =>
          file.startsWith(rootDir) && match(file.slice(rootDir.length)),
      })

      // Once our internal state is ready, ask chokidar to watch the
      // directory, which leads to a call to `this.match`.
      this.watcher?.add(path.join(options.cwd, base))
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
    this.watcher?.add(file)
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
    for (const matcher of this.#matchers) {
      if (matcher.match(file)) {
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
    this.#matchers.length = 0
  }
}
