# Context API

The `Context` object is passed to the generator callback.

#### Properties

### `root`

The root directory for all file operations.

### `isWatchMode`

Whether the generator is running in watch mode.

### `signal`

An `AbortSignal` object that your generator should pass to any asynchronous operations that should be interruptable.

When a watched path is affected during a generator run, the signal will be aborted.

### `changes`

An array of `FileChange` objects describing the files that were modified, added, or deleted between the current generator run and the previous one.

Each `FileChange` object has the following properties:

- `event`: The type of change, which is one of `'change'`, `'add'`, or `'unlink'`.
- `file`: The path of the file that was changed, relative to the `root` directory.

This array is _not_ updated while the generator is running.

### `store`

An in-memory, key-value store that your generator can use to share data between runs.

If a [critical file](../advanced.md#critical-files) is touched, the store is reset.

### `File`

The constructor for the `File` class, with the current context pre-bound.

For more information, see the [File API](./file.md).

&nbsp;

#### Methods

### `dedent(string)`

Remove excess indentation from a string or tagged template literal.

Multi-line strings are supported.

```ts
const code = dedent`
  console.log('Hello, world!')
`
// => "console.log('Hello, world!');"
```

> [!TIP]
> If you'd like syntax highlighting for your template literals, check out the [Comment Tagged Templates](https://marketplace.visualstudio.com/items?itemName=bierner.comment-tagged-templates) VSCode extension.
>
> ```ts
> const code = dedent/* ts */ `
>   console.log('Hello, world!')
> `
> ```

### `emit(event)`

Emit a custom event. The `event` is an object with a `type` property and any other properties you want to include.

For type safety, you'll want to define a type alias for all possible custom events, then provide that to `jumpgen(…)` as the `TEvent` type parameter.

### `fs.directoryExists(path)`

Check if a directory exists. The `path` may be absolute or relative to the `root` directory. It gets watched for `addDir` and `unlinkDir` events. Its contents are not watched.

### `fs.exists(path)`

Check if a path exists (could be a file, directory, symlink, or whatever). The `path` may be absolute or relative to the `root` directory. It gets watched for `add`, `addDir`, `unlink`, and `unlinkDir` events. Its contents are not watched.

### `fs.fileExists(path)`

Check if a file exists. The `path` may be absolute or relative to the `root` directory. It gets watched for `add` and `unlink` events. Its contents are not watched.

### `fs.findUp(glob, options?)`

Traverse up the directory tree looking for a path matching the given glob pattern(s). If no match is found, the result is `null`. Otherwise, a matching path relative to the `root` directory is returned.

Every traversed directory is watched for changes.

#### Arguments

- The `glob` argument may be a string or an array of strings, each of which is a glob pattern that can be prefixed with `!` to exclude it.
  - Globstars (`**`) and separators (`/`) are not allowed.
- The `options` argument may be an object that may include:
  - any `picomatch` [options](https://github.com/micromatch/picomatch/blob/master/README.md#picomatch-options)
  - `stop`: used to limit the search
  - `cwd`: controls the starting directory for the search

#### Notes

- By default, the search stops at the generator's `root` directory.
- If `options.stop` is an absolute path, the search will stop at that directory.
- If `options.stop` is a function, it will stop at the first directory where that function returns `true`.
- If `options.stop` is a string or array of strings, the search will stop at the first directory where any matching paths are found.
- Globs used as a `stop` pattern should not include globstars (`**`) or separators (`/`).

### `fs.list(path, options?)`

List the children of a directory. The directory is allowed to be a relative path. In watch mode, the directory will be watched for changes (but not recursively). The contents of its children are not watched.

You may want to filter the list of files using the `glob` option, if you're only interested in a subset of the directory's contents. Doing so prevents unnecessary re-runs of the generator.

### `fs.lstat(path)`

Retrieve the `fs.Stats` object for a path. Unlike `fs.stat`, symbolic links are not followed beforehand. The `path` may be absolute or relative to the `root` directory.

The path is watched as if you called `fs.read(path)`. This is necessary because the `fs.Stats` object contains information about the file's size. You may prefer `symlinkExists()` instead if you don't need the size information.

If the path does not exist, `null` is returned.

### `fs.read(path, options?)`

Read the contents of a file. The `path` may be absolute or relative to the `root` directory.

The `options` argument may be an object, an `BufferEncoding` string, or `null` (the default encoding, which returns a `Buffer` object). The following options are supported:

- `encoding`: The encoding to use when reading the file.
- `flag`: The file open mode.
- `critical`: When true, the file is marked as critical. If this file is later modified, the generator is reset. See [Critical files](../advanced.md#critical-files).

To read a file as a string, the typical encoding of `utf8` should be passed as the `encoding` option.

### `fs.scan(glob, options?)`

Recursively scan a directory, looking for paths matching the given glob pattern(s). Relevant directories and matching paths are watched for changes.

#### Arguments

- The `glob` argument may be a string or an array of strings, each of which is a glob pattern that can be prefixed with `!` to exclude it.
- The `options` argument may be an object that includes:
  - any `tinyglobby` [options](https://github.com/SuperchupuDev/tinyglobby/blob/main/README.md#options)
  - `watch`: If explicitly set to `false`, the globs won't be watched when watch mode is active

### `fs.stat(path)`

Retrieve the `fs.Stats` object for a path. Unlike `fs.lstat`, symbolic links are followed beforehand. The `path` may be absolute or relative to the `root` directory.

The path is watched as if you called `fs.read(path)`. This is necessary because the `fs.Stats` object contains information about the file's size. You may prefer `exists()` instead if you don't need the size information.

If the path does not exist, `null` is returned.

### `fs.symlinkExists(path)`

Check if a symbolic link exists. The `path` may be absolute or relative to the `root` directory. The path is watched for `add` and `unlink` events.

### `fs.tryRead(path)`

Same as `fs.read`, but returns `null` if the file does not exist. This is more efficient than calling `fs.exists()` and `fs.read()` in succession.

### `fs.watch(path, options?)`

Watch one or more paths like `fs.read` does, but without loading them into memory. Each `path` may be absolute or relative to the `root` directory. Globs are not supported by this method.

The `options` argument may be an object that may include:

- `cause`: One or more files to blame for this call. Also known as associative watching, this is useful when third party code is accessing files in a way you can't control. Learn more in the [Blamed Files](../advanced.md#blamed-files) section.

### `fs.write(path, content)`

Write content to a file. The `path` may be absolute or relative to the `root` directory.

This emits a `write` event with the generator's event emitter.
