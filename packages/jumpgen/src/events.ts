import { EventEmitter } from 'node:events'

export type ChokidarEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

export type JumpgenEvents = {
  start: [generatorName: string]
  watch: [event: ChokidarEvent, file: string, generatorName: string]
  write: [file: string, generatorName: string]
  finish: [result: any, generatorName: string]
  error: [error: Error, generatorName: string]
}

export type JumpgenEventEmitter<TEvents extends Record<string, any[]> = {}> =
  EventEmitter<JumpgenEvents & TEvents>
