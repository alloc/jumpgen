import { basename, isAbsolute, join, relative } from 'node:path'
import { kJumpgenContext } from './symbols'

type FileContext = {
  root: string
  fs: {
    exists(path: string): boolean
    fileExists(path: string): boolean
    symlinkExists(path: string): boolean
    directoryExists(path: string): boolean
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
    tryRead(
      path: string,
      options?:
        | {
            encoding?: BufferEncoding | null | undefined
            flag?: string | undefined
          }
        | BufferEncoding
        | null
    ): string | Buffer | null
    write(path: string, data: string | Buffer): void
  }
}

const getFileContext = (file: File) =>
  (file as any)[kJumpgenContext] as FileContext

export class File {
  /**
   * The path of the file relative to the root directory.
   */
  readonly path: string

  constructor(path: string, context: FileContext) {
    Object.defineProperty(this, kJumpgenContext, { value: context })
    this.path = isAbsolute(path) ? relative(context.root, path) : path
  }

  /**
   * The file's base name.
   */
  get name() {
    return basename(this.path)
  }

  /**
   * The file path prefixed with the root directory.
   */
  get absolutePath() {
    return join(getFileContext(this).root, this.path)
  }

  exists() {
    return getFileContext(this).fs.exists(this.path)
  }

  isFile() {
    return getFileContext(this).fs.fileExists(this.path)
  }

  isDirectory() {
    return getFileContext(this).fs.directoryExists(this.path)
  }

  isSymlink() {
    return getFileContext(this).fs.symlinkExists(this.path)
  }

  /**
   * Read a file from the filesystem. File paths are allowed to be
   * relative. In watch mode, the file will be watched for changes.
   */
  read(
    options?: {
      encoding?: null | undefined
      flag?: string | undefined
    } | null
  ): Buffer

  read(
    options:
      | {
          encoding: BufferEncoding
          flag?: string | undefined
        }
      | BufferEncoding
  ): string

  read(
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): string | Buffer

  read(
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): any {
    return getFileContext(this).fs.read(this.path, options)
  }

  /**
   * Similar to `read` except that it returns `null` if the file does not
   * exist, instead of throwing an error.
   */
  tryRead(
    options?: {
      encoding?: null | undefined
      flag?: string | undefined
    } | null
  ): Buffer | null

  tryRead(
    options:
      | {
          encoding: BufferEncoding
          flag?: string | undefined
        }
      | BufferEncoding
  ): string | null

  tryRead(
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): string | Buffer | null

  tryRead(
    options?:
      | {
          encoding?: BufferEncoding | null | undefined
          flag?: string | undefined
        }
      | BufferEncoding
      | null
  ): any {
    return getFileContext(this).fs.tryRead(this.path, options)
  }

  /**
   * Write a file to the filesystem. If a parent directory does not exist,
   * it will be created. File paths are allowed to be relative. Emits a
   * `write` event after the file is written.
   */
  write(data: string | Buffer): void {
    getFileContext(this).fs.write(this.path, data)
  }
}
