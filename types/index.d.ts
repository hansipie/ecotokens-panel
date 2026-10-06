export type TabId = 'session' | 'context' | 'eco' | 'gain' | 'watch'

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

declare module 'claude-code' {
  interface PluginState {
    'ecotokens-panel': {
      tab: TabId
      usage: UsageSnapshot | null
      context: ContextDetail | null
      eco: EcoLog | null
      handoff: HandoffState | null
      watch: WatchState | null
      gainPeriod: GainPeriod
      gain: GainState | null
    }
  }
}
