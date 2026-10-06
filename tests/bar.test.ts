import { expect, test } from 'claude-code/testing'

import { cells, gradient } from '../hooks/bar'

test('the gradient runs green, yellow, red', () => {
  expect(gradient(0)).toBe('#22c55e')
  expect(gradient(0.5)).toBe('#eab308')
  expect(gradient(1)).toBe('#ef4444')
  expect(gradient(2)).toBe('#ef4444')
})

test('a bar fills from the left, each cell coloured by its place', () => {
  const bar = cells(50, 10)
  expect(bar.filter(c => c.isFilled)).toHaveLength(5)
  expect(bar[0]?.color).toBe('#22c55e')
  expect(bar[9]?.color).toBe('#ef4444')
})
