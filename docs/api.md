# API Reference

This page documents the top-level functions and classes exported by the `jumpgen` package.

You may be looking for these pages instead:

- [Instance API](./api/instance.md)
- [Context API](./api/context.md)
- [File API](./api/file.md)

## `jumpgen(name, callback)`

Create a generator “factory function”.

The `name` string is included with any events emitted by the generator.

The `callback` function contains the generator logic. It receives a [`Context`](./api/context.md) object. Its return value is forwarded to the generator's promise.

It returns a factory function that accepts a `JumpgenOptions` object and returns a [`Jumpgen`](./api/instance.md) instance.

The `JumpgenOptions` object has the following properties:

- `root`: The root directory for all file operations. Defaults to the current working directory.
- `watch`: Whether to run the generator in watch mode. Defaults to `false`.
- `events`: An [`EventEmitter`](https://nodejs.org/api/events.html) instance that will receive all events emitted by the generator. Use this if you want to consolidate events across multiple generators. Defaults to a new `EventEmitter` instance.

### Currying

A common technique is to wrap your `jumpgen` call in an arrow function that accepts an options object. This is useful if you want to configure the generator with domain-specific options.

```ts
type MyGeneratorOptions = {
  // ...
}

const myGenerator = (options: MyGeneratorOptions = {}) =>
  jumpgen('my-generator', ctx => {
    // ...
  })

// 1. Customize the generator with options.
const generate = myGenerator()

// 2. Run the generator.
const generator = generate()

// 3. Wait for the generator to finish.
const result = await generator

// 4. Profit.
```

### Persistent Memory

The `store` object is a key-value store that your generator can use to share data between runs. When using TypeScript, it's a good idea to define a type for the store.

```ts
type Store = {
  foo: string
}

const myGenerator = jumpgen<Store>('my-generator', ctx => {
  // To detect a fresh run, check for a missing key in the store.
  if (ctx.store.foo === undefined) {
    ctx.store.foo = 'bar'
    // ... Possibly do some other setup work.
  }
})
```

This feature is invaluable for generators that want to implement incremental updates.

## `compose(...generators)`

Create a generator “factory function” that runs any number of generators in parallel.

Composed generators have the same API as a generator defined with `jumpgen(…)`, except that they resolve with an array of results instead of a single result, similar to `Promise.all`.

```ts
const generatorC = compose(generatorA, generatorB)

await generatorC()
// => [resultA, resultB]
```
