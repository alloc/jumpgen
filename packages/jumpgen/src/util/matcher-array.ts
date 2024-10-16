import { FSWatcher } from 'chokidar'
import path from 'node:path'
import picomatch from 'picomatch'

export type Matcher = {
  base: string
  glob: string
  depth: number
  match: (s: string) => boolean
}

export class MatcherArray {
  #watchedFiles = new Set<string>()
  #matchers: Matcher[] = []

  /**
   * When defined, base directories from `this.add` calls and files from
   * `this.addFile` calls are watched for changes.
   */
  watcher: FSWatcher | undefined = undefined

  /**
   * A set of files that have been explicitly watched. Base directories
   * from `this.add` calls are not included.
   */
  get watchedFiles(): ReadonlySet<string> {
    return this.#watchedFiles
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

  addFile(file: string): void {
    this.watcher?.add(file)
    this.#watchedFiles.add(file)
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
    this.#matchers.length = 0
  }
}
