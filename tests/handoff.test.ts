import { expect, test } from 'claude-code/testing'

import { handoffToggle, oneLine, parseHandoff, parseHandoffList } from '../hooks/handoff'

test('the status JSON becomes the panel state', () => {
  const json = JSON.stringify({ enabled: true, hook_installed: true, skills_installed: false, pending: 1, consumed: 2, stale_hours: 24, max_chars: 4000, retention_days: 30, inject_startup: false, injections: { count: 3 } })
  expect(parseHandoff(json, 7)).toEqual({ enabled: true, hookInstalled: true, skillsInstalled: false, pending: 1, consumed: 2, staleHours: 24, maxChars: 4000, retentionDays: 30, injectStartup: false, injections: 3, entries: [], measuredAt: 7 })
  expect(() => parseHandoff('[]', 7)).toThrow()
})

test('the controls run ecotokens handoff', () => {
  expect(handoffToggle(true)).toEqual(['ecotokens', 'handoff', 'on'])
  expect(handoffToggle(false)).toEqual(['ecotokens', 'handoff', 'off'])
})

test('the handoff list keeps this directory\'s rows, one line each', () => {
  const rows = JSON.stringify([
    { id: 'aaaaaaaa-1', age_hours: 3, status: 'pending', stale: false, cwd: '/p', objective: 'Une\nligne   longue' },
    { id: 'bbbbbbbb-2', age_hours: 50, status: 'consumed', stale: true, cwd: '/other', objective: 'x' },
    { age_hours: 1 },
  ])
  expect(parseHandoffList(rows, '/p')).toEqual([{ id: 'aaaaaaaa-1', ageHours: 3, status: 'pending', stale: false, objective: 'Une ligne longue' }])
  expect(parseHandoffList(rows)).toHaveLength(2)
  expect(parseHandoffList('[]', '/p')).toEqual([])
  expect(() => parseHandoffList('{}')).toThrow()
  expect(oneLine('a'.repeat(100), 10)).toBe('aaaaaaaaa…')
})
