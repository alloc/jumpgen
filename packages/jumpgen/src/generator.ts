import path from 'node:path'
import { isError, isPromise, noop, sleep } from 'radashi'
import { createJumpgenContext, FileChangeLog, JumpgenContext } from './context'
import { JumpgenEventEmitter } from './events'
import { JumpgenOptions } from './options'

export { compose } from './compose'
export type { FileChange, JumpgenFS } from './context'
export { File } from './file'
export type { JumpgenEventEmitter, JumpgenOptions }

export interface Context<
  TStore extends Record<string, any> = Record<string, never>,
  TEvent extends { type: string } = never
> extends Omit<
    JumpgenContext<TStore, TEvent>,
    'abort' | 'destroy' | 'events' | 'reset'
  > {}

export interface Jumpgen<TEvent extends { type: string }, TResult>
  extends PromiseLike<TResult> {
  get events(): JumpgenEventEmitter<TEvent>
  get watchedFiles(): ReadonlySet<string>
  /**
   * If you just updated some files programmatically, you can await a call
   * to this method to ensure that a new generator run has started before
   * you await the generator itself.
   *
   * @example
   * ```ts
   * fs.writeFileSync('foo.json', JSON.stringify({ foo: 'bar' }))
   * await generator.waitForStart()
   * await generator
   * ```
   */
  waitForStart(timeout?: number): Promise<void>
  /**
   * Abort the current generator run (if any) and start a new one. In watch
   * mode, you shouldn't *need* to call this, but if your generator isn't
   * able to watch everything it depends on, it could be necessary.
   */
  rerun(): Promise<TResult>
  /**
   * Abort the current generator run and stop watching for changes (if in
   * watch mode). Afterward, the generator cannot be reused, so you have to
   * create a new instance.
   */
  destroy(): Promise<void>
}

export function jumpgen<
  TStore extends Record<string, any> = Record<string, never>,
  TEvent extends { type: string } = never,
  TReturn = void
>(
  generatorName: string,
  generator: (context: Context<TStore, TEvent>) => TReturn
) {
  let running = false

  async function run(
    context: JumpgenContext<TStore, TEvent>
  ): Promise<Awaited<TReturn>> {
    // Give the caller a chance to attach event listeners.
    await Promise.resolve()

    running = true
    context.events.emit('start', generatorName)
    try {
      let result: any = generator(context)
      if (isPromise(result)) {
        result = await result
      }
      context.events.emit('finish', result, generatorName)
      return result
    } catch (error: any) {
      if (!isError(error)) {
        error = new Error('Unexpected error: ' + String(error))
      }
      context.events.emit('error', error, generatorName)
      throw error
    } finally {
      running = false
    }
  }

  return (
    options?: JumpgenOptions<TEvent>
  ): Jumpgen<TEvent, Awaited<TReturn>> => {
    const context = createJumpgenContext<TStore, TEvent>(generatorName, options)

    let startEvent = Promise.withResolvers<void>()
    context.events.on('start', () => {
      startEvent.resolve()
      startEvent = Promise.withResolvers()
    })

    let promise = run(context)
    promise.catch(noop)

    const changes: FileChangeLog = new Map()
    const rerun = () => {
      context.reset(changes)
      context.changes = Array.from(changes.values())
      changes.clear()

      promise = run(context)
      promise.catch(noop)

      return promise
    }

    if (context.isWatchMode) {
      context.events.on('watch', (event, file) => {
        if (event === 'change' && !context.watchedFiles.has(file)) {
          // This file was only scanned, not read into memory, so changes
          // to its contents are not relevant.
          return
        }

        // Simplify the event type for the sake of the change log.
        if (event === 'addDir') {
          event = 'add'
        } else if (event === 'unlinkDir') {
          event = 'unlink'
        }

        // If the affected file has another file to “blame” for its
        // changes, then treat this as a change to the blamed file.
        const blamedFiles = context.blamedFiles.get(file)
        if (blamedFiles) {
          for (const blamedFile of blamedFiles) {
            if (!changes.has(blamedFile)) {
              changes.set(blamedFile, {
                event: 'change',
                file: path.relative(context.root, blamedFile),
              })
            }
          }
        } else {
          const lastChange = changes.get(file)
          if (!lastChange) {
            changes.set(file, {
              event,
              file: path.relative(context.root, file),
            })
          } else if (event !== 'change') {
            // Avoid overwriting "add" or "unlink" with "change".
            lastChange.event = event
          }
        }

        if (!context.signal.aborted) {
          promise.then(rerun, rerun)
          context.abort()
        }
      })
    }

    return {
      then(onfulfilled, onrejected) {
        return promise.then(onfulfilled, onrejected)
      },
      events: context.events,
      get watchedFiles() {
        return context.watchedFiles
      },
      waitForStart(timeout) {
        if (timeout != null) {
          return Promise.race([
            startEvent.promise,
            sleep(timeout).then(() => {
              throw new Error('Timed out')
            }),
          ])
        }
        return startEvent.promise
      },
      rerun() {
        if (!running) {
          return rerun()
        }
        // If already aborted by a rerun call or a file change, wait for
        // the generator to start before accessing the current promise.
        if (context.signal.aborted) {
          return startEvent.promise.then(() => promise)
        }
        // Otherwise, abort the current run and start a new one after the
        // current promise is resolved.
        context.abort()
        return promise.then(rerun, rerun)
      },
      destroy: context.destroy,
    }
  }
}
