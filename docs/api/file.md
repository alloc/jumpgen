# File API

The “file API” is provided by the `File` class. It effectively binds a file path to the current `Context` object, so you can pass it around more easily.

While the `File` class is provided by the `jumpgen` package, you may want to use the context-specific `File` class instead, which has the context injected for you. In particular, it's really handy if you prefer to destructure the context object (in which case, you won't have a reference to the entire context anymore).

```ts
import { jumpgen, File } from 'jumpgen'

// The “hard” way to create a File object:
const myGenerator = jumpgen('name', context => {
  const file = new File('path/to/file.txt', context)
})

// The simpler way to create a File object:
const otherGenerator = jumpgen('other', ({ File }) => {
  const file = new File('path/to/file.txt')
})
```

#### `File` instance

- **Properties**

  - `path`: The file path, relative to the `root` directory.
  - `name`: The file's base name.
  - `absolutePath`: The file path prefixed with the `root` directory.

- **Methods**

  - `exists()`: Whether the file exists on the filesystem. [Read more](./context.md#fs.exists)
  - `isFile()`: Whether the file exists and is a regular file. [Read more](./context.md#fs.fileExists)
  - `isDirectory()`: Whether the file exists and is a directory. [Read more](./context.md#fs.directoryExists)
  - `isSymlink()`: Whether the file exists and is a symbolic link. [Read more](./context.md#fs.symlinkExists)
  - `read(options?)`: Read the file's contents. [Read more](./context.md#fs.read)
  - `tryRead(options?)`: Read the file's contents, returning `null` if the file does not exist. [Read more](./context.md#fs.tryread)
  - `write(data)`: Write data to the file. [Read more](./context.md#fs.write)
