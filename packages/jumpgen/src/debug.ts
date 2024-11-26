import createDebug from 'debug'

export const debug = createDebug('jumpgen')

if (process.env.TEST === 'jumpgen') {
  createDebug.log = console.log.bind(console)
  debug.enabled = true
}
