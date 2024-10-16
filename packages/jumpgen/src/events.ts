import { EventEmitter } from 'node:events'

export type JumpgenEvents = {
  start: [generatorName: string]
  write: [file: string, generatorName: string]
  finish: [result: any, generatorName: string]
  error: [error: Error, generatorName: string]
}

export type JumpgenEventEmitter = EventEmitter<JumpgenEvents>
