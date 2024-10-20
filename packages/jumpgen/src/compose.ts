import EventEmitter from 'node:events'
import { sleep } from 'radashi'
import { JumpgenEventEmitter } from './events'
import { Jumpgen, JumpgenStatus } from './generator'
import { JumpgenOptions } from './options'

/**
 * Combines multiple generators into a single generator that runs them all
 * in parallel.
 */
export function compose<TEvent extends { type: string }, TReturn>(
  ...generators: ((
    options?: JumpgenOptions<TEvent>
  ) => Jumpgen<TEvent, TReturn>)[]
) {
  return (options?: JumpgenOptions<TEvent>): Jumpgen<TEvent, TReturn[]> => {
    const events: JumpgenEventEmitter<TEvent> = new EventEmitter()
    const runners = generators.map(generator =>
      generator({ ...options, events })
    )
    return {
      get status() {
        return runners.some(runner => runner.status === JumpgenStatus.Running)
          ? JumpgenStatus.Running
          : runners.some(runner => runner.status === JumpgenStatus.Pending)
          ? JumpgenStatus.Pending
          : JumpgenStatus.Finished
      },
      then(onfulfilled, onrejected) {
        return Promise.all(runners).then(onfulfilled, onrejected)
      },
      events,
      get watchedFiles() {
        return new Set(runners.flatMap(runner => [...runner.watchedFiles]))
      },
      waitForStart(timeout) {
        const promises = runners.map(runner => runner.waitForStart())
        if (timeout != null) {
          promises.push(
            sleep(timeout).then(() => {
              throw new Error('Timed out')
            })
          )
        }
        return Promise.race(promises)
      },
      rerun() {
        return Promise.all(runners.map(runner => runner.rerun()))
      },
      async destroy() {
        await Promise.all(runners.map(runner => runner.destroy()))
      },
    }
  }
}
