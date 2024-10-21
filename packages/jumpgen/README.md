# jumpgen

**jumpgen** is a tiny framework for generating files.

With it, you can easily do the following:

- Automatically watch files that you read into memory, so changes to them will rerun your generator
- Automatically watch globs and directories that you scan, so added and deleted files will rerun your generator
- Use template literals without worrying about excess indentation
- Abort an asynchronous generator when a file changes
- Only write files if they have changed

It uses the [`chokidar@4`](https://github.com/paulmillr/chokidar), [`picomatch`](https://github.com/micromatch/picomatch), and [`tinyglobby`](https://github.com/SuperchupuDev/tinyglobby) npm packages under the hood for file watching and globbing.

#### API Reference

See the [API Reference](./docs/api.md) for the full documentation.

## Installation

```bash
pnpm add jumpgen
```

## Usage

Define your generator with a name and a function that receives a `Context` object with helper functions for reading, scanning, and writing files. Your generator should avoid using `node:fs` APIs directly, or else file-watching will break.

```ts
import { jumpgen } from 'jumpgen'

export default jumpgen(
  'my-generator',
  async ({ read, scan, dedent, write }) => {
    // Find files to use as source modules. If a file matching your globs
    // is later added or removed, your generator will be rerun (if watch
    // mode is enabled).
    const sourceModulePaths = scan(['src/**/*.ts', '!**/*.test.ts'], {
      absolute: true,
    })

    // When you read a file, and you later change or delete it, your generator
    // will be rerun (if watch mode is enabled).
    const contents = sourceModulePaths.map(p => read(p))

    // When you write a file, your generator emits a "write" event. This
    // is useful for logging, which helps you understand what's happening.
    contents.forEach((content, i) => {
      const outPath = sourceModulePaths[i].replace(/\.ts$/, '.js')
      write(outPath, transform(content))
    })

    // Use the "dedent" function to remove excess indentation from your
    // template literals.
    write(
      'foo.ts',
      dedent`
        export const foo = true
      `
    )
  }
)
```

To run your generator, simply import and call it.

```ts
import myGenerator from './my-generator.js'

// This example uses the default options.
const runner = myGenerator({
  // All file operations are relative to this path.
  root: process.cwd(),

  // Watch mode must be explicitly enabled.
  watch: false,

  // You may provide your own EventEmitter, which is mainly useful for
  // consolidating events across multiple generators. Whether or not you
  // provide one, you can listen for events on the `runner.events` property.
  events: undefined,
})

// The generator runs immediately. To wait for it to finish, you can
// await it or call its "then" method.
await runner
// or
runner.then(() => {
  console.log('done')
})

// If the generator is asynchronous and respects the abort signal it's given,
// you can stop it early with the "stop" method. This also disables file watching.
await runner.stop()

// Listen to events from the runner.
runner.events.on('start', generatorName => {
  console.log(generatorName, 'started')
})
runner.events.on('write', (file, generatorName) => {
  console.log(generatorName, 'wrote', file)
})
runner.events.on('finish', (result, generatorName) => {
  console.log(generatorName, 'finished with', result)
})
runner.events.on('error', (error, generatorName) => {
  console.error(generatorName, 'errored with', error)
})
```

### Composing generators

The `compose` function lets you combine multiple generators into a single generator that runs them all in parallel.

```ts
import { compose } from 'jumpgen'

// The returned generator has the same API as the generators you pass to it,
// except it resolves with an array containing the results of all the generators.
const myGenerator = compose(generatorA, generatorB)
```

## Testing

See the [testing guide](./docs/testing.md) for information on how to test your generators.

## License

MIT
