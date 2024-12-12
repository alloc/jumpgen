import { EventEmitter } from 'node:events'
import path from 'node:path'
import { ShallowOptions } from 'option-types'
import { JumpgenEventEmitter } from './events'
import { stripTrailingSlash } from './util/path'

export type JumpgenOptions<TEvent extends { type: string } = never> =
  ShallowOptions<{
    /**
     * The directory from which all file operations are relative.
     *
     * @default process.cwd()
     */
    root?: string
    /**
     * Enable watch mode. Optionally, provide an array of paths to watch,
     * which will rerun the generator if they are changed.
     *
     * @default false
     */
    watch?: boolean | string[]
    /**
     * Override the default event emitter. Useful for consolidating events
     * across multiple generators.
     */
    events?: JumpgenEventEmitter<TEvent>
  }>

export function resolveOptions<TEvent extends { type: string }>(
  options: JumpgenOptions<TEvent>
) {
  return {
    ...options,
    root: stripTrailingSlash(
      options.root ? path.resolve(options.root) : process.cwd()
    ),
    watch: options.watch ?? false,
    events: options.events ?? new EventEmitter(),
  }
}

export type GlobOptions = import('picomatch').PicomatchOptions

export type FindUpOptions = Omit<GlobOptions, 'noglobstar'> & {
  /**
   * If set to `true`, the returned path will be absolute.
   *
   * @default false
   */
  absolute?: boolean
  /**
   * Stop searching when this condition is met.
   *
   * - If a single absolute path is provided, the search will stop at the
   *   nearest parent directory that matches this path.
   * - If an array of strings is provided, they are interpreted as globs
   *   and are matched against the children of the current directory.
   * - If a function is provided, it will be called with the absolute path
   *   of each searched directory and should return `true` if the search
   *   should stop.
   */
  stop?: string | string[] | ((dir: string) => boolean)
}

export type ScanOptions = import('tinyglobby').GlobOptions & {
  /**
   * If set to `false`, the globs won't be watched when jumpgen runs in
   * watch mode.
   *
   * @default true
   */
  watch?: boolean
  /**
   * If set to `true`, your generator won't rerun when a new file is added
   * that is empty (i.e. its `stat` object has a `size` of `0`).
   *
   * @default false
   */
  ignoreEmptyNewFiles?: boolean
}

export type ListOptions = {
  /**
   * If set to `true`, the file paths will be absolute.
   *
   * @default false
   */
  absolute?: boolean
  /**
   * A glob pattern to filter the list of files.
   *
   * Globstars (`**`) and separators (`/`) are not allowed.
   */
  glob?: string | string[]
  /**
   * Options to pass to picomatch.
   *
   * Dotfiles are enabled by default.
   */
  globOptions?: Omit<GlobOptions, 'cwd' | 'noglobstar'>
  /**
   * If set to `false`, the directory won't be watched when jumpgen runs in
   * watch mode.
   *
   * @default true
   */
  watch?: boolean
}

export type ReadOptions = {
  /**
   * The file encoding. By default, the file is read as a Buffer object.
   *
   * @default null
   * @see https://nodejs.org/api/buffer.html#buffers-and-character-encodings
   */
  encoding?: BufferEncoding | null | undefined
  /**
   * When true, changes to this file will ”hard reset” the generator,
   * resetting its `state` object and clearing the list of watched files.
   * This is most useful when reading ”config files” which have widespread
   * effects on the entire generation process.
   *
   * @default false
   */
  critical?: boolean
  /**
   * Control the behavior of readFileSync. Set to `"a+"` to create a file
   * if it doesn't exist.
   *
   * @default 'r'
   * @see https://nodejs.org/api/fs.html#file-system-flags
   */
  flag?: 'r' | 'a+' | (string & {})
}

export type WatchOptions = {
  /**
   * Files to blame for these unaccessed files' need to be watched. Also
   * known as associative watching, this is useful when third party code is
   * accessing files in a way you can't control.
   *
   * When this option is set, the blamed files will be included in
   * `changedFiles` instead of the watched files, so you can more easily
   * invalidate your generator's data store. Also, a watched file may be
   * automatically unwatched if all blamed files have been changed or
   * deleted.
   *
   * When a “critical” file is passed here, related file changes will reset
   * the generator's state as if the critical file itself was changed.
   */
  cause?: string | string[]
}
