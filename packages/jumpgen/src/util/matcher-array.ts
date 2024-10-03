import { FSWatcher } from 'chokidar'
import micromatch, { Options } from 'micromatch'
import path from 'node:path'
import { isArray } from 'radashi'

export type Matcher = {
  base: string
  glob: string
  depth: number
  match: (s: string) => boolean
}

export class MatcherArray {
  private files = new Set<string>()
  private matchers: Matcher[] = []

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
    return this.files
  }

  add(patterns: string | string[], options?: Options): void {
    if (isArray(patterns)) {
      patterns = patterns.flatMap(p => micromatch.braces(p, { expand: true }))
    } else {
      patterns = micromatch.braces(patterns, { expand: true })
    }

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
      const { base, glob } = micromatch.scan(pattern)
      const depth = path.normalize(base).split(path.sep).length

      let index = this.matchers.findIndex(m => depth > m.depth)
      if (index === -1) {
        index = this.matchers.length
      }

      this.watcher?.add(base)
      this.matchers.splice(index, 0, {
        base,
        glob,
        depth,
        match: micromatch.matcher(pattern, options),
      })
    }
  }

  addFile(file: string): void {
    this.watcher?.add(file)
    this.files.add(file)
  }

  match(file: string): boolean {
    if (this.files.has(file)) {
      return true
    }
    for (const matcher of this.matchers) {
      if (matcher.match(file)) {
        return true
      }
    }
    return false
  }

  clear(): void {
    if (this.watcher) {
      for (const file of this.files) {
        this.watcher.unwatch(file)
      }
      for (const matcher of this.matchers) {
        this.watcher.unwatch(matcher.base)
      }
    }
    this.files.clear()
    this.matchers.length = 0
  }
}
