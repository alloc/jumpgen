import { isError, isPromise, noop } from 'radashi'
import {
  createJumpgenContext,
  JumpgenContext,
  JumpgenEventEmitter,
  JumpgenOptions,
} from './context'

export { compose } from './compose'

export type Context = Omit<
  JumpgenContext,
  'abort' | 'events' | 'reset' | 'watcher'
>

export type Jumpgen<Result> = PromiseLike<Result> & {
  events: JumpgenEventEmitter
  /**
   * In watch mode
   */
  stop(): Promise<void>
}

export function jumpgen<Return>(
  generatorName: string,
  generator: (context: Context) => Return
) {
  async function run(context: JumpgenContext): Promise<Awaited<Return>> {
    // Give the caller a chance to attach event listeners.
    await Promise.resolve()

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
    }
  }

  return (options?: JumpgenOptions): Jumpgen<Awaited<Return>> => {
    const context = createJumpgenContext(generatorName, options)

    let promise = run(context)
    promise.catch(noop)

    context.watcher?.on('all', (event, file) => {
      if (context.signal.aborted) {
        return
      }
      if (event === 'change' && !context.watchedFiles.has(file)) {
        // This file was only scanned, not read into memory, so changes to
        // its contents are not relevant.
        return
      }
      const rerun = () => {
        context.reset()
        promise = run(context)
        promise.catch(noop)
      }
      promise.then(rerun, rerun)
      context.abort()
    })

    return {
      then(onfulfilled, onrejected) {
        return promise.then(onfulfilled, onrejected)
      },
      events: context.events,
      async stop() {
        context.abort()
        await context.watcher?.close()
      },
    }
  }
}
