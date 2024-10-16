# Testing

The easiest way to test a jumpgen generator is with “module mocking”, a feature supported by many test frameworks, like Vitest.

With module mocking, you can substitute usage of `node:fs` with an in-memory implementation, allowing you to control the behavior of the file system for each test.

The recommended “mock implementation” is [`memfs`](https://github.com/streamich/memfs).

### Example

In this example, we'll use Vitest.

1. Install `memfs` and `vitest`.

   ```bash
   pnpm add memfs vitest -D
   ```

1. Create the `__mocks__/fs.cjs` module in your test folder. This will contain the mock implementation. It's recommended to use CommonJS syntax, so you don't have to manually export each function from `memfs`.

   ```js
   const { fs } = require('memfs')
   module.exports = fs
   ```

   You don't need to mock `fs/promises`, since jumpgen only uses synchronous file system APIs.

1. To ensure the filesystem mock is actually used, we need to tell Vitest to process Jumpgen, since the default behavior is to avoid processing `node_modules` entirely. In your Vitest config, add the following:

   ```js
   export default defineConfig({
     test: {
       server: {
         deps: {
           inline: ['jumpgen'],
         },
       },
     },
   })
   ```

1. In your test file, tell Vitest to use the mock implementation of `fs`.

   ```js
   import { beforeEach, vi } from 'vitest'
   import { fs, vol } from 'memfs'

   vi.mock('fs')

   // Reset the in-memory file system before each test.
   beforeEach(() => {
     vol.reset()
   })
   ```

   For more information on using `memfs`, see the [API reference](https://github.com/streamich/memfs/blob/master/docs/node/reference.md).
