import type { AgentInfo, AgentSpawnInput, TurnCompleteInput } from 'claude-code'

import { kTokens } from './eco'
import type { AgentRow, AgentRunStatus, TaskRow, TaskRunStatus } from '../types'

// What the Agents tab keeps: the newest rows, the running ones first.
const MAX_ROWS = 30

export const AGENT_STATUS: Record<AgentRunStatus, { glyph: string; label: string; color?: string }> = {
  pending: { glyph: '◌', label: 'pas démarré' },
  running: { glyph: '●', label: 'en cours', color: 'claude' },
  waiting: { glyph: '◌', label: 'en attente', color: 'warning' },
  idle: { glyph: '○', label: 'inactif' },
  completed: { glyph: '✓', label: 'terminé', color: 'success' },
  failed: { glyph: '✗', label: 'échoué', color: 'error' },
  killed: { glyph: '■', label: 'arrêté', color: 'warning' },
}

export function isActive(status: AgentRunStatus) {
  return status === 'pending' || status === 'running' || status === 'waiting'
}

const isEnded = (status: AgentRunStatus) => status === 'completed' || status === 'failed' || status === 'killed'

function emptyRow(id: string): AgentRow {
  return { id, type: 'agent', description: '', status: 'pending', isTeammate: false, toolUses: 0, inputTokens: 0, outputTokens: 0, isListed: false }
}

function sorted(rows: AgentRow[]) {
  return [...rows]
    .sort((x, y) => Number(isActive(y.status)) - Number(isActive(x.status)) || (y.startedAt ?? 0) - (x.startedAt ?? 0))
    .slice(0, MAX_ROWS)
}

// `$.agent.list()` is the authority on what it names. An agent it no longer names (the engine drops a
// task some seconds after it ends) keeps its row, with how its last run ended when that was seen.
export function mergeListed(rows: AgentRow[], listed: AgentInfo[], now: number): AgentRow[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const a of listed) {
    // One started before the plugin loaded has no start time: its elapsed time stays blank.
    const r = byId.get(a.id) ?? emptyRow(a.id)
    byId.set(a.id, {
      ...r,
      name: a.name ?? r.name,
      type: a.type,
      description: a.description,
      status: a.status,
      isTeammate: a.teammateId !== undefined || r.isTeammate,
      parentId: a.parentId,
      isListed: true,
      endedAt: isEnded(a.status) ? (r.endedAt ?? now) : isActive(a.status) ? undefined : r.endedAt,
    })
  }
  const named = new Set(listed.map(a => a.id))
  for (const r of byId.values()) {
    if (named.has(r.id) || !r.isListed) continue
    const status = isEnded(r.status) ? r.status : (r.outcome ?? r.status)
    byId.set(r.id, { ...r, status, isListed: false, endedAt: r.endedAt ?? (isEnded(status) ? now : undefined) })
  }

  return sorted([...byId.values()])
}

// The spawn answered with the agent's id and the model it resolved to.
export function recordSpawn(
  rows: AgentRow[],
  e: Pick<AgentSpawnInput, 'description' | 'subagentType' | 'background' | 'isTeammate' | 'name' | 'parentAgentId'>,
  started: { agentId: string; model?: string },
  now: number,
): AgentRow[] {
  const r = rows.find(x => x.id === started.agentId) ?? emptyRow(started.agentId)
  const row: AgentRow = {
    ...r,
    name: e.name ?? r.name,
    type: e.subagentType,
    description: e.description,
    status: isEnded(r.status) || r.status === 'pending' ? 'running' : r.status,
    isTeammate: e.isTeammate === true,
    isBackground: e.background,
    parentId: e.parentAgentId,
    model: started.model ?? r.model,
    startedAt: now,
    endedAt: undefined,
    outcome: undefined,
  }

  return sorted([row, ...rows.filter(x => x.id !== row.id)])
}

// A tool call of the agent's own loop. An id no row holds (a workflow's agent, an engine fork) is left out.
export function recordToolUse(rows: AgentRow[], agentId: string, tool: string): AgentRow[] {
  return rows.map(r => (r.id === agentId ? { ...r, toolUses: r.toolUses + 1, lastTool: tool } : r))
}

// USD per million tokens by model family: input, output, cache read, cache write (5-minute). The engine
// gives no cost per run and no price list, so these are the list prices of the current models as the
// Claude API reference gives them (2026-09): approximate, to be kept up to date by hand.
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  fable: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
}

type RunUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

// What one run cost, in USD; undefined for a model of a family the table does not know.
export function runCost(usage: RunUsage | undefined): number | undefined {
  const family = Object.keys(PRICES).find(f => usage?.model?.includes(f))
  const price = family ? PRICES[family] : undefined
  if (!usage || !price) return undefined

  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      usage.cache_read_input_tokens * price.cacheRead +
      usage.cache_creation_input_tokens * price.cacheWrite) /
    1_000_000
  )
}

export function costLabel(usd: number) {
  return usd < 0.005 ? '< $0.01' : `≈ $${usd.toFixed(2)}`
}

// The line under a delegated run (a `router-*` subagent) that ended; undefined for any other agent.
export function delegationLine(type: string, usage: RunUsage | undefined) {
  if (!type.startsWith('router-') || !usage) return undefined
  const cost = runCost(usage)
  const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

  return [
    'délégation',
    `${type}${usage.model ? ` (${shortModel(usage.model)})` : ''}`,
    `${kTokens(input)} → ${kTokens(usage.output_tokens)} tokens`,
    cost === undefined ? '' : costLabel(cost),
  ]
    .filter(Boolean)
    .join(' · ')
}

// A run's cost adds up on the row; one that cannot be priced leaves the whole total unknown.
function runCostFields(r: AgentRow, u: RunUsage | undefined) {
  if (!u) return {}
  const cost = runCost(u)
  if (cost === undefined || r.isCostUnknown) return { costUsd: undefined, isCostUnknown: true }

  return { costUsd: (r.costUsd ?? 0) + cost }
}

// One run of the agent's loop ended: what it cost, how long it ran and how it ended.
export function recordTurn(
  rows: AgentRow[],
  e: Pick<TurnCompleteInput, 'reason' | 'durationMs' | 'usage'> & { agentId: string },
  now: number,
): AgentRow[] {
  const u = e.usage
  const outcome = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'

  return rows.map(r =>
    r.id === e.agentId
      ? {
          ...r,
          model: u?.model ?? r.model,
          inputTokens: r.inputTokens + (u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0),
          outputTokens: r.outputTokens + (u?.output_tokens ?? 0),
          ...runCostFields(r, u),
          durationMs: e.durationMs,
          endedAt: now,
          outcome: r.isTeammate ? undefined : outcome,
        }
      : r,
  )
}

export function durationLabel(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`

  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// While it runs: the time since it started. Once it ended: its last run's length.
export function elapsedLabel(r: AgentRow, now: number) {
  if (isActive(r.status)) return r.startedAt === undefined ? '' : `depuis ${durationLabel(now - r.startedAt)}`
  if (r.durationMs !== undefined) return durationLabel(r.durationMs)

  return r.startedAt !== undefined && r.endedAt !== undefined ? durationLabel(r.endedAt - r.startedAt) : ''
}

// `claude-opus-5-5` reads `opus-5-5`: the pane is narrow.
export function shortModel(model: string) {
  return model.replace(/^claude-/, '')
}

// Background tasks: shells, monitors, workflows, remote agents. The engine lists none on `$`: a task is
// seen starting in its tool's result (Bash's `backgroundTaskId`, Monitor's `taskId`), stopped by
// TaskStop, and the classic Stop events carry what is still in flight, so a task missing there has ended.

export const TASK_STATUS: Record<TaskRunStatus, { glyph: string; label: string; color?: string }> = {
  pending: { glyph: '◌', label: 'pas démarré' },
  running: { glyph: '●', label: 'en cours', color: 'claude' },
  ended: { glyph: '◇', label: 'terminé' },
  killed: { glyph: '■', label: 'arrêté', color: 'warning' },
}

const TASK_KINDS: Record<string, string> = {
  shell: 'Shell',
  monitor: 'Monitor',
  workflow: 'Workflow',
  remote_agent: 'Agent distant',
}

export function taskKindLabel(kind: string) {
  return TASK_KINDS[kind] ?? kind
}

export const isTaskActive = (status: TaskRunStatus) => status === 'pending' || status === 'running'

function sortedTasks(tasks: TaskRow[]) {
  return [...tasks]
    .sort((x, y) => Number(isTaskActive(y.status)) - Number(isTaskActive(x.status)) || (y.startedAt ?? 0) - (x.startedAt ?? 0))
    .slice(0, MAX_ROWS)
}

const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

// A finished tool call that started a background task: Bash run in the background (asked, ctrl+b or
// past its timeout) answers `backgroundTaskId`, Monitor answers `taskId`. Anything else starts none.
export function taskFromCall(tool: string, input: Record<string, unknown>, result: unknown, now: number, agentId?: string): TaskRow | undefined {
  const r = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>
  const id = tool === 'Bash' ? text(r.backgroundTaskId) : tool === 'Monitor' ? text(r.taskId) : undefined
  if (!id) return undefined
  const ws = input.ws as { url?: unknown } | undefined

  return {
    id,
    kind: tool === 'Bash' ? 'shell' : 'monitor',
    description: text(input.description) ?? '',
    command: text(input.command) ?? text(ws?.url),
    status: 'running',
    agentId,
    startedAt: now,
  }
}

export function recordTaskStart(tasks: TaskRow[], task: TaskRow): TaskRow[] {
  return sortedTasks([task, ...tasks.filter(t => t.id !== task.id)])
}

// TaskStop names the task it stopped (`task_id`), an agent's id included: only a task row changes.
export function recordTaskStop(tasks: TaskRow[], id: string, now: number): TaskRow[] {
  return tasks.map(t => (t.id === id && isTaskActive(t.status) ? { ...t, status: 'killed', endedAt: now } : t))
}

export type InFlightTask = { id: string; type: string; status: string; description: string; command?: string; name?: string }

// What a Stop event says is in flight. Subagents are left to the agents' list. A task it no longer names
// has ended: when is only known to the Stop that noticed it, hence `isEndApprox`.
export function reconcileTasks(tasks: TaskRow[], inFlight: InFlightTask[], agentIds: Set<string>, now: number): TaskRow[] {
  const listed = inFlight.filter(b => b.type !== 'subagent' && b.type !== 'teammate' && !agentIds.has(b.id))
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const b of listed) {
    const t = byId.get(b.id)
    byId.set(b.id, {
      ...(t ?? { id: b.id }),
      kind: b.type,
      description: b.description || t?.description || b.name || '',
      command: b.command ?? t?.command,
      status: b.status === 'pending' ? 'pending' : 'running',
    } as TaskRow)
  }
  const named = new Set(listed.map(b => b.id))
  for (const t of byId.values()) {
    if (named.has(t.id) || !isTaskActive(t.status)) continue
    byId.set(t.id, { ...t, status: 'ended', endedAt: now, isEndApprox: true })
  }

  return sortedTasks([...byId.values()])
}

// An ended agent or task leaves the tab this long after it ended. An agent the list still names stays:
// the engine drops it some seconds after it ends, and it would come back on the next read.
export const KEEP_ENDED_MS = 5 * 60_000

export function pruneEnded(s: { rows: AgentRow[]; tasks: TaskRow[] }, now: number) {
  const isOld = (endedAt: number | undefined) => endedAt !== undefined && now - endedAt > KEEP_ENDED_MS

  return {
    rows: s.rows.filter(r => !(isEnded(r.status) && !r.isListed && isOld(r.endedAt))),
    tasks: s.tasks.filter(t => !(!isTaskActive(t.status) && isOld(t.endedAt))),
  }
}

export function taskElapsedLabel(t: TaskRow, now: number) {
  if (t.startedAt === undefined) return ''
  if (isTaskActive(t.status)) return `depuis ${durationLabel(now - t.startedAt)}`
  if (t.endedAt === undefined) return ''

  return `${t.isEndApprox ? '≤ ' : ''}${durationLabel(t.endedAt - t.startedAt)}`
}
