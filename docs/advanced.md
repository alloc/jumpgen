# Advanced Concepts

## Blamed Files

If your generator relies on third-party code that happens to access the filesystem on its own, you can use “associative watching” (known in Jumpgen as “file blaming”) to watch the files that the third-party code accesses.

This requires the third-party API to expose which files it accesses. Then, all you have to do is pass the list of files to Jumpgen's `watch` method.

```ts
import someLibrary from 'some-library'

const runExample = jumpgen('example', ({ fs, watch, changes }) => {
  const someFile = fs.findUp('some-file.txt')
  const someResult = someLibrary.doThing(someFile)

  // Tell Jumpgen to watch the files that `someLibrary` accessed,
  // and blame `someFile` when they change.
  watch(someLibrary.arrayOfUsedFiles, {
    cause: someFile,
  })

  // When a file that `someLibrary` accessed is changed, you'll find
  // `someFile` in the array of changes.
  if (changes.includes(someFile)) {
    // ...
  }
})

await runExample()
```

The primary use case is related to incremental updates. By blaming a file your generator passed into the third-party API, you can cache expensive calculations or avoid re-generating certain output files, using the blamed file as the cache key.

## Critical Files

When reading a file, you can specify that the file is critical to the generator's operation. If that file is affected during a generator run, a rerun will be scheduled as normal, but the generator will reset its `store` and unwatch every watched path. This effectively "resets" the generator.

The most obvious use case for critical files is to reset generators that read from configuration files.

```ts
import { jumpgen } from 'jumpgen'

const runExample = jumpgen('example', ({ fs, store }) => {
  // Read the config file. If it changes, the generator will reset.
  const config = JSON.parse(
    fs.read('config.json', { encoding: 'utf8', critical: true })
  )

  // Derive some data from the config and preserve it across generator runs.
  // The stored data gets cleared if the config file changes; otherwise,
  // it remains available to future steps.
  store.someData ??= calculateSomeData(config.otherData)

  // ...
})

await runExample()
```
