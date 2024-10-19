import { EventEmitter } from 'node:events'

export type ChokidarEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

export type JumpgenEvents<TEvent extends { type: string } = never> = {
  start: [generatorName: string]
  watch: [event: ChokidarEvent, file: string, generatorName: string]
  write: [file: string, generatorName: string]
  finish: [result: any, generatorName: string]
  error: [error: Error, generatorName: string]
  custom: [event: TEvent, generatorName: string]
}

export type JumpgenEventEmitter<TEvent extends { type: string } = never> =
  EventEmitter<JumpgenEvents<TEvent>>
