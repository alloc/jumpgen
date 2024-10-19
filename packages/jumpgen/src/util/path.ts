import path from 'node:path'

/**
 * Remove a trailing slash from a path.
 *
 * Note: This assumes a normalized path.
 */
export function stripTrailingSlash(p: string) {
  return p.endsWith(path.sep) ? p.slice(0, -1) : p
}
