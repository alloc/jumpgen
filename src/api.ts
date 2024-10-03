import type { Options as GlobOptions } from 'fast-glob'
import type { Program } from '../estree'
import dedent from 'dedent'
import { Options as MeriyahOptions } from 'meriyah'
import { Transform, Options as SucraseOptions } from 'sucrase'

type Promisable<T> = T | Promise<T>

export interface ParseModuleOptions extends Omit<MeriyahOptions, 'next'> {
  transforms?: Transform[]
  transformOptions?: Omit<SucraseOptions, 'transforms'>
}

export interface API {
  scan(source: string | string[], options?: GlobOptions): string[]

  read(
    path: string,
    options?: {
      encoding?: null | undefined
      flag?: string | undefined
    } | null
  ): Buffer

  read(
    path: string,
    options:
      | {
          encoding: BufferEncoding
          flag?: string | undefined
        }
      | BufferEncoding
  ): string

  read(
    path: string,
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): string | Buffer

  write(path: string, data: string | Buffer): void

  writeEnv(path: string, data: Record<string, any>): void

  dedent: typeof dedent

  /**
   * Serialize a JavaScript value into equivalent JavaScript code.
   */
  serialize(value: any, options?: SerializeOptions): string

  parseModule(path: string, options?: ParseModuleOptions): Program

  parseModuleText(
    text: string,
    options?: ParseModuleOptions,
    file?: string
  ): Program

  /**
   * Similar to `import(…)` but its result can be casted with `loadModule<Exports>(…)` and it
   * returns null when the module is not found, instead of rejecting.
   *
   * The loaded module and any local modules imported by it are watched by `codegentool` so the
   * generator can automatically rerun on changes.
   *
   * Finally, it fixes the import path to be relative to the bundled generator (kept elsewhere in
   * the filesystem), which is the main reason to use this over `import(…)`. You can optionally
   * provide a `basedir` argument to use instead of the bundled generator's directory.
   */
  loadModule<Exports = any>(
    path: string,
    basedir?: string
  ): Promise<Exports | null>
}

export function defineGenerator(fn: (api: API) => Promisable<void>) {
  return fn
}

export interface SerializeOptions {
  /**
   * This option is the same as the space argument that can be passed to JSON.stringify.
   * It can be used to add whitespace and indentation to the serialized output to make it more readable.
   */
  space?: string | number | undefined
  /**
   * This option is a signal to serialize() that the object being serialized does not contain any function or regexps values.
   * This enables a hot-path that allows serialization to be over 3x faster.
   * If you're serializing a lot of data, and know its pure JSON, then you can enable this option for a speed-up.
   */
  isJSON?: boolean | undefined
  /**
   * This option is to signal serialize() that we want to do a straight conversion, without the XSS protection.
   * This options needs to be explicitly set to true. HTML characters and JavaScript line terminators will not be escaped.
   * You will have to roll your own.
   */
  unsafe?: true | undefined
  /**
   * This option is to signal serialize() that we do not want serialize JavaScript function.
   * Just treat function like JSON.stringify do, but other features will work as expected.
   */
  ignoreFunction?: boolean | undefined
}
