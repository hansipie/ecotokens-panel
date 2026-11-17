import { expect, test } from 'claude-code/testing'
import { configureLocale } from '../hooks/i18n'

configureLocale({ ECOTOKENS_PANEL_LANG: 'fr' })

import { parseLogTail, parseWatch, tailLogContents, watchStart, watchStop } from '../hooks/watch'

test('the status JSON splits this directory from the others', () => {
  const json = JSON.stringify({
    '/p': { sessions: 2, watcher_pid: 10, log_file: '/l/p.log', started_at: '2026-10-06T10:24:13.6+00:00' },
    '/q': { sessions: 1, watcher_pid: 11, log_file: '/l/q.log', started_at: 'x' },
    '/r': { sessions: 1, watcher_pid: null },
  })
  const s = parseWatch(json, true, '/p', 7)
  expect(s.current).toEqual({ path: '/p', pid: 10, sessions: 2, logFile: '/l/p.log', startedAt: '2026-10-06T10:24:13.6+00:00' })
  expect(s.others.map(o => o.path)).toEqual(['/q'])
  expect(s.measuredAt).toBe(7)
})

test('a failed status means nothing runs', () => {
  const s = parseWatch('', false, '/p', 7)
  expect(s.current).toBeUndefined()
  expect(s.others).toEqual([])
  expect(() => parseWatch('[]', true, '/p', 7)).toThrow()
})

test('the controls always name the directory', () => {
  expect(watchStart('/p')).toEqual(['ecotokens', 'watch', '--background', '--path', '/p'])
  expect(watchStop('/p')).toEqual(['ecotokens', 'watch', '--stop', '--path', '/p'])
})

test('the log tail can be prepared from the plugin file API on every OS', () => {
  expect(tailLogContents('one\ntwo\nthree\n', 2)).toBe('two\nthree')
  expect(tailLogContents('')).toBe('')
})

test('the log keeps the time of each line', () => {
  expect(parseLogTail('[2026-10-06 10:20:48] /p/a.ts re-indexed\n\n')).toEqual(['10:20:48 /p/a.ts re-indexed'])
})
