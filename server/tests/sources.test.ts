import { describe, expect, it } from 'vitest'
import { findNestingConflict } from '../src/sources.js'

describe('findNestingConflict', () => {
  it('accepts unrelated and sibling paths', () => {
    expect(findNestingConflict(['/photos/trips'], '/photos/family')).toBeNull()
    expect(findNestingConflict([], '/anything')).toBeNull()
  })
  it('rejects an identical path', () => {
    expect(findNestingConflict(['/photos'], '/photos')).toBe('/photos')
  })
  it('rejects a candidate inside an existing source', () => {
    expect(findNestingConflict(['/photos'], '/photos/trips')).toBe('/photos')
  })
  it('rejects a candidate containing an existing source', () => {
    expect(findNestingConflict(['/photos/trips'], '/photos')).toBe('/photos/trips')
  })
  it('does not treat a common string prefix as nesting', () => {
    expect(findNestingConflict(['/a/b'], '/a/bc')).toBeNull()
    expect(findNestingConflict(['/a/bc'], '/a/b')).toBeNull()
  })
  it('normalizes trailing slashes and dots via resolve', () => {
    expect(findNestingConflict(['/photos'], '/photos/trips/../trips/')).toBe('/photos')
  })
})
