import path from 'node:path'
import { isError, isPromise, noop, sleep } from 'radashi'
import {
  createJumpgenContext,
  FileChangeLog,
  JumpgenContext,
  JumpgenStatus,
} from './context'
import { JumpgenEventEmitter } from './events'
import { JumpgenOptions } from './options'

export { compose } from './compose'
export type { FileChange, JumpgenFS } from './context'
export { File } from './file'
export { JumpgenStatus }
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
  readonly events: JumpgenEventEmitter<TEvent, TResult>
  /**
   * Exists when the generator is running in watch mode.
   */
  readonly watcher: JumpgenContext['watcher']
  /**
   * The current status of the generator.
   */
  get status(): JumpgenStatus
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
  async function run(
    context: JumpgenContext<TStore, TEvent>
  ): Promise<Awaited<TReturn>> {
    // Give the caller a chance to attach event listeners.
    await Promise.resolve()

    context.status = JumpgenStatus.Running
    context.events.emit('start', generatorName)
    try {
      let result: any = generator(context)
      if (isPromise(result)) {
        result = await result
      }
      if (context.watcher) {
        await context.watcher.ready
      }
      context.events.emit('finish', result, generatorName)
      return result
    } catch (error: any) {
      if (!isAbortError(error)) {
        if (!isError(error)) {
          error = new Error('Unexpected error: ' + String(error))
        }
        context.events.emit('error', error, generatorName)
      }
      throw error
    } finally {
      context.status = JumpgenStatus.Finished
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

    if (context.watcher) {
      const { blamedFiles, watchedFiles } = context.watcher

      context.events.on('watch', (event, file) => {
        if (event === 'change' && !watchedFiles.has(file)) {
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
        for (const blamedFile of blamedFiles.get(file) ?? [file]) {
          const lastChange = changes.get(blamedFile)
          if (!lastChange) {
            changes.set(blamedFile, {
              event,
              file: path.relative(context.root, blamedFile),
            })
          } else if (event !== 'change') {
            // Avoid overwriting "add" or "unlink" with "change".
            lastChange.event = event
          }
        }

        if (context.status !== JumpgenStatus.Pending) {
          promise.then(rerun, rerun)
          context.abort('watch')
          context.status = JumpgenStatus.Pending
        }
      })
    }

    return {
      then(onfulfilled, onrejected) {
        return promise.then(onfulfilled, onrejected)
      },
      events: context.events,
      watcher: context.watcher,
      get status() {
        return context.status
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
        if (context.status === JumpgenStatus.Finished) {
          return rerun()
        }
        // If already scheduled by a rerun call or a file change, wait for
        // the generator to start before accessing the current promise.
        if (context.status === JumpgenStatus.Pending) {
          return startEvent.promise.then(() => promise)
        }
        // Otherwise, abort the current run and start a new one after the
        // current promise is resolved.
        context.abort('rerun')
        return promise.then(rerun, rerun)
      },
      destroy: context.destroy,
    }
  }
}

function isAbortError(error: any) {
  return isError(error) && error.name === 'AbortError'
}
