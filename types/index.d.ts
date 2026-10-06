export type TabId = 'session' | 'context' | 'eco' | 'gain' | 'watch' | 'agents'

export type RateWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type UsageSnapshot = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  rateLimits: RateWindow[]
  costUsd?: number
  measuredAt: number
}

export type ContextRow = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type ContextSquare = {
  color: string
  isFilled: boolean
  fullness: number
}

export type ContextDetail = {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  isAutoCompactEnabled: boolean
  autoCompactThreshold?: number
  categories: ContextRow[]
  grid: ContextSquare[][]
  memoryFiles: { path: string; type: string; tokens: number }[]
  mcpServers: { server: string; tools: number; loaded: number; tokens: number }[]
  skills?: { total: number; included: number; tokens: number }
  agents: { count: number; tokens: number }
  api: { input: number; cacheRead: number; cacheWrite: number; output: number } | null
  measuredAt: number
}

export type EcoSaving = {
  at: string
  command: string
  family: string
  before: number
  after: number
  pct: number
  mode: string
  // What the saving was on ("Lecture de fichier : register.tsx") and how it was made.
  what: string
  how: string
}

export type EcoJevCall = {
  at: string
  purpose: string
  agent?: string
  ok: boolean
  error?: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
  // What Jev was asked ("Routage du message") and what came of it.
  title: string
  what: string
}

// What ecotokens saved on one tool call, drawn under its result in the transcript.
export type EcoMark = {
  before: number
  after: number
  mode: string
}

// A tool call seen finishing, waiting for the row ecotokens wrote for it (ecotokens keeps no tool_use_id:
// the call and the row meet by command text and by the clock).
export type EcoCall = {
  id: string
  key: string
  startedAt: number
  endedAt: number
}

export type EcoTrack = {
  calls: EcoCall[]
  // The rows already given to a call, so that two identical commands do not take the same one.
  claimed: string[]
}

export type HandoffEntry = {
  id: string
  ageHours: number
  status: string
  stale: boolean
  // One line, already cut.
  objective: string
}

export type GainPeriod = 'today' | 'week' | 'month' | 'all'

export type GainRow = {
  name: string
  count: number
  before: number
  after: number
}

export type GainReport = {
  interceptions: number
  before: number
  after: number
  savingsPct: number
  costAvoidedUsd: number
  families: GainRow[]
}

export type JevPurpose = {
  name: string
  calls: number
  ok: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
}

export type JevReport = {
  calls: number
  ok: number
  fallbacks: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  avgLatencyMs: number
  p95LatencyMs: number
  purposes: JevPurpose[]
  errors: { kind: string; count: number }[]
  timeline: number[]
}

// Each report is read on its own: one failing leaves the other shown, with its error.
export type GainState = {
  period: GainPeriod
  project: string
  gain?: GainReport
  gainError?: string
  jev?: JevReport
  jevError?: string
  measuredAt: number
}

export type WatchEntry = {
  path: string
  pid?: number
  sessions: number
  logFile?: string
  startedAt?: string
}

export type WatchState = {
  cwd: string
  current?: WatchEntry
  others: WatchEntry[]
  log: string[]
  measuredAt: number
}

export type HandoffState = {
  enabled: boolean
  hookInstalled: boolean
  skillsInstalled: boolean
  // Handoffs saved for this directory: waiting to be loaded, and already loaded.
  pending: number
  consumed: number
  staleHours: number
  maxChars: number
  retentionDays: number
  injectStartup: boolean
  injections: number
  // The saved handoffs of the session's directory.
  entries: HandoffEntry[]
  measuredAt: number
}

export type EcoLog = {
  savings: EcoSaving[]
  jev: EcoJevCall[]
  totalSaved: number
  totalFiltered: number
  error?: string
  measuredAt: number
}

// Where an agent's loop stands, as `$.agent.list()` says (the engine's AgentStatus).
export type AgentRunStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

// One subagent or teammate of the session: what `$.agent.list()` says of it, joined with what
// its spawn, its tool calls and its runs' ends told the plugin.
export type AgentRow = {
  id: string
  // What SendMessage addresses it by; a teammate's name in its team.
  name?: string
  type: string
  description: string
  status: AgentRunStatus
  isTeammate: boolean
  isBackground?: boolean
  parentId?: string
  // The model it was started on, then the one that answered its last run.
  model?: string
  // When the plugin saw it start and its last run end; absent for one started before the plugin loaded.
  startedAt?: number
  endedAt?: number
  // Its last run's length, and how that run ended (kept for when the list no longer names it).
  durationMs?: number
  outcome?: 'completed' | 'failed' | 'killed'
  // Tool calls of its own loop, and the last one's name.
  toolUses: number
  lastTool?: string
  // Tokens of its finished runs: input (cache included) and output.
  inputTokens: number
  outputTokens: number
  // What its finished runs cost in USD (approximate: a built-in price table); absent before a run, and
  // when a run's model could not be priced (`isCostUnknown`).
  costUsd?: number
  isCostUnknown?: boolean
  // True while `$.agent.list()` names it.
  isListed: boolean
}

// Where a background task stands: `ended` when the engine stopped listing it in flight
// (how it ended is not told), `killed` when TaskStop stopped it.
export type TaskRunStatus = 'pending' | 'running' | 'ended' | 'killed'

// One background task of the session that is no agent: a shell, a monitor, a workflow, a remote agent.
export type TaskRow = {
  id: string
  // The engine's task type: `shell`, `monitor`, `workflow`, `remote_agent`, ...
  kind: string
  description: string
  // A shell's or a monitor's command (a monitor's socket address).
  command?: string
  status: TaskRunStatus
  // The agent whose loop started it; absent for the main conversation.
  agentId?: string
  // When the plugin saw it start and end; absent for one it did not see start.
  startedAt?: number
  endedAt?: number
  // True when the end is when a Stop event noticed it, not when it happened.
  isEndApprox?: boolean
}

export type AgentsState = {
  rows: AgentRow[]
  // Absent in a state saved before the tab followed background tasks.
  tasks?: TaskRow[]
  error?: string
  measuredAt: number
}

// Effort levels of /effort: the fallback list, when the /config rows give none.
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'ecotokens-panel': {
      tab: TabId
      usage: UsageSnapshot | null
      context: ContextDetail | null
      eco: EcoLog | null
      ecoMark: StateFamily<EcoMark | null>
      ecoTrack: EcoTrack
      ecoSeen: number
      handoff: HandoffState | null
      watch: WatchState | null
      gainPeriod: GainPeriod
      gain: GainState | null
      model: string | null
      effort: EffortLevel | null
      effortOptions: string[] | null
      agents: AgentsState | null
    }
  }
}
