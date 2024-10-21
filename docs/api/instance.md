# Instance API

The ”instance API” is available when calling a factory function created with `jumpgen(…)`. It's defined by the `Jumpgen` interface.

```ts
const runGenerator = jumpgen('my-generator', () => {…})

// The `generator` object provides the instance API.
const generator = runGenerator()
```

#### Promise-like

Each generator instance is a promise-like object. This means it has a `then` method, but more importantly, it can be awaited.

If the generator returns something, awaiting the generator will return that value.

```ts
const result = await generator
```

&nbsp;

#### Properties

### `events`

An `EventEmitter` instance that the generator uses to communicate with the outside world as it runs. Generators don't have direct access to this, but their `emit` method allows them to emit custom events.

The last argument of every event is the generator's name, which is provided when the generator was defined with `jumpgen(name, …)`.

Generator instances may emit any of these events:

- `start()` A generator run has started.
- `watch(event, file)` A watched file has been added, changed, or removed.
  - **event** is one of `add`, `addDir`, `change`, `unlink`, `unlinkDir`
  - **file** is the absolute path that was affected
- `write(file)` A file has been written to disk.
  - **file** is the absolute path that was written
- `finish(result)` A generator run has finished.
  - **result** is whatever the generator returned
- `error(error)` An error occurred.
  - **error** is the error that occurred
- `abort(reason)` A generator run was aborted.
  - **reason** is whatever caused the generator to abort
- `destroy()` A generator was destroyed.
- `custom(event)` A custom event was emitted.
  - **event** is an object provided by the generator, with a `type` property

### `watchedFiles`

A readonly `Set` of every absolute path that the generator has accessed with `read` or watched with `watch`.

Note: Directories are not included.

&nbsp;

#### Methods

### `waitForStart(timeout?)`

If you just updated some files programmatically, you can await a call to this method to ensure that a new generator run has started before you await the generator itself.

The optional `timeout` argument is the number of milliseconds to wait before giving up. This is mostly used in testing. It _does not_ apply a timeout to the generator run itself.

```ts
fs.writeFileSync('foo.json', JSON.stringify({ foo: 'bar' }))
await generator.waitForStart()
await generator
```

_“Why does it work like this?”_ you might ask. It's a good question. If a previous generator run is still going when a file changes, awaiting the generator (without `waitForStart()` first) will effectively wait for the current run to finish. This is why `waitForStart()` is useful: It ensures that the generator has started a new run before you await it.

### `rerun()`

Abort the current generator run (if any) and start a new one.

If a generator run is already scheduled, this method calls `waitForStart()` and returns a promise for the new run.

In watch mode, you shouldn't _need_ to call this, but if your generator isn't able to watch everything it depends on, it could be necessary.

One possible use case is to listen on the `process.stdin` stream for a certain keypress, and then call `rerun()` when that key is pressed.

### `destroy()`

Abort the current generator run and stop watching for changes (if in watch mode). Afterward, the generator cannot be reused, so you have to create a new instance.
