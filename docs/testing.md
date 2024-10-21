# Testing

The most straight-forward way to test a jumpgen generator is with test fixtures and a test runner like [Vitest](https://vitest.dev/).

1. For each test, create a test fixture in the `test/__fixtures__` directory. This is usually a folder containing the necessary files and directories to run the generator. Sometimes, you might generate certain files in the fixture at test setup time if they are common dependencies of the generator (i.e. a `package.json` file or `tsconfig.json` file).

2. In your test file, use a glob library like [tinyglobby](https://github.com/SuperchupuDev/tinyglobby) to find the test fixtures in the `__fixtures__` directory. In a `for` loop, declare a test for each fixture. Generally, this means calling your generator's factory function with the fixture as the `root` directory.

3. It's recommended to “gitignore” any output files created by the generator. You may also want to clean up after each test, to avoid leaving test artifacts in your fixture.

If you have any questions, please [open an issue](https://github.com/alloc/jumpgen/issues/new).

&nbsp;

## Module mocking

Another way to test a jumpgen generator is with “module mocking”, a feature supported by many test frameworks, like Vitest.

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
