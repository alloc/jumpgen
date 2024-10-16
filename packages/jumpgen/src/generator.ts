import path from 'node:path'
import { isError, isPromise, noop } from 'radashi'
import { createJumpgenContext, FileChangeLog, JumpgenContext } from './context'
import { JumpgenEventEmitter } from './events'
import { JumpgenOptions } from './options'

export { compose } from './compose'
export { File } from './file'

export type Context = Omit<
  JumpgenContext,
  'abort' | 'events' | 'reset' | 'watcher'
>

export type Jumpgen<Result> = PromiseLike<Result> & {
  events: JumpgenEventEmitter
  /**
   * Abort the current generator run and stop watching for changes (if in
   * watch mode). Afterward, the generator cannot be reused, so you have to
   * create a new instance.
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
    const changes: FileChangeLog = new Map()

    let promise = run(context)
    promise.catch(noop)

    context.watcher?.on('all', (event, file) => {
      if (event === 'change' && !context.accessedFiles.has(file)) {
        // This file was only scanned, not read into memory, so changes to
        // its contents are not relevant.
        return
      }

      // If the affected file has another file to “blame” for its changes,
      // then treat this as a change to the blamed file.
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
        const rerun = () => {
          context.reset(changes)
          context.changes = Array.from(changes.values())
          changes.clear()

          promise = run(context)
          promise.catch(noop)
        }
        promise.then(rerun, rerun)
        context.abort()
      }
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
