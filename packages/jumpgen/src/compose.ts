import EventEmitter from 'node:events'
import { JumpgenEventEmitter } from './events'
import { Jumpgen } from './generator'
import { JumpgenOptions } from './options'

/**
 * Combines multiple generators into a single generator that runs them all
 * in parallel.
 */
export function compose<Result>(
  ...generators: ((options?: JumpgenOptions) => Jumpgen<Result>)[]
) {
  return (options?: JumpgenOptions): Jumpgen<Result[]> => {
    const events: JumpgenEventEmitter = new EventEmitter()
    const runners = generators.map(generator => generator(options))
    return {
      then(onfulfilled, onrejected) {
        return Promise.all(runners).then(onfulfilled, onrejected)
      },
      events,
      async destroy() {
        await Promise.all(runners.map(runner => runner.destroy()))
      },
    }
  }
}
