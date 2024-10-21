# jumpgen

![](https://img.shields.io/npm/v/jumpgen) ![](https://img.shields.io/npm/l/jumpgen)

> Easy, transparent ”watch mode” for filesystem access (powered by Chokidar)

**The problem:** You're writing a script that uses the filesystem as one of its inputs. You want to watch files for changes, so you can rerun your script when they change.

**The solution:** Use `jumpgen`.

Now, your script can use filesystem APIs without worrying about how to watch files for changes, leaving you to focus on the logic of your generator.

- Your script will rerun automatically when files it relies on get added, changed, or deleted.
- Glob patterns are also watched for you.
- Jumpgen determines if a path needs to be watched recursively, only its children, or just the path itself. This means your generator will only rerun when it needs to, reducing unnecessary work.
- Incremental updates are easier than ever, thanks to Jumpgen's [`task`](https://github.com/alloc/jumpgen/issues/5) API. _(coming soon)_
- If you have a long-running script, it can be automatically aborted if a file changes during its execution.
- If your script relies on third-party code that accesses the filesystem, you can tell Jumpgen to watch those files too, optionally [blaming other files](./docs/advanced.md#blamed-files) when it detects a change.
- If your script reads from a configuration file, you can tell Jumpgen to [“hard reset” the generator](./docs/advanced.md#critical-files) when that file changes. This is useful for far-reaching changes that might invalidate your entire script's output.
- It uses the [`chokidar@4`](https://github.com/paulmillr/chokidar), [`picomatch`](https://github.com/micromatch/picomatch), [`tinyglobby`](https://github.com/SuperchupuDev/tinyglobby), and [`fdir`](https://github.com/thecodrr/fdir) npm packages under the hood for file watching and globbing.

#### What this library isn't for

- Jumpgen isn't focused on ”project scaffolding”, like [`plop`](https://github.com/plopjs/plop) or [`yeoman`](https://yeoman.io/learning/). _But_ you can absolutely use it to build your own scaffolding tools.
- Jumpgen isn't focused on basic file-watching tasks. If you're looking for a simple way to watch files for changes, use [`chokidar`](https://github.com/paulmillr/chokidar) directly.
- Jumpgen isn't focused on basic script re-running. If you're looking to rerun a script when files change, use something like [`watchlist`](https://github.com/lukeed/watchlist) instead.

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
