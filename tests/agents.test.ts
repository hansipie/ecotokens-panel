import { expect, test } from 'claude-code/testing'

import {
  costLabel,
  delegationLine,
  durationLabel,
  elapsedLabel,
  mergeListed,
  pruneEnded,
  reconcileTasks,
  recordSpawn,
  recordTaskStart,
  recordTaskStop,
  recordToolUse,
  recordTurn,
  runCost,
  shortModel,
  taskElapsedLabel,
  taskFromCall,
} from '../hooks/agents'

const SPAWN = { description: 'Explore the repo', subagentType: 'Explore', background: true, name: 'scout' }

test('a spawn opens a running row with its model and start time', () => {
  const rows = recordSpawn([], SPAWN, { agentId: 'a1', model: 'claude-haiku-4-5' }, 1_000)
  expect(rows).toEqual([
    {
      id: 'a1', name: 'scout', type: 'Explore', description: 'Explore the repo', status: 'running', isTeammate: false,
      isBackground: true, parentId: undefined, model: 'claude-haiku-4-5', startedAt: 1_000, endedAt: undefined,
      outcome: undefined, toolUses: 0, inputTokens: 0, outputTokens: 0, isListed: false,
    },
  ])
})

test('the list is the authority on what it names, and a dropped agent keeps how its run ended', () => {
  let rows = recordSpawn([], SPAWN, { agentId: 'a1' }, 1_000)
  rows = mergeListed(rows, [{ id: 'a1', description: 'Explore the repo', type: 'Explore', status: 'running', name: 'scout' }], 2_000)
  expect(rows[0]?.isListed).toBe(true)
  rows = recordTurn(rows, { agentId: 'a1', reason: 'error', durationMs: 5_000, usage: undefined }, 6_000)
  // Dropped by the engine: its row stays, ended as its last run did.
  rows = mergeListed(rows, [], 9_000)
  expect(rows[0]).toEqual(expect.objectContaining({ status: 'failed', isListed: false, endedAt: 6_000 }))
})

test('an agent started before the plugin loaded has no elapsed time', () => {
  const rows = mergeListed([], [{ id: 'b', description: 'old', type: 'general-purpose', status: 'running' }], 5_000)
  expect(rows[0]?.startedAt).toBeUndefined()
  expect(elapsedLabel(rows[0]!, 9_000)).toBe('')
})

test('tool calls and runs add up on the agent they belong to, and an unknown id changes nothing', () => {
  let rows = recordSpawn([], SPAWN, { agentId: 'a1' }, 0)
  rows = recordToolUse(rows, 'a1', 'Read')
  rows = recordToolUse(rows, 'a1', 'Grep')
  rows = recordToolUse(rows, 'fork', 'Read')
  const usage = { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 990, model: 'claude-haiku-4-5-20251001' }
  rows = recordTurn(rows, { agentId: 'a1', reason: 'answer', durationMs: 65_000, usage }, 65_000)
  rows = recordTurn(rows, { agentId: 'fork', reason: 'answer', durationMs: 1, usage }, 65_000)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toEqual(
    expect.objectContaining({ toolUses: 2, lastTool: 'Grep', inputTokens: 10_000, outputTokens: 500, outcome: 'completed', model: 'claude-haiku-4-5-20251001' }),
  )
})

test('running agents come first, then the newest', () => {
  let rows = recordSpawn([], { ...SPAWN, name: 'old' }, { agentId: 'a' }, 1)
  rows = recordSpawn(rows, { ...SPAWN, name: 'new' }, { agentId: 'b' }, 2)
  rows = mergeListed(rows, [
    { id: 'a', description: '', type: 'Explore', status: 'running' },
    { id: 'b', description: '', type: 'Explore', status: 'completed' },
  ], 3)
  expect(rows.map(r => r.id)).toEqual(['a', 'b'])
})

test('times read in seconds, minutes, then hours', () => {
  expect(durationLabel(4_400)).toBe('4 s')
  expect(durationLabel(65_000)).toBe('1 min 05 s')
  expect(durationLabel(3_725_000)).toBe('1 h 02 min')
  const rows = recordSpawn([], SPAWN, { agentId: 'a1' }, 1_000)
  expect(elapsedLabel(rows[0]!, 31_000)).toBe('depuis 30 s')
  expect(shortModel('claude-opus-5-5')).toBe('opus-5-5')
})

test('a background Bash or a Monitor starts a task; a foreground Bash or another tool starts none', () => {
  expect(taskFromCall('Bash', { command: 'npm run dev', description: 'Dev server' }, { stdout: '', backgroundTaskId: 'b1' }, 7, 'a1')).toEqual({
    id: 'b1', kind: 'shell', description: 'Dev server', command: 'npm run dev', status: 'running', agentId: 'a1', startedAt: 7,
  })
  expect(taskFromCall('Monitor', { description: 'Socket', ws: { url: 'wss://x' } }, { taskId: 'm1', timeoutMs: 0 }, 7)).toEqual(
    expect.objectContaining({ id: 'm1', kind: 'monitor', command: 'wss://x' }),
  )
  expect(taskFromCall('Bash', { command: 'ls' }, { stdout: 'a' }, 7)).toBeUndefined()
  expect(taskFromCall('Read', { file_path: '/x' }, { taskId: 'nope' }, 7)).toBeUndefined()
})

test('the Stop list adds tasks, leaves subagents out, and ends the ones it no longer names', () => {
  let tasks = recordTaskStart([], taskFromCall('Bash', { command: 'sleep 99' }, { backgroundTaskId: 'b1' }, 0)!)
  tasks = reconcileTasks(tasks, [
    { id: 'b1', type: 'shell', status: 'running', description: 'sleep', command: 'sleep 99' },
    { id: 'w1', type: 'workflow', status: 'pending', description: '', name: 'nightly' },
    { id: 's1', type: 'subagent', status: 'running', description: 'x' },
    { id: 'a9', type: 'local_agent', status: 'running', description: 'y' },
  ], new Set(['a9']), 1_000)
  expect(tasks.map(t => `${t.id}:${t.status}`)).toEqual(['b1:running', 'w1:pending'])
  expect(tasks.find(t => t.id === 'w1')?.description).toBe('nightly')
  tasks = reconcileTasks(tasks, [], new Set(), 5_000)
  expect(tasks.find(t => t.id === 'b1')).toEqual(expect.objectContaining({ status: 'ended', endedAt: 5_000, isEndApprox: true }))
  expect(taskElapsedLabel(tasks.find(t => t.id === 'b1')!, 9_000)).toBe('≤ 5 s')
  // Never seen starting: no time.
  expect(taskElapsedLabel(tasks.find(t => t.id === 'w1')!, 9_000)).toBe('')
})

test('TaskStop stops a running task only', () => {
  const tasks = recordTaskStart([], taskFromCall('Monitor', { description: 'm' }, { taskId: 'm1' }, 0)!)
  const stopped = recordTaskStop(tasks, 'm1', 3_000)
  expect(stopped[0]).toEqual(expect.objectContaining({ status: 'killed', endedAt: 3_000 }))
  expect(recordTaskStop(stopped, 'm1', 9_000)[0]?.endedAt).toBe(3_000)
  expect(taskElapsedLabel(stopped[0]!, 9_000)).toBe('3 s')
})

test('an ended agent or task leaves five minutes after it ended, a running or listed one stays', () => {
  const listed = mergeListed(recordSpawn([], SPAWN, { agentId: 'a1' }, 1_000), [{ id: 'a1', description: '', type: 'Explore', status: 'running' }], 1_500)
  const ended = recordTurn(listed, { agentId: 'a1', reason: 'answer', durationMs: 1_000, usage: undefined }, 2_000)
  // Dropped by the engine: completed, ended at 2 000.
  const dropped = mergeListed(ended, [], 3_000)
  const running = recordSpawn([], { ...SPAWN, name: 'busy' }, { agentId: 'a2' }, 1_000)
  const listedEnded = mergeListed(recordSpawn([], SPAWN, { agentId: 'a3' }, 1_000), [{ id: 'a3', description: '', type: 'Explore', status: 'completed' }], 2_000)
  const shell = taskFromCall('Bash', { command: 'sleep 1' }, { backgroundTaskId: 't1' }, 1_000)!
  const stopped = recordTaskStop([shell], 't1', 2_000)
  const live = taskFromCall('Bash', { command: 'sleep 999' }, { backgroundTaskId: 't2' }, 1_000)!
  const s = { rows: [...dropped, ...running, ...listedEnded], tasks: [...stopped, live] }

  expect(pruneEnded(s, 2_000 + 5 * 60_000)).toEqual(s)
  const later = pruneEnded(s, 2_001 + 5 * 60_000)
  expect(later.rows.map(r => r.id)).toEqual(['a2', 'a3'])
  expect(later.tasks.map(t => t.id)).toEqual(['t2'])
})

const SONNET = { input_tokens: 1_000, output_tokens: 2_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 10_000, model: 'claude-sonnet-5-5' }

test('a run is priced per family, cache read and write apart, and an unknown model has no price', () => {
  // 1k x 2 + 2k x 10 + 30k x 0.2 + 10k x 2.5 = 2000 + 20000 + 6000 + 25000 per million
  expect(Math.round((runCost(SONNET))! * 1e6) / 1e6).toBe(0.053)
  expect(Math.round((runCost({ ...SONNET, model: 'claude-haiku-4-5-20251001' }))! * 1e6) / 1e6).toBe(0.0265)
  expect(runCost({ ...SONNET, model: 'gpt-x' })).toBeUndefined()
  expect(runCost({ ...SONNET, model: undefined })).toBeUndefined()
  expect(costLabel(0.153)).toBe('≈ $0.15')
  expect(costLabel(0.001)).toBe('< $0.01')
})

test('an agent row adds up its runs cost, and one unpriced run hides the total', () => {
  let rows = recordSpawn([], SPAWN, { agentId: 'a1' }, 0)
  rows = recordTurn(rows, { agentId: 'a1', reason: 'answer', durationMs: 1, usage: SONNET }, 1)
  rows = recordTurn(rows, { agentId: 'a1', reason: 'answer', durationMs: 1, usage: SONNET }, 2)
  expect(Math.round((rows[0]?.costUsd)! * 1e6) / 1e6).toBe(0.106)
  rows = recordTurn(rows, { agentId: 'a1', reason: 'answer', durationMs: 1, usage: { ...SONNET, model: 'gpt-x' } }, 3)
  expect(rows[0]).toEqual(expect.objectContaining({ costUsd: undefined, isCostUnknown: true }))
  rows = recordTurn(rows, { agentId: 'a1', reason: 'answer', durationMs: 1, usage: SONNET }, 4)
  expect(rows[0]?.costUsd).toBeUndefined()
})

test('only a router-* run writes a delegation line, with its cost when it can be priced', () => {
  expect(delegationLine('router-everyday', SONNET)).toBe('délégation · router-everyday (sonnet-5-5) · 41.0k → 2.0k tokens · ≈ $0.05')
  expect(delegationLine('router-tiny', { ...SONNET, model: 'mystery-1' })).toBe('délégation · router-tiny (mystery-1) · 41.0k → 2.0k tokens')
  expect(delegationLine('Explore', SONNET)).toBeUndefined()
  expect(delegationLine('router-large', undefined)).toBeUndefined()
})
