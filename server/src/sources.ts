import { resolve, sep } from 'node:path'

/**
 * Overlapping sources are rejected so every photo belongs to exactly one source.
 * Returns the first existing path that equals, contains, or is contained by the
 * candidate (separator-boundary aware), or null when there is no conflict.
 */
export function findNestingConflict(existingPaths: string[], candidate: string): string | null {
  const cand = resolve(candidate)
  for (const existing of existingPaths) {
    const ex = resolve(existing)
    if (ex === cand || cand.startsWith(ex + sep) || ex.startsWith(cand + sep)) return existing
  }
  return null
}
