import type { EcoCall, EcoJevCall, EcoLog, EcoMark, EcoSaving, EcoTrack } from '../types'
import { formatNumber, formatPercent, formatUsd, t as tr } from './i18n'
import { ecotokensConfigDirectory, joinPath, metricsDatabasePath, type EcotokensPathEnvironment } from './paths'
import { inputPriceForModel, priceModelLabel } from './pricing'

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

const FAMILIES: Record<string, Parameters<typeof tr>[0]> = {
  git: 'family.git',
  gh: 'family.gh',
  cargo: 'family.cargo',
  grep: 'family.grep',
  fs: 'family.fs',
  python: 'family.python',
  js: 'family.js',
  network: 'family.network',
  generic: 'family.generic',
}

export function familyLabel(family: string) {
  return FAMILIES[family] ? tr(FAMILIES[family]) : family
}

const MODES: Record<string, Parameters<typeof tr>[0]> = {
  filtered: 'mode.filtered',
  summarized: 'mode.summarized',
  rewritten: 'mode.rewritten',
}

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// Turns ecotokens' raw record into what a person reads: the object, then the means.
export function describeSaving(command: string, family: string, mode: string, before: number, after: number) {
  let what: string
  if (command.startsWith('Read ')) {
    what = tr('saving.readFile', { file: baseName(command.slice(5).trim()) })
  } else if (command.startsWith('hermes-tool:')) {
    what = tr('saving.hermesTool', { tool: command.slice(12) })
  } else {
    // `bash -c cd <dir> && real command` reads as the real command.
    const shown = command.replace(/^bash -c\s+/, '').replace(/^cd\s+\S+\s*&&\s*/, '')
    what = tr('saving.command', { family: familyLabel(family), command: shown })
  }
  const how = tr('saving.tokens', {
    mode: MODES[mode] ? tr(MODES[mode]) : mode,
    before: formatNumber(before),
    after: formatNumber(after),
    unit: tr('unit.tokens'),
  })

  return { what, how }
}

// The helper agents the router delegates to, and the model each runs on.
const AGENTS: Record<string, string> = {
  'router-tiny': 'Haiku',
  'router-everyday': 'Sonnet',
  'router-large': 'Opus',
  'router-hardest': 'Fable',
}

const SIZES: Record<string, Parameters<typeof tr>[0]> = {
  tiny: 'jev.size.tiny',
  everyday: 'jev.size.everyday',
  large: 'jev.size.large',
  hardest: 'jev.size.hardest',
}

export type JevDecision = { size: string | null; confidence: number | null; followup: number | null }

function prob(p: number | null) {
  return p === null ? '' : ` (p=${formatNumber(p, 2)})`
}

// Says what Jev was asked and what it decided, from the call and the router's own row.
export function describeJev(purpose: string, agent: string | null, ok: boolean, d: JevDecision | null) {
  if (purpose === 'filter_lines') {
    return {
      title: tr('jev.filterTitle'),
      what: ok ? tr('jev.filterSuccess') : tr('jev.filterFailure'),
    }
  }
  if (purpose !== 'router') {
    const purposeKey = purpose === 'code_gate' ? 'purpose.codeGate' : purpose === 'verify' ? 'purpose.verify' : undefined

    return { title: purposeKey ? tr(purposeKey) : purpose, what: agent ?? '' }
  }

  const size = d?.size ? (SIZES[d.size] ? tr(SIZES[d.size]) : d.size) : undefined
  const sized = size ? tr('jev.messageSize', { size, confidence: prob(d?.confidence ?? null) }) : tr('jev.messageRated')
  if (!ok) return { title: tr('jev.routerTitle'), what: tr('jev.routingFailure') }
  if (agent && AGENTS[agent]) {
    return { title: tr('jev.routerTitle'), what: tr('jev.delegated', { message: sized, agent, model: AGENTS[agent] }) }
  }
  if (agent === 'self (followup)') {
    return {
      title: tr('jev.routerTitle'),
      what: tr('jev.followup', { size: sized, probability: prob(d?.followup ?? null) }),
    }
  }
  if (agent === 'self (unsure)') {
    return { title: tr('jev.routerTitle'), what: tr('jev.uncertain', { size: sized }) }
  }

  return { title: tr('jev.routerTitle'), what: `${sized} → ${agent ?? tr('jev.keptBySession')}` }
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
  // Windows paths use `\`: compare on `/` so a sub-folder of the git root still matches.
  const slashed = (value: string) => `replace(${value}, char(92), '/')`
  const inProject = `(git_root IS NULL OR ${slashed('git_root')} = ${slashed(cwd)} OR ${slashed(cwd)} LIKE ${slashed('git_root')} || '/%')`

  return `timestamp >= ${since} AND tokens_after < tokens_before AND ${inProject}`
}

export function ecoQueries(home: string, startedAt: number, sessionCwd: string, environment?: EcotokensPathEnvironment): EcoQueries {
  const dir = ecotokensConfigDirectory(home, environment)
  const metricsDb = metricsDatabasePath(home, environment)
  const since = quote(new Date(startedAt).toISOString())
  const saved = savedSince(startedAt, sessionCwd)

  return {
    savings: sqlite(
      metricsDb,
      `SELECT timestamp, substr(replace(replace(command, char(10), ' '), char(13), ' '), 1, 200) AS command,
                command_family, tokens_before, tokens_after, savings_pct, mode
           FROM interceptions WHERE ${saved} ORDER BY timestamp DESC LIMIT 5`,
    ),
    totals: sqlite(
      metricsDb,
      `SELECT sum(tokens_before - tokens_after) AS saved, count(*) AS filtered FROM interceptions WHERE ${saved}`,
    ),
    jev: sqlite(
      joinPath(dir, 'router.db'),
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
  const digits = n >= 100_000 ? 0 : 1

  return n >= 1000 ? `${formatNumber(n / 1000, digits, digits)}k` : formatNumber(n)
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
export function ecoMarkQuery(home: string, since: number, sessionCwd: string, environment?: EcotokensPathEnvironment): EcoQuery {
  return sqlite(
    metricsDatabasePath(home, environment),
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

    return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : undefined
  } catch {
    return undefined
  }
}

export type EcoRate = { price: number; model?: string; configured: boolean }

// An explicit EcoTokens price is a global override. With no override, use the
// active Claude model's first-party API input rate for this turn.
export function resolveEcoRate(configText: string | undefined, model: string | undefined, inputTokens?: number): EcoRate | undefined {
  const configured = configText === undefined ? undefined : parsePrice(configText)
  if (configured !== undefined) return { price: configured, configured: true }

  const price = inputPriceForModel(model, inputTokens)

  return price === undefined ? undefined : { price, model: priceModelLabel(model), configured: false }
}

// Same as `ecotokens gain`: tokens saved / 1e6 x the input price.
function costPart(saved: number, price: number | undefined, model?: string) {
  if (price === undefined || saved <= 0) return undefined
  const usd = (saved / 1_000_000) * price
  const amount = usd === 0 ? `≈ ${formatUsd(0)}` : usd < 0.01 ? `< ${formatUsd(0.01)}` : `≈ ${formatUsd(usd)}`

  return model ? `${amount} ${tr('transcript.apiRate', { model })}` : amount
}

function savingParts(t: EcoTotals, price: number | undefined, model?: string) {
  const saved = t.before - t.after

  return [tr('transcript.saving', { tokens: kTokens(saved), percent: formatPercent(saved, t.before, 0), unit: tr('unit.tokens') }), costPart(saved, price, model)].filter(Boolean) as string[]
}

function sum(marks: EcoMark[]): EcoTotals {
  return marks.reduce((t, m) => ({ before: t.before + m.before, after: t.after + m.after }), { before: 0, after: 0 })
}

// `ecotokens · −11.3k tokens (−91 %) · ≈ $0.02`
export function markLine(mark: EcoMark, price?: number, model?: string) {
  return ['ecotokens', ...savingParts(mark, price, model)].join(' · ')
}

// One line under a folded group of tool calls: what ecotokens saved on the ones it touched.
export function groupLine(marks: EcoMark[], price?: number, model?: string) {
  return ['ecotokens', ...savingParts(sum(marks), price, model)].join(' · ')
}

// The rows that saved something since `since` (Rewritten rows excluded, as `ecotokens gain` does), summed.
export function ecoSavedQuery(home: string, since: number, sessionCwd: string, environment?: EcotokensPathEnvironment): EcoQuery {
  return sqlite(
    metricsDatabasePath(home, environment),
    `SELECT sum(tokens_before) AS before, sum(tokens_after) AS after
       FROM interceptions WHERE ${savedSince(since, sessionCwd)} AND mode != 'rewritten'`,
  )
}

export function parseSaved(stdout: string): EcoTotals {
  const row = parseRows<{ before: number | null; after: number | null }>(stdout)[0]

  return { before: row?.before ?? 0, after: row?.after ?? 0 }
}

// The line that closes a turn: savings since the last one, and since the session began.
export function turnLine(turn: EcoTotals, session: EcoTotals, price?: number, model?: string, includeSessionCost = true) {
  if (turn.before - turn.after <= 0) return undefined
  const sessionSaved = session.before - session.after
  const sessionPart = sessionSaved > 0
    ? [tr('transcript.sessionSaved', { tokens: kTokens(sessionSaved), unit: tr('unit.tokens') }), includeSessionCost ? costPart(sessionSaved, price) : undefined]
    : []

  return ['ecotokens', ...savingParts(turn, price, model), ...sessionPart].filter(Boolean).join(' · ')
}
