import type { EcoCall, EcoJevCall, EcoLog, EcoMark, EcoSaving, EcoTrack } from '../types'

// ecotokens keeps no session id: "this session" is every row since it started.
// Savings are also held to the session's project (their git_root); Jev calls carry none.

function quote(text: string) {
  return `'${text.replaceAll("'", "''")}'`
}

// What one query ran to: the command's argv, and later its JSON rows.
export type EcoQuery = { argv: string[] }

export type EcoQueries = { savings: EcoQuery; totals: EcoQuery; jev: EcoQuery }

// ecotokens writes while the panel reads: a busy database is waited for (2 s) instead of failing at once.
function sqlite(db: string, sql: string): EcoQuery {
  return { argv: ['sqlite3', '-readonly', '-json', '-cmd', '.timeout 2000', db, sql] }
}

// `sqlite3 -json` prints nothing at all for an empty result.
export function parseRows<T>(stdout: string): T[] {
  const out = stdout.trim()

  return out === '' ? [] : (JSON.parse(out) as T[])
}

const FAMILIES: Record<string, string> = {
  git: 'git',
  gh: 'GitHub CLI',
  cargo: 'Cargo',
  grep: 'recherche',
  fs: 'fichiers',
  python: 'Python',
  js: 'JS / npm',
  network: 'réseau',
  generic: 'shell',
}

const MODES: Record<string, string> = {
  filtered: 'Sortie filtrée (lignes inutiles retirées)',
  summarized: 'Sortie résumée',
  rewritten: 'Texte réécrit plus court',
}

function baseName(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

// Turns ecotokens' raw record into what a person reads: the object, then the means.
export function describeSaving(command: string, family: string, mode: string, before: number, after: number) {
  let what: string
  if (command.startsWith('Read ')) {
    what = `Lecture du fichier ${baseName(command.slice(5).trim())}`
  } else if (command.startsWith('hermes-tool:')) {
    what = `Outil Hermes ${command.slice(12)}`
  } else {
    // `bash -c cd <dir> && real command` reads as the real command.
    const shown = command.replace(/^bash -c\s+/, '').replace(/^cd\s+\S+\s*&&\s*/, '')
    what = `Commande ${FAMILIES[family] ?? family} : ${shown}`
  }
  const how = `${MODES[mode] ?? mode} · ${before} → ${after} tokens`

  return { what, how }
}

// The helper agents the router delegates to, and the model each runs on.
const AGENTS: Record<string, string> = {
  'router-tiny': 'Haiku',
  'router-everyday': 'Sonnet',
  'router-large': 'Opus',
  'router-hardest': 'Fable',
}

const SIZES: Record<string, string> = {
  tiny: 'très petit',
  everyday: 'courant',
  large: 'gros',
  hardest: 'très difficile',
}

export type JevDecision = { size: string | null; confidence: number | null; followup: number | null }

function prob(p: number | null) {
  return p === null ? '' : ` (p=${p.toFixed(2)})`
}

// Says what Jev was asked and what it decided, from the call and the router's own row.
export function describeJev(purpose: string, agent: string | null, ok: boolean, d: JevDecision | null) {
  if (purpose === 'filter_lines') {
    return {
      title: 'Filtrage IA d’une sortie trop longue',
      what: ok ? 'Jev a choisi les lignes utiles à garder' : 'Échec : la sortie a été filtrée sans Jev',
    }
  }
  if (purpose !== 'router') return { title: purpose, what: agent ?? '' }

  const sized = d?.size ? `Message jugé ${SIZES[d.size] ?? d.size}${prob(d.confidence)}` : 'Message évalué'
  if (!ok) return { title: 'Routage du message', what: 'Échec : traité par la session principale' }
  if (agent && AGENTS[agent]) {
    return { title: 'Routage du message', what: `${sized} → délégué à ${agent} (${AGENTS[agent]})` }
  }
  if (agent === 'self (followup)') {
    return {
      title: 'Routage du message',
      what: `${sized}, suite de conversation${prob(d?.followup ?? null)} → gardé par la session`,
    }
  }
  if (agent === 'self (unsure)') {
    return { title: 'Routage du message', what: `${sized}, trop incertain → gardé par la session` }
  }

  return { title: 'Routage du message', what: `${sized} → ${agent ?? 'gardé par la session'}` }
}

type SavingRow = {
  timestamp: string
  command: string
  command_family: string
  tokens_before: number
  tokens_after: number
  savings_pct: number
  mode: string
}

type TotalsRow = { saved: number | null; filtered: number }

type JevRow = {
  timestamp: string
  purpose: string
  agent: string | null
  ok: number
  error_kind: string | null
  http_status: number | null
  latency_ms: number
  input_tokens: number
  output_tokens: number
  size: string | null
  confidence: number | null
  followup_prob: number | null
}

// The rows that saved something since `startedAt`, in the session's project.
function savedSince(startedAt: number, sessionCwd: string) {
  const since = quote(new Date(startedAt).toISOString())
  const cwd = quote(sessionCwd)
  const inProject = `(git_root IS NULL OR git_root = ${cwd} OR ${cwd} LIKE git_root || '/%')`

  return `timestamp >= ${since} AND tokens_after < tokens_before AND ${inProject}`
}

export function ecoQueries(home: string, startedAt: number, sessionCwd: string): EcoQueries {
  const dir = `${home}/.config/ecotokens`
  const since = quote(new Date(startedAt).toISOString())
  const saved = savedSince(startedAt, sessionCwd)

  return {
    savings: sqlite(
      `${dir}/metrics.db`,
      `SELECT timestamp, substr(replace(replace(command, char(10), ' '), char(13), ' '), 1, 200) AS command,
                command_family, tokens_before, tokens_after, savings_pct, mode
           FROM interceptions WHERE ${saved} ORDER BY timestamp DESC LIMIT 5`,
    ),
    totals: sqlite(
      `${dir}/metrics.db`,
      `SELECT sum(tokens_before - tokens_after) AS saved, count(*) AS filtered FROM interceptions WHERE ${saved}`,
    ),
    jev: sqlite(
      `${dir}/router.db`,
      // The router writes its decision a few ms before the call it made: the latest one within 5 s.
      `SELECT j.timestamp, j.purpose, j.agent, j.ok, j.error_kind, j.http_status, j.latency_ms,
              j.input_tokens, j.output_tokens, d.size, d.confidence, d.followup_prob
         FROM jev_calls j
         LEFT JOIN router_decisions d ON d.id = (
           SELECT id FROM router_decisions
            WHERE j.purpose = 'router' AND timestamp <= j.timestamp
              AND julianday(substr(j.timestamp, 1, 23)) - julianday(substr(timestamp, 1, 23)) < 5.0 / 86400
            ORDER BY id DESC LIMIT 1)
        WHERE j.timestamp >= ${since} ORDER BY j.id DESC LIMIT 5`,
    ),
  }
}

export function ecoLog(out: { savings: string; totals: string; jev: string }, now: number): EcoLog {
  const rows = parseRows<SavingRow>(out.savings)
  const totals = parseRows<TotalsRow>(out.totals)
  const jev = parseRows<JevRow>(out.jev)
  const savings: EcoSaving[] = rows.map(r => ({
    at: r.timestamp,
    command: r.command,
    family: r.command_family,
    before: r.tokens_before,
    after: r.tokens_after,
    pct: r.savings_pct,
    mode: r.mode,
    ...describeSaving(r.command, r.command_family, r.mode, r.tokens_before, r.tokens_after),
  }))
  const calls: EcoJevCall[] = jev.map(r => ({
    at: r.timestamp,
    purpose: r.purpose,
    agent: r.agent ?? undefined,
    ok: r.ok === 1,
    error: r.ok === 1 ? undefined : [r.error_kind, r.http_status].filter(x => x !== null).join(' ') || 'échec',
    latencyMs: r.latency_ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    ...describeJev(
      r.purpose,
      r.agent,
      r.ok === 1,
      r.size === null && r.confidence === null
        ? null
        : { size: r.size, confidence: r.confidence, followup: r.followup_prob },
    ),
  }))

  return {
    savings,
    jev: calls,
    totalSaved: totals[0]?.saved ?? 0,
    totalFiltered: totals[0]?.filtered ?? 0,
    measuredAt: now,
  }
}

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function ecoError(error: unknown, now: number): EcoLog {
  return {
    savings: [],
    jev: [],
    totalSaved: 0,
    totalFiltered: 0,
    error: message(error),
    measuredAt: now,
  }
}

export function kTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)
}

// ecotokens stamps nanoseconds; Date reads milliseconds.
export function stamp(iso: string) {
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))
}

// What the transcript shows under a tool result, and the live line of a turn.
// ecotokens keeps no tool_use_id: a call and its row meet by command text and by the clock.

function squash(command: string) {
  return command.replace(/^bash -c\s+/, '').replace(/\s+/g, ' ').trim()
}

// How ecotokens words a call in its `command` column: only the tools it intercepts have one.
export function callKey(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'Bash' && typeof input.command === 'string') return squash(input.command)
  if (tool === 'Read' && typeof input.file_path === 'string') return `Read ${input.file_path}`

  return undefined
}

export type MarkRow = {
  id: string
  timestamp: string
  command: string
  // The query keeps 200 characters of the command: a longer one can only be matched by its start.
  cut: number
  tokens_before: number
  tokens_after: number
  mode: string
}

// The rows that saved something since `since`, oldest first.
export function ecoMarkQuery(home: string, since: number, sessionCwd: string): EcoQuery {
  return sqlite(
    `${home}/.config/ecotokens/metrics.db`,
    `SELECT id, timestamp, substr(replace(replace(command, char(10), ' '), char(13), ' '), 1, 200) AS command,
            length(command) > 200 AS cut, tokens_before, tokens_after, mode
       FROM interceptions WHERE ${savedSince(since, sessionCwd)} AND mode != 'rewritten' ORDER BY timestamp LIMIT 300`,
  )
}

// A row is written by the hook around the call: as far ahead of it as a permission dialog waited,
// as far behind as the AI summary of a long output took.
export const MATCH_LEAD_MS = 120_000
export const MATCH_LAG_MS = 15_000

function sameCommand(key: string, row: MarkRow) {
  const command = squash(row.command)

  return row.cut === 1 ? key.startsWith(command) : key === command
}

// Gives each waiting call the unclaimed row with its command nearest to its run, oldest call first.
// A call with no row yet waits for the next round, until `now` is past the time a row can still come.
export function matchMarks(track: EcoTrack, rows: MarkRow[], now: number) {
  const claimed = new Set(track.claimed)
  const marks: { id: string; mark: EcoMark }[] = []
  const waiting: EcoCall[] = []

  for (const call of [...track.calls].sort((a, b) => a.startedAt - b.startedAt)) {
    let best: MarkRow | undefined
    let bestGap = Infinity
    for (const row of rows) {
      if (claimed.has(row.id) || !sameCommand(call.key, row)) continue
      const at = stamp(row.timestamp)
      if (at < call.startedAt - MATCH_LEAD_MS || at > call.endedAt + MATCH_LAG_MS) continue
      const gap = Math.max(call.startedAt - at, at - call.endedAt, 0)
      if (gap < bestGap) {
        best = row
        bestGap = gap
      }
    }
    if (best) {
      claimed.add(best.id)
      marks.push({ id: call.id, mark: { before: best.tokens_before, after: best.tokens_after, mode: best.mode } })
    } else if (now <= call.endedAt + MATCH_LAG_MS) {
      waiting.push(call)
    }
  }

  return { track: { calls: waiting, claimed: [...claimed].slice(-200) }, marks }
}

// What the transcript lines show: only the savings, as tokens, a percentage and an avoided cost.
export type EcoTotals = { before: number; after: number }

// The model input price (USD per million tokens) from ecotokens' config.json: undefined when unset or unusable.
export function parsePrice(text: string): number | undefined {
  try {
    const price = (JSON.parse(text) as { price_input_usd_per_mtok?: unknown }).price_input_usd_per_mtok

    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined
  } catch {
    return undefined
  }
}

// Same as `ecotokens gain`: tokens saved / 1e6 x the input price.
function costPart(saved: number, price: number | undefined) {
  if (price === undefined || saved <= 0) return undefined
  const usd = (saved / 1_000_000) * price

  return usd < 0.01 ? '< $0.01' : `≈ $${usd.toFixed(2)}`
}

function percent(before: number, saved: number) {
  return before > 0 ? Math.round((saved / before) * 100) : 0
}

function savingParts(t: EcoTotals, price: number | undefined) {
  const saved = t.before - t.after

  return [`−${kTokens(saved)} tokens (−${percent(t.before, saved)} %)`, costPart(saved, price)].filter(Boolean) as string[]
}

function sum(marks: EcoMark[]): EcoTotals {
  return marks.reduce((t, m) => ({ before: t.before + m.before, after: t.after + m.after }), { before: 0, after: 0 })
}

// `ecotokens · −11.3k tokens (−91 %) · ≈ $0.02`
export function markLine(mark: EcoMark, price?: number) {
  return ['ecotokens', ...savingParts(mark, price)].join(' · ')
}

// One line under a folded group of tool calls: what ecotokens saved on the ones it touched.
export function groupLine(marks: EcoMark[], price?: number) {
  return ['ecotokens', ...savingParts(sum(marks), price)].join(' · ')
}

// The rows that saved something since `since` (Rewritten rows excluded, as `ecotokens gain` does), summed.
export function ecoSavedQuery(home: string, since: number, sessionCwd: string): EcoQuery {
  return sqlite(
    `${home}/.config/ecotokens/metrics.db`,
    `SELECT sum(tokens_before) AS before, sum(tokens_after) AS after
       FROM interceptions WHERE ${savedSince(since, sessionCwd)} AND mode != 'rewritten'`,
  )
}

export function parseSaved(stdout: string): EcoTotals {
  const row = parseRows<{ before: number | null; after: number | null }>(stdout)[0]

  return { before: row?.before ?? 0, after: row?.after ?? 0 }
}

// The line that closes a turn: savings since the last one, and since the session began.
export function turnLine(turn: EcoTotals, session: EcoTotals, price?: number) {
  if (turn.before - turn.after <= 0) return undefined
  const sessionSaved = session.before - session.after
  const sessionPart = sessionSaved > 0 ? [`session −${kTokens(sessionSaved)}`, costPart(sessionSaved, price)] : []

  return ['ecotokens', ...savingParts(turn, price), ...sessionPart].filter(Boolean).join(' · ')
}
