export function memoLastCall<Args extends any[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  let lastArgs: Args | null = null
  let lastResult: Result | null = null

  return (...args: Args): Result => {
    // Check if we have cached args and if they match current args
    if (
      lastArgs &&
      lastArgs.length === args.length &&
      lastArgs.every((arg, i) => Object.is(arg, args[i]))
    ) {
      return lastResult!
    }

    // If no match, calculate new result and cache it
    const result = fn(...args)
    lastArgs = args
    lastResult = result
    return result
  }
}
