import { atom, memberOf, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionContextBreakdown, SessionUsage, Timer, ToolCallInput } from 'claude-code'

import type { AgentRow, AgentsState, TaskRow, ContextDetail, EcoLog, EcoMark, EcoSetup, EcoTrack, EffortLevel, GainPeriod, GainState, HandoffState, TabId, UsageSnapshot, WatchState } from '../types'
import {
  AGENT_STATUS,
  TASK_STATUS,
  elapsedLabel,
  isActive,
  isTaskActive,
  mergeListed,
  pruneEnded,
  reconcileTasks,
  recordSpawn,
  recordTaskStart,
  recordTaskStop,
  recordToolUse,
  costLabel,
  delegationLine,
  recordTurn,
  shortModel,
  taskElapsedLabel,
  taskFromCall,
  taskKindLabel,
} from './agents'
import type { InFlightTask } from './agents'
import { cells, gradient } from './bar'
import { callKey, ecoError, ecoLog, ecoMarkQuery, ecoQueries, ecoSavedQuery, familyLabel, groupLine, kTokens, markLine, matchMarks, message, parsePrice, parseRows, parseSaved, resolveEcoRate, stamp, turnLine, MATCH_LEAD_MS } from './eco'
import type { EcoQuery, EcoRate, MarkRow } from './eco'
import { GAIN_PERIODS, gainCommand, jevCommand, parseGain, parseJev, purposeLabel, sparkline } from './gain'
import { HANDOFF_LIST, HANDOFF_STATUS, handoffToggle, parseHandoff, parseHandoffList } from './handoff'
import { WATCH_STATUS, parseLogTail, parseWatch, tailLogContents, watchStart, watchStop } from './watch'
import { configureLocale, formatClock, formatNumber, formatPercent, formatUsd, t, tp } from './i18n'
import { ecotokensConfigDirectory, ecotokensConfigPath, joinPath, metricsDatabasePath, pathBelow, relativePath, samePath, type EcotokensPathEnvironment } from './paths'

const PANE = 'ecotokens-panel'
const TITLE = 'ecotokens-panel'
const PANE_COLUMNS = 44

const tab = atom({ plugin: 'ecotokens-panel', key: 'tab' } as const, 'session' as TabId)
const usage = atom({ plugin: 'ecotokens-panel', key: 'usage' } as const, null as UsageSnapshot | null)
const context = atom({ plugin: 'ecotokens-panel', key: 'context' } as const, null as ContextDetail | null)
const eco = atom({ plugin: 'ecotokens-panel', key: 'eco' } as const, null as EcoLog | null)
// What the transcript shows live: the saving of each tool call (one value per tool_use_id, so only its row redraws),
// the calls still waiting for their row, and when the last turn line was drawn.
const ecoMark = atom({ plugin: 'ecotokens-panel', key: 'ecoMark' } as const, null as EcoMark | null)
const ecoTrack = atom({ plugin: 'ecotokens-panel', key: 'ecoTrack' } as const, { calls: [], claimed: [] } as EcoTrack)
const ecoSeen = atom({ plugin: 'ecotokens-panel', key: 'ecoSeen' } as const, 0)
const handoff = atom({ plugin: 'ecotokens-panel', key: 'handoff' } as const, null as HandoffState | null)
const gainPeriod = atom({ plugin: 'ecotokens-panel', key: 'gainPeriod' } as const, 'today' as GainPeriod)
const gain = atom({ plugin: 'ecotokens-panel', key: 'gain' } as const, null as GainState | null)
const watch = atom({ plugin: 'ecotokens-panel', key: 'watch' } as const, null as WatchState | null)
const model = atom({ plugin: 'ecotokens-panel', key: 'model' } as const, null as string | null)
const effort = atom({ plugin: 'ecotokens-panel', key: 'effort' } as const, null as EffortLevel | null)
const effortOptions = atom({ plugin: 'ecotokens-panel', key: 'effortOptions' } as const, null as string[] | null)
const agents = atom({ plugin: 'ecotokens-panel', key: 'agents' } as const, null as AgentsState | null)

// Add a tab here, then a case in drawTab().
const TABS: { id: TabId; labelKey: Parameters<typeof t>[0] }[] = [
  { id: 'session', labelKey: 'tab.session' },
  { id: 'context', labelKey: 'tab.context' },
  { id: 'eco', labelKey: 'tab.eco' },
  { id: 'gain', labelKey: 'tab.gains' },
  { id: 'watch', labelKey: 'tab.watch' },
  { id: 'agents', labelKey: 'tab.background' },
]

// The model buttons, cheapest first. The effort buttons offer EFFORTS until /config says otherwise.
const MODELS = ['haiku', 'sonnet', 'opus', 'fable']
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

const WINDOW_LABELS: Record<string, Parameters<typeof t>[0]> = {
  five_hour: 'window.fiveHour',
  seven_day: 'window.sevenDay',
  spend_limit: 'window.spendLimit',
}

function snapshot(u: SessionUsage, now: number): UsageSnapshot {
  return {
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    costUsd: u.cost?.usd,
    measuredAt: now,
  }
}

type EnvironmentName = 'HOME' | 'USERPROFILE' | 'HOMEDRIVE' | 'HOMEPATH' | 'APPDATA' | 'XDG_CONFIG_HOME' | 'OS' | 'OSTYPE' | 'ECOTOKENS_PANEL_LANG' | 'LC_ALL' | 'LC_MESSAGES' | 'LANG' | 'LANGUAGE'

async function environmentValue($: EngineInterface, name: EnvironmentName) {
  try {
    switch (name) {
      case 'HOME': return await $.env.get('HOME')
      case 'USERPROFILE': return await $.env.get('USERPROFILE')
      case 'HOMEDRIVE': return await $.env.get('HOMEDRIVE')
      case 'HOMEPATH': return await $.env.get('HOMEPATH')
      case 'APPDATA': return await $.env.get('APPDATA')
      case 'XDG_CONFIG_HOME': return await $.env.get('XDG_CONFIG_HOME')
      case 'OS': return await $.env.get('OS')
      case 'OSTYPE': return await $.env.get('OSTYPE')
      case 'ECOTOKENS_PANEL_LANG': return await $.env.get('ECOTOKENS_PANEL_LANG')
      case 'LC_ALL': return await $.env.get('LC_ALL')
      case 'LC_MESSAGES': return await $.env.get('LC_MESSAGES')
      case 'LANG': return await $.env.get('LANG')
      case 'LANGUAGE': return await $.env.get('LANGUAGE')
    }
  } catch {
    return undefined
  }

  return undefined
}

async function homeDirectory($: EngineInterface) {
  const home = await environmentValue($, 'HOME')
  const profile = await environmentValue($, 'USERPROFILE')
  if (profile && home && /^\/[a-z]\//i.test(home)) return profile
  if (home) return home
  if (profile) return profile
  const drive = await environmentValue($, 'HOMEDRIVE')
  const homePath = await environmentValue($, 'HOMEPATH')

  return drive && homePath ? `${drive}${homePath}` : ''
}

async function ecotokensPathEnvironment($: EngineInterface): Promise<EcotokensPathEnvironment> {
  const [appData, userProfile, xdgConfigHome, os, osType, home] = await Promise.all([
    environmentValue($, 'APPDATA'),
    environmentValue($, 'USERPROFILE'),
    environmentValue($, 'XDG_CONFIG_HOME'),
    environmentValue($, 'OS'),
    environmentValue($, 'OSTYPE'),
    environmentValue($, 'HOME'),
  ])
  const unixType = osType?.toLowerCase() ?? ''
  const isGitBashHome = /^\/[a-z]\//i.test(home ?? '')
  const isPosixHome = home?.startsWith('/') && !isGitBashHome
  // An explicit OSTYPE wins; the shape of HOME is only a fallback.
  const platform = unixType.includes('darwin')
    ? 'darwin'
    : unixType.includes('linux')
      ? 'linux'
      : isPosixHome
        ? home?.startsWith('/Users/') ? 'darwin' : 'linux'
        : os === 'Windows_NT' || appData || userProfile
          ? 'win32'
          : 'linux'

  return { platform, appData, userProfile, xdgConfigHome }
}

async function configurePanelLocale($: EngineInterface) {
  const [explicit, lcAll, lcMessages, lang, language] = await Promise.all([
    environmentValue($, 'ECOTOKENS_PANEL_LANG'),
    environmentValue($, 'LC_ALL'),
    environmentValue($, 'LC_MESSAGES'),
    environmentValue($, 'LANG'),
    environmentValue($, 'LANGUAGE'),
  ])

  if (explicit || lcAll || lcMessages || lang || language) {
    configureLocale({ ECOTOKENS_PANEL_LANG: explicit, LC_ALL: lcAll, LC_MESSAGES: lcMessages, LANG: lang, LANGUAGE: language })
  }
}

function detail(b: SessionContextBreakdown, now: number): ContextDetail {
  const servers = new Map<string, { server: string; tools: number; loaded: number; tokens: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { server: t.serverName, tools: 0, loaded: 0, tokens: 0 }
    s.tools += 1
    if (t.isLoaded) {
      s.loaded += 1
      s.tokens += t.tokens
    }
    servers.set(t.serverName, s)
  }

  return {
    model: b.model,
    totalTokens: b.totalTokens,
    maxTokens: b.rawMaxTokens,
    percentage: b.percentage,
    isAutoCompactEnabled: b.isAutoCompactEnabled,
    autoCompactThreshold: b.autoCompactThreshold,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    grid: b.gridRows.map(row => row.map(q => ({ color: q.color, isFilled: q.isFilled, fullness: q.squareFullness }))),
    memoryFiles: [...b.memoryFiles].sort((x, y) => y.tokens - x.tokens).map(f => ({ path: f.path, type: f.type, tokens: f.tokens })),
    mcpServers: [...servers.values()].sort((x, y) => y.tokens - x.tokens),
    skills: b.skills && { total: b.skills.totalSkills, included: b.skills.includedSkills, tokens: b.skills.tokens },
    agents: { count: b.agents.length, tokens: b.agents.reduce((sum, a) => sum + a.tokens, 0) },
    api: b.apiUsage && {
      input: b.apiUsage.input_tokens,
      cacheRead: b.apiUsage.cache_read_input_tokens,
      cacheWrite: b.apiUsage.cache_creation_input_tokens,
      output: b.apiUsage.output_tokens,
    },
    measuredAt: now,
  }
}

// `summary` estimates locally, as /context's quick view: no token-count requests.
async function refresh($: EngineInterface) {
  const u = await $.session.usage({ breakdown: 'summary' })
  const now = await $.clock.now()
  await update($, usage, () => snapshot(u, now))
  const b = u.context.breakdown
  if (b) await update($, context, () => detail(b, now))
  await refreshModel($)
  await refreshChoices($)
  await refreshEco($)
  await refreshHandoff($)
  await refreshWatch($)
  await refreshAgents($)
}

async function refreshModel($: EngineInterface) {
  try {
    const current = await $.session.model()
    await update($, model, () => current)
  } catch {
    // Left empty: no button is marked as current.
  }
}

// The /config menu's effort row gives the levels this session offers and the current one.
// An absent or empty row leaves the list to EFFORTS, the effort to the last choice.
async function refreshChoices($: EngineInterface) {
  try {
    const rows = await $.config.list()
    const row = rows.find(r => r.key === 'effort' && r.kind === 'choice')
    const e = row?.options?.length ? row : undefined
    await update($, effortOptions, () => (e?.options ? [...e.options] : null))
    if (e && typeof e.value === 'string' && e.options?.includes(e.value)) await update($, effort, () => e.value as EffortLevel)
  } catch {
    // Left as it was: the fallback list stays on screen.
  }
}

// Runs /model or /effort as if typed. The engine has no setter for either:
// the effort shown is the one /config reports, else the last one chosen from here.
async function runSetting($: EngineInterface, command: 'model' | 'effort', value: string) {
  try {
    await $.command.run({ command, args: value })
    if (command === 'effort') await update($, effort, () => value as EffortLevel)
    await refreshModel($)
    $.ui.toast(`/${command} ${value}`)
  } catch (error) {
    $.ui.toast(t('toast.settingFailed', { command, reason: message(error) }))
  }
}

// Ultracode is a session mode, not an effort level. Keep its controls separate
// and explicit because Claude Code does not expose its live state to plugins.
async function runUltracode($: EngineInterface, enabled: boolean) {
  const args = enabled ? 'ultracode on' : 'ultracode off'
  try {
    await $.command.run({ command: 'effort', args })
    $.ui.toast(t(enabled ? 'toast.ultracodeEnabled' : 'toast.ultracodeDisabled'))
  } catch (error) {
    $.ui.toast(t('toast.settingFailed', { command: `/effort ${args}`, reason: message(error) }))
  }
}

// A command's output; a non-zero exit is an error carrying its stderr.
async function output($: EngineInterface, argv: string[], timeoutMs: number, what = argv.slice(0, 2).join(' ')) {
  const ran = await $.process.run(argv, { timeoutMs })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || t('toast.commandFailed', { command: what, code: ran.exitCode }))

  return ran.stdout
}

// What a tab adds when it can: the command's output, or undefined when it fails in any way.
async function extra($: EngineInterface, argv: string[], cwd?: string) {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs: 5_000 })
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

// Runs a control command and says in a toast how it went; true when it succeeded.
async function control($: EngineInterface, what: string, argv: string[], timeoutMs: number, done: string, cwd?: string) {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs })
    $.ui.toast(ran.exitCode === 0 ? done : t('toast.actionFailed', {
      action: what,
      reason: ran.stderr.trim() || t('toast.actionExitFailed', { action: what, code: ran.exitCode }),
    }))
    return ran.exitCode === 0
  } catch (error) {
    $.ui.toast(t('toast.actionFailed', { action: what, reason: message(error) }))
    return false
  }
}

function runQuery($: EngineInterface, q: EcoQuery) {
  return output($, q.argv, 5_000, 'sqlite3')
}

async function refreshEco($: EngineInterface) {
  let log: EcoLog
  let setup: EcoSetup | undefined
  try {
    const { startedAt } = await $.session.usage()
    const home = await homeDirectory($)
    if (!home) throw new Error(t('panel.homeUnavailable'))
    const paths = await ecotokensPathEnvironment($)
    const databasePath = metricsDatabasePath(home, paths)
    const configPath = ecotokensConfigPath(home, paths)
    const routerPath = joinPath(ecotokensConfigDirectory(home, paths), 'router.db')
    const [metricsAvailable, configAvailable, routerAvailable] = await Promise.all([
      $.fs.exists(databasePath),
      $.fs.exists(configPath),
      $.fs.exists(routerPath),
    ])
    let priceConfigured = false
    if (configAvailable) {
      try {
        priceConfigured = parsePrice(await $.fs.read(configPath)) !== undefined
      } catch {
        // A missing or unreadable price should not hide metrics from the panel.
      }
    }
    setup = { metricsPath: databasePath, metricsAvailable, configPath, configAvailable, priceConfigured }
    const measuredAt = await $.clock.now()
    if (!metricsAvailable) {
      log = { savings: [], jev: [], totalSaved: 0, totalFiltered: 0, setup, measuredAt }
    } else {
      const q = ecoQueries(home, startedAt, await $.session.cwd(), paths)
      const [savings, totals, jev] = await Promise.all([
        runQuery($, q.savings),
        runQuery($, q.totals),
        routerAvailable ? runQuery($, q.jev) : Promise.resolve('[]'),
      ])
      log = { ...ecoLog({ savings, totals, jev }, measuredAt), setup }
    }
  } catch (error) {
    log = { ...ecoError(error, await $.clock.now()), setup }
  }
  await update($, eco, () => log)
}

// The databases the live lines read: without ecotokens there is nothing to draw, and nothing is run.
async function ecoDir($: EngineInterface) {
  const home = await homeDirectory($)
  const paths = await ecotokensPathEnvironment($)

  return home && (await $.fs.exists(metricsDatabasePath(home, paths))) ? home : undefined
}

// A tool call that has finished waits for the row ecotokens wrote for it.
async function trackEcoCall($: EngineInterface, e: ToolCallInput, startedAt: number) {
  const key = callKey(String(e.tool), e as Record<string, unknown>)
  if (!key || !e.tool_use_id) return
  const call = { id: e.tool_use_id, key, startedAt, endedAt: await $.clock.now() }
  await update($, ecoTrack, t => ({ ...t, calls: [...t.calls, call].slice(-50) }))
  await matchEco($)
  // A row written after the call (a read's summary) lands a little later.
  if ((await read($, ecoTrack)).calls.some(c => c.id === call.id)) $.clock.after(4_000, () => void matchEco($))
}

// Gives each waiting call its row, and marks the tool row it belongs to.
// The lines are a bonus: whatever fails (no ecotokens, no sqlite3) leaves the transcript as it was.
async function matchEco($: EngineInterface) {
  try {
    const waiting = (await read($, ecoTrack)).calls
    const home = waiting.length > 0 ? await ecoDir($) : undefined
    if (home === undefined) return
    const paths = await ecotokensPathEnvironment($)
    const since = Math.min(...waiting.map(c => c.startedAt)) - MATCH_LEAD_MS
    const rows = parseRows<MarkRow>(await runQuery($, ecoMarkQuery(home, since, await $.session.cwd(), paths)))
    const now = await $.clock.now()
    let found: ReturnType<typeof matchMarks>['marks'] = []
    // Matched on what the state holds now: a call tracked meanwhile is not lost, and no row is given twice.
    await update($, ecoTrack, t => {
      const matched = matchMarks(t, rows, now)
      found = matched.marks

      return matched.track
    })
    for (const { id, mark } of found) await update($, memberOf(ecoMark, { requestId: id }), () => mark)
  } catch {
    // Left as it was: the next call or turn tries again.
  }
}

type PromptUsage = {
  model?: string
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// A manual global price remains an override. Otherwise use the model and usage
// of this session turn, so a /model change applies to the next estimate.
async function ecoRate($: EngineInterface, prompt?: PromptUsage): Promise<EcoRate | undefined> {
  try {
    const home = await homeDirectory($)
    if (!home) return undefined

    let configText: string | undefined
    try {
      configText = await $.fs.read(ecotokensConfigPath(home, await ecotokensPathEnvironment($)))
    } catch {
      // The config file is optional; a missing file must not block model-based estimates.
    }

    const [activeModel, currentUsage] = await Promise.all([
      $.session.model().catch(() => undefined),
      prompt ? Promise.resolve(undefined) : $.session.usage().catch(() => undefined),
    ])
    const model = prompt?.model ?? activeModel
    const inputTokens = prompt
      ? [prompt.input_tokens, prompt.cache_read_input_tokens, prompt.cache_creation_input_tokens]
        .every(value => typeof value === 'number' && Number.isFinite(value))
        ? prompt.input_tokens! + prompt.cache_read_input_tokens! + prompt.cache_creation_input_tokens!
        : undefined
      : currentUsage?.context.tokens

    return resolveEcoRate(configText, model, inputTokens)
  } catch {
    return undefined
  }
}

async function ecoMarkLine($: EngineInterface, mark: EcoMark) {
  const rate = await ecoRate($)

  return markLine(mark, rate?.price, rate?.model)
}

async function ecoGroupLine($: EngineInterface, marks: EcoMark[]) {
  const rate = await ecoRate($)

  return groupLine(marks, rate?.price, rate?.model)
}

// After a turn of the main conversation: what ecotokens saved since the last one, and in the session.
async function logEcoTurn($: EngineInterface, prompt?: PromptUsage) {
  try {
    const home = await ecoDir($)
    if (home === undefined) return
    const { startedAt } = await $.session.usage()
    const now = await $.clock.now()
    const since = Math.max(await read($, ecoSeen), startedAt)
    await update($, ecoSeen, () => now)
    const cwd = await $.session.cwd()
    const paths = await ecotokensPathEnvironment($)
    const [turn, session] = await Promise.all([
      runQuery($, ecoSavedQuery(home, since, cwd, paths)),
      runQuery($, ecoSavedQuery(home, startedAt, cwd, paths)),
    ])
    const rate = await ecoRate($, prompt)
    const line = turnLine(parseSaved(turn), parseSaved(session), rate?.price, rate?.model, rate?.configured ?? false)
    if (line) $.ui.log(line)
  } catch {
    // No line for this turn.
  }
}

// A delegated run (a `router-*` subagent) ended: what it used and cost, one line per finished run.
async function logDelegation($: EngineInterface, id: string, usage: Parameters<typeof delegationLine>[1]) {
  try {
    const row = (await read($, agents))?.rows.find(r => r.id === id)
    const line = row ? delegationLine(row.type, usage) : undefined
    if (line) $.ui.log(line)
  } catch {
    // No line for this run.
  }
}

// The handoff panel is a bonus too: without ecotokens it just says so.
async function refreshHandoff($: EngineInterface) {
  let state: HandoffState | null = null
  try {
    const status = await extra($, HANDOFF_STATUS)
    if (status !== undefined) state = parseHandoff(status, await $.clock.now())
    if (state) {
      // The list is a bonus of the bonus: without it the status still shows, entries empty.
      const cwd = await $.session.cwd()
      const listed = await extra($, HANDOFF_LIST, cwd)
      if (listed !== undefined) state = { ...state, entries: parseHandoffList(listed, cwd) }
    }
  } catch {
    // Left empty: the panel shows that the state could not be read.
  }
  await update($, handoff, () => state)
}

async function runHandoff($: EngineInterface, argv: string[], done: string) {
  await control($, 'handoff', argv, 15_000, done)
  await refreshHandoff($)
}

// Runs the /handoff skill as if typed: it writes the handoff, then has the model fill its fields.
// The turn it starts is the model's; the status is read again when it completes.
async function runHandoffSkill($: EngineInterface) {
  try {
    await $.command.run({ command: 'handoff', args: '' })
    $.ui.toast(t('toast.handoffStarted'))
  } catch (error) {
    $.ui.toast(t('toast.actionFailed', { action: 'handoff', reason: message(error) }))
  }
}

async function report<T>($: EngineInterface, argv: string[], parse: (stdout: string) => T) {
  return parse(await output($, argv, 10_000))
}

// `ecotokens gain` and `ecotokens jev` over the chosen period, for this workspace only, each on its own.
async function refreshGain($: EngineInterface) {
  const period = await read($, gainPeriod)
  const project = await $.session.cwd()
  const [g, j] = await Promise.allSettled([
    report($, gainCommand(period, project), parseGain),
    report($, jevCommand(period, project), parseJev),
  ])
  const state: GainState = {
    period,
    project,
    gain: g.status === 'fulfilled' ? g.value : undefined,
    gainError: g.status === 'rejected' ? message(g.reason) : undefined,
    jev: j.status === 'fulfilled' ? j.value : undefined,
    jevError: j.status === 'rejected' ? message(j.reason) : undefined,
    measuredAt: await $.clock.now(),
  }
  await update($, gain, () => state)
}

// The watch tab is a bonus too: without ecotokens it says the state could not be read.
async function refreshWatch($: EngineInterface) {
  let state: WatchState | null = null
  try {
    const cwd = await $.session.cwd()
    const ran = await $.process.run(WATCH_STATUS, { timeoutMs: 5_000 })
    state = parseWatch(ran.stdout, ran.exitCode === 0, cwd, await $.clock.now())
    // Without its tail the log stays empty.
    const logFile = state.current?.logFile
    let tail: string | undefined
    if (logFile) {
      try {
        tail = tailLogContents(await $.fs.read(logFile))
      } catch {
        // A missing or unreadable log does not make the watcher status unusable.
      }
    }
    if (tail !== undefined) state = { ...state, log: parseLogTail(tail) }
  } catch {
    // Left empty: the tab shows that the state could not be read.
  }
  await update($, watch, () => state)
}

// The daemon registers itself just after `--background` returns: wait a moment before reading.
async function runWatch($: EngineInterface, start: boolean) {
  const cwd = await $.session.cwd()
  const argv = start ? watchStart(cwd) : watchStop(cwd)
  const isDone = await control($, 'watch', argv, 15_000, start ? t('toast.watchStarted') : t('toast.watchStopped'), cwd)
  if (start && isDone) await $.clock.sleep(800)
  await refreshWatch($)
}

// The session's subagents and teammates: `$.agent.list()` joined with what the hooks below saw.
async function refreshAgents($: EngineInterface) {
  const now = await $.clock.now()
  let listed: AgentInfo[]
  try {
    listed = await $.agent.list()
  } catch (error) {
    await update($, agents, s => ({ rows: s?.rows ?? [], tasks: s?.tasks, error: message(error), measuredAt: now }))
    return
  }
  // Nothing runs and nothing changed (nothing ended long enough ago to leave): no redraw.
  const prev = await read($, agents)
  const kept = pruneEnded({ rows: mergeListed(prev?.rows ?? [], listed, now), tasks: prev?.tasks ?? [] }, now)
  const isIdle = !kept.rows.some(r => isActive(r.status)) && !kept.tasks.some(t => isTaskActive(t.status))
  const isSame = JSON.stringify(kept.rows) === JSON.stringify(prev?.rows) && kept.tasks.length === (prev?.tasks ?? []).length
  if (prev && !prev.error && isIdle && isSame) return
  await update($, agents, s => ({
    ...pruneEnded({ rows: mergeListed(s?.rows ?? [], listed, now), tasks: s?.tasks ?? [] }, now),
    measuredAt: now,
  }))
}

// Changes the row of one agent the tab already holds; an id it does not hold (a workflow's agent,
// an engine fork such as compaction) is left out, and nothing is written.
async function changeAgent($: EngineInterface, id: string, change: (rows: AgentRow[], now: number) => AgentRow[]) {
  const known = await read($, agents)
  if (!known?.rows.some(r => r.id === id)) return
  const now = await $.clock.now()
  await update($, agents, s => ({ rows: change(s?.rows ?? [], now), tasks: s?.tasks, error: s?.error, measuredAt: now }))
}

// Changes the background tasks, beside the agents.
async function changeTasks($: EngineInterface, change: (tasks: TaskRow[], s: AgentsState | null, now: number) => TaskRow[]) {
  const now = await $.clock.now()
  await update($, agents, s => ({ rows: s?.rows ?? [], tasks: change(s?.tasks ?? [], s, now), error: s?.error, measuredAt: now }))
}

// A Stop event's list of the background work still in flight: the tasks it no longer names have ended.
// Absent (an engine that does not say), nothing is concluded.
async function reconcileInFlight($: EngineInterface, inFlight: readonly InFlightTask[] | undefined) {
  if (!inFlight) return
  const known = await read($, agents)
  if (!inFlight.length && !(known?.tasks ?? []).some(t => isTaskActive(t.status))) return
  await changeTasks($, (tasks, s, now) => reconcileTasks(tasks, [...inFlight], new Set((s?.rows ?? []).map(r => r.id)), now))
}

// Elapsed times move while an agent runs: the tab re-reads the list every 2 s while it is shown.
// The timer is no state: a reload drops it, and the next spawn, run end, ↻ or tab press restarts it.
const AGENTS_TICK_MS = 2_000
let agentsTicker: Timer | undefined

function watchAgents($: EngineInterface) {
  agentsTicker?.cancel()
  agentsTicker = $.clock.every(AGENTS_TICK_MS, () => void tickAgents($))
}

async function tickAgents($: EngineInterface) {
  try {
    if ((await read($, tab)) === 'agents' && (await isPaneOpen($))) {
      await refreshAgents($)
      return
    }
  } catch {
    // The next tick tries again.
    return
  }
  agentsTicker?.cancel()
  agentsTicker = undefined
}

async function refreshAgentsIfShown($: EngineInterface) {
  if ((await read($, tab)) !== 'agents' || !(await isPaneOpen($))) return
  await refreshAgents($)
  watchAgents($)
}

// Reads ecotokens' databases only while its tab is the one on screen.
async function refreshEcoIfShown($: EngineInterface) {
  if ((await read($, tab)) === 'eco' && (await isPaneOpen($))) await refreshEco($)
}

async function isPaneOpen($: EngineInterface) {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE)
  } catch {
    return false
  }
}

async function toggle($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return
  }
  await refresh($)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  if (!opened.isPlaced) $.ui.toast(t('panel.openFailed', { reason: opened.reason }))
  else if ((await read($, tab)) === 'agents') watchAgents($)
}

function levelColor(percent: number) {
  return gradient(percent / 100)
}

function pct(part: number, whole: number) {
  return formatPercent(part, whole)
}

function shortPath(path: string, userHome: string) {
  if (userHome && samePath(path, userHome)) return '~'
  if (userHome && pathBelow(path, userHome)) {
    const relative = relativePath(path, userHome)

    return userHome.includes('\\') ? `~\\${relative.replaceAll('/', '\\')}` : `~/${relative}`
  }

  return path
    .replace(/^\/var\/home\/[^/]+|^\/home\/[^/]+/, '~')
    .replace(/^[A-Z]:[\\/]Users[\\/][^\\/]+/i, '~')
}

function shortenWatchedPath(line: string, cwd: string) {
  const normalizedLine = line.replaceAll('\\', '/')
  const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const windowsPath = /^[A-Z]:\//i.test(normalizedCwd) || cwd.includes('\\')
  const searchedLine = windowsPath ? normalizedLine.toLowerCase() : normalizedLine
  const searchedCwd = windowsPath ? normalizedCwd.toLowerCase() : normalizedCwd
  const index = searchedLine.indexOf(`${searchedCwd}/`)
  if (index < 0) return line

  return `${normalizedLine.slice(0, index)}~/${normalizedLine.slice(index + normalizedCwd.length + 1)}`
}

// The glyphs /context draws: full, partly full, empty.
function square(fullness: number, isFilled: boolean) {
  if (!isFilled) return '⛶'
  return fullness >= 0.7 ? '⛁' : '⛀'
}

function clock(iso: string) {
  return formatClock(stamp(iso))
}

function ageLabel(hours: number) {
  if (hours < 1) return t('duration.lessThanHourAgo')
  if (hours < 48) return tp('duration.hoursAgo', hours)

  return tp('duration.daysAgo', Math.floor(hours / 24))
}

function untilReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return t('duration.resetImminent')
  const min = Math.round(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const parts = d > 0 ? [tp('duration.days', d), h > 0 ? tp('duration.hours', h) : ''].filter(Boolean).join(' ') : h > 0 ? `${tp('duration.hours', h)} ${tp('duration.minutes', m)}` : tp('duration.minutes', m)
  return t('duration.resetIn', { duration: parts })
}

export const register: Register = (on, options) => {
  // The lines under tool results and at the end of a turn: off with the `liveTranscript` option of /config.
  const live = options.liveTranscript !== false

  on('session.start', async ($, e, next) => {
    await configurePanelLocale($)
    await $.command.register({
      name: 'panel',
      description: t('command.panelDescription'),
    })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    await toggle($)

    return { text: t('command.panelToggled') }
  })

  // Keep the figures fresh: the engine raises this whenever context, quota or cost moves.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, usage, () =>
      snapshot({ startedAt: 0, context: e.context, rateLimits: e.rateLimits, cost: e.cost }, now),
    )
    // The breakdown costs a local estimate: only while someone can see it.
    if (e.changed.includes('context') && (await isPaneOpen($))) await refresh($)

    return next(e)
  })

  // ecotokens writes its rows from the tool hooks and the prompt router.
  // A call made in an agent's loop (`e.agentId`) counts on that agent's row.
  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const id = e.agentId
    if (id) await changeAgent($, id, rows => recordToolUse(rows, id, String(e.tool)))
    // A Bash run in the background or a Monitor starts a task; TaskStop stops one.
    if (!ran.deny && !ran.isError) {
      const now = await $.clock.now()
      const task = taskFromCall(String(e.tool), e as Record<string, unknown>, ran.result, now, id)
      if (task) await changeTasks($, tasks => recordTaskStart(tasks, task))
      const stopped = e.tool === 'TaskStop' ? (ran.result as { task_id?: unknown } | undefined)?.task_id : undefined
      if (typeof stopped === 'string') await changeTasks($, (tasks, _s, at) => recordTaskStop(tasks, stopped, at))
    }
    await refreshEcoIfShown($)
    if (live && !ran.deny && !ran.isError) await trackEcoCall($, e, startedAt)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // In a subagent's or a teammate's loop, each run is one turn: what it cost and how it ended.
    const id = e.agentId
    if (id) await changeAgent($, id, (rows, now) => recordTurn(rows, { ...e, agentId: id }, now))
    await refreshAgentsIfShown($)
    await refreshEcoIfShown($)
    if (live) await matchEco($)
    if (live && !id) await logEcoTurn($, e.usage)
    if (live && id) await logDelegation($, id, e.usage)
    const shown = await read($, tab)
    if (shown === 'session' && (await isPaneOpen($))) await refreshHandoff($)
    if (shown === 'watch' && (await isPaneOpen($))) await refreshWatch($)
    if (shown === 'gain' && (await isPaneOpen($))) await refreshGain($)

    return done
  })

  // The classic Stop events carry the background work still in flight: the main loop's and a subagent's.
  on('classic.Stop', async ($, e, next) => {
    const done = await next(e)
    await reconcileInFlight($, e.background_tasks)

    return done
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const done = await next(e)
    await reconcileInFlight($, e.background_tasks)

    return done
  })

  // Each subagent or teammate the session starts: its id, its model and when it started.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (id) {
      const now = await $.clock.now()
      await update($, agents, s => ({
        rows: recordSpawn(s?.rows ?? [], e, { agentId: id, model: started.model }, now),
        tasks: s?.tasks,
        error: s?.error,
        measuredAt: now,
      }))
      await refreshAgentsIfShown($)
    }

    return started
  })

  if (live) {
    // Under a tool result, what ecotokens saved on that call.
    on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
      const mark = await read($, memberOf(ecoMark, e))
      if (!mark) return next(e)
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {await next(e)}
          <Text dimColor>{`  ${await ecoMarkLine($, mark)}`}</Text>
        </Box>
      )
    })

    // A folded run of calls draws no result of its own: one line for what ecotokens saved on the run.
    on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
      if (e.props.isExpanded) return next(e)
      const marks: EcoMark[] = []
      for (const call of e.props.calls) {
        const mark = call.tool_use_id ? await read($, memberOf(ecoMark, { requestId: call.tool_use_id })) : null
        if (mark) marks.push(mark)
      }
      if (marks.length === 0) return next(e)
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {await next(e)}
          <Text dimColor>{`  ${await ecoGroupLine($, marks)}`}</Text>
        </Box>
      )
    })
  }

  // The footer button, beside the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const modes = e.props.modes

    return (
      <Box flexDirection="row" gap={1}>
        {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
        <Button key="toggle" plain dimColor label="◧ ecotokens-panel" onPress={() => void toggle($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, tab)
    const u = await read($, usage)
    const c = await read($, context)
    const log = await read($, eco)
    const handoffState = await read($, handoff)
    const watchState = await read($, watch)
    const gainState = await read($, gain)
    const modelName = await read($, model)
    const currentEffort = await read($, effort)
    const efforts = (await read($, effortOptions)) ?? EFFORTS
    // Read only while shown: each tool call of an agent changes it, and the other tabs need no redraw.
    const agentsState = current === 'agents' ? await read($, agents) : null
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const home = await homeDirectory($)
    const width = Math.max(10, e.props.bodyColumns - 2)
    const barWidth = Math.max(8, width - 8)

    const tabBar = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {TABS.map((tabItem, i) => (
          <Button
            key={`tab-${tabItem.id}`}
            hotkey={String(i + 1)}
            variant={tabItem.id === current ? 'primary' : 'secondary'}
            label={t(tabItem.labelKey)}
            onPress={async () => {
              await update($, tab, () => tabItem.id)
              if (tabItem.id === 'eco') await refreshEco($)
              if (tabItem.id === 'watch') await refreshWatch($)
              if (tabItem.id === 'gain') await refreshGain($)
              if (tabItem.id === 'agents') {
                await refreshAgents($)
                watchAgents($)
              }
            }}
          />
        ))}
        <Box flexGrow={1} />
        <Button
          key="refresh"
          plain
          dimColor
          label="↻"
          onPress={async () => {
            await refresh($)
            if (current === 'gain') await refreshGain($)
            if (current === 'agents') watchAgents($)
          }}
        />
        <Button key="close" role="dismiss" plain dimColor label="✕" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )

    const meter = (label: string, percent: number | undefined, detail: string) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{label}</Text>
          <Text color={percent === undefined ? undefined : levelColor(percent)}>
            {percent === undefined ? '—' : formatPercent(percent, 100)}
          </Text>
        </Box>
        <Box flexDirection="row">
          {cells(percent ?? 0, barWidth).map(c =>
            c.isFilled ? <Text color={c.color}>━</Text> : <Text dimColor>─</Text>,
          )}
        </Box>
        {detail !== '' && <Text dimColor>{detail}</Text>}
      </Box>
    )

    const usageSection = () => {
      if (!u) return <Text dimColor>{t('panel.noneMeasurement')}</Text>
      const ctxDetail =
        u.contextTokens === undefined
          ? t('panel.beforeFirstReply', { tokens: kTokens(u.contextWindow), unit: t('unit.tokens') })
          : t('panel.contextTokens', { used: kTokens(u.contextTokens), total: kTokens(u.contextWindow), unit: t('unit.tokens') })

      return (
        <Box flexDirection="column">
          <Text color="claude" bold>
            {t('panel.contextWindow')}
          </Text>
          {meter(t('panel.used'), u.contextPercent, ctxDetail)}

          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Text color="claude" bold>
              {t('panel.subscriptionQuota')}
            </Text>
            {u.costUsd !== undefined && <Text dimColor>{t('panel.apiEquivalentCost', { amount: formatUsd(u.costUsd) })}</Text>}
          </Box>
          {u.rateLimits.length === 0 ? (
            <Box marginBottom={1}>
              <Text dimColor>{t('panel.noQuotaMeasurement')}</Text>
            </Box>
          ) : (
            u.rateLimits.map(r =>
              meter(WINDOW_LABELS[r.kind] ? t(WINDOW_LABELS[r.kind]!) : r.kind, r.percentUsed, untilReset(r.resetsAt, now)),
            )
          )}
        </Box>
      )
    }

    // `h` is the JSX factory (tsconfig `jsxFactory`): never name a variable `h` where JSX is drawn.
    const handoffPanel = () => {
      const hs = handoffState
      if (!hs) return <Text dimColor>{t('panel.handoffUnreadable')}</Text>
      const setup = hs.hookInstalled && hs.skillsInstalled ? t('panel.handoffSetupReady') : t('panel.handoffSetupIncomplete')

      return (
        <Box flexDirection="column">
          {line(t('panel.state'), hs.enabled ? t('panel.enabled') : t('panel.disabled'), hs.enabled ? 'success' : undefined)}
          <Text dimColor>{setup}</Text>
          {line(t('panel.here'), t('panel.handoffCounts', { pending: formatNumber(hs.pending), consumed: formatNumber(hs.consumed) }))}
          <Text dimColor>
            {t('panel.handoffRetention', {
              hours: formatNumber(hs.staleHours),
              chars: formatNumber(hs.maxChars),
              days: formatNumber(hs.retentionDays),
              injections: tp('count.injections', hs.injections),
            })}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {hs.entries.length === 0 ? (
              <Text dimColor>{t('panel.noHandoffs')}</Text>
            ) : (
              hs.entries.map(en => {
                const status = en.status === 'pending' ? t('handoff.status.pending') : en.status === 'consumed' ? t('handoff.status.consumed') : en.status

                return (
                  <Box flexDirection="column">
                    {line(
                      `${en.id.slice(0, 8)}${en.id === sessionId ? ` ${t('panel.thisSession')}` : ''}`,
                      `${ageLabel(en.ageHours)} · ${status}${en.stale ? ` ${t('panel.stale')}` : ''}`,
                      en.status === 'pending' ? 'success' : undefined,
                      en.status !== 'pending',
                    )}
                    <Text dimColor wrap="truncate-end">
                      {en.objective || '—'}
                    </Text>
                  </Box>
                )
              })
            )}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button
              key="handoff-toggle"
              hotkey="h"
              variant={hs.enabled ? 'secondary' : 'primary'}
              label={hs.enabled ? t('panel.disable') : t('panel.enable')}
              onPress={() =>
                void runHandoff(
                  $,
                  handoffToggle(!hs.enabled),
                  hs.enabled ? t('toast.handoffDisabled') : t('toast.handoffEnabled'),
                )
              }
            />
            <Button
              key="handoff-write"
              variant="secondary"
              label="Handoff (/handoff)"
              onPress={() => void runHandoffSkill($)}
            />
          </Box>
        </Box>
      )
    }

    // The handoff panel is a bonus: if it cannot be drawn, the rest of the tab still is.
    const safeHandoffPanel = () => {
      try {
        return handoffPanel()
      } catch {
        return <Text dimColor>{t('panel.handoffDisplayFailed')}</Text>
      }
    }

    // A row of buttons: the primary one is the current value, the others light up under the pointer.
    const choice = (
      title: string,
      values: readonly string[],
      current: string | null | undefined,
      command: 'model' | 'effort',
    ) => (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
        {section(title)}
        {values.map(v => (
          <Button
            key={`${command}-${v}`}
            variant={v === current ? 'primary' : 'secondary'}
            label={v}
            hover={{ scope: `${command}-${v}`, color: 'claude', bold: true, underline: true }}
            onPress={() => void runSetting($, command, v)}
          />
        ))}
      </Box>
    )

    // Model and effort of the session: /model and /effort run as if typed.
    const settingsZone = () => {
      const currentModel = modelName
      const alias = MODELS.find(m => currentModel?.toLowerCase().includes(m.toLowerCase()))
      return (
        <Box flexDirection="column" gap={1}>
          {choice(t('panel.model'), MODELS, alias, 'model')}
          {choice(t('panel.effort'), efforts, currentEffort, 'effort')}
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
              {section(t('panel.ultracode'))}
              <Button
                key="ultracode-enable"
                variant="secondary"
                label={t('panel.enable')}
                onPress={() => void runUltracode($, true)}
              />
              <Button
                key="ultracode-disable"
                variant="secondary"
                label={t('panel.disable')}
                onPress={() => void runUltracode($, false)}
              />
            </Box>
            <Text dimColor>{t('panel.ultracodeHint')}</Text>
          </Box>
          {currentModel && <Text dimColor wrap="truncate-end">{currentModel}</Text>}
        </Box>
      )
    }

    const sessionTab = () => (
      <Box flexDirection="column" gap={1}>
        {settingsZone()}
        {usageSection()}
        <Box flexDirection="column">
          {section(t('panel.handoff'))}
          {safeHandoffPanel()}
        </Box>
      </Box>
    )

    const section = (title: string) => (
      <Text color="claude" bold>
        {title}
      </Text>
    )

    const line = (label: string, value: string, color?: string, dim?: boolean) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={color} dimColor={dim} wrap="truncate-end">
          {label}
        </Text>
        <Text dimColor={dim}>{value}</Text>
      </Box>
    )

    const contextTab = () => {
      if (!c) return <Text dimColor>{t('panel.noContextDetail')}</Text>
      const used = c.categories.filter(r => r.kind === 'used')
      const reserved = c.categories.filter(r => r.kind !== 'used' && r.kind !== 'deferred')
      const deferred = c.categories.filter(r => r.kind === 'deferred')
      const toCompact =
        c.isAutoCompactEnabled && c.autoCompactThreshold !== undefined
          ? Math.max(0, c.autoCompactThreshold - c.totalTokens)
          : undefined

      return (
        <Box flexDirection="column">
          {meter(c.model, c.percentage, t('panel.contextTokens', { used: kTokens(c.totalTokens), total: kTokens(c.maxTokens), unit: t('unit.tokens') }))}
          <Box marginBottom={1}>
            <Text dimColor>
              {toCompact === undefined
                ? t('panel.autoCompactDisabled')
                : t('panel.autoCompactAt', { threshold: kTokens(c.autoCompactThreshold ?? 0), remaining: kTokens(toCompact) })}
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            {c.grid.map(row => (
              <Box flexDirection="row" gap={1}>
                {row.map(q => (
                  <Text color={q.color} dimColor={!q.isFilled}>
                    {square(q.fullness, q.isFilled)}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>

          {section(t('panel.distribution'))}
          <Box flexDirection="column" marginBottom={1}>
            {[...used, ...reserved].map(r =>
              line(`● ${r.name}`, `${kTokens(r.tokens)} · ${pct(r.tokens, c.maxTokens)}`, r.color, r.kind !== 'used'),
            )}
            {deferred.map(r => line(`○ ${r.name} ${t('panel.onDemand')}`, kTokens(r.tokens), undefined, true))}
          </Box>

          {c.api && (
            <Box flexDirection="column" marginBottom={1}>
              {section(t('panel.lastRequest'))}
              {line(t('panel.cacheRead'), kTokens(c.api.cacheRead))}
              {line(t('panel.cacheWrite'), kTokens(c.api.cacheWrite))}
              {line(t('panel.uncachedInput'), kTokens(c.api.input))}
              {line(t('panel.output'), kTokens(c.api.output))}
            </Box>
          )}

          {c.memoryFiles.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {section(t('panel.memoryFiles'))}
              {c.memoryFiles.slice(0, 8).map(f => line(shortPath(f.path, home), kTokens(f.tokens)))}
            </Box>
          )}

          {c.mcpServers.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {section(t('panel.mcpServers'))}
              {c.mcpServers.map(s =>
                line(`${s.server} (${formatNumber(s.loaded)}/${formatNumber(s.tools)} ${t('panel.tools')})`, s.loaded > 0 ? kTokens(s.tokens) : '—', undefined, s.loaded === 0),
              )}
            </Box>
          )}

          <Box flexDirection="column">
            {section(t('panel.other'))}
            {c.skills && line(t('panel.skillsListed', { included: formatNumber(c.skills.included), total: formatNumber(c.skills.total) }), kTokens(c.skills.tokens))}
            {c.agents.count > 0 && line(`${t('panel.agents')} (${formatNumber(c.agents.count)})`, kTokens(c.agents.tokens))}
          </Box>
        </Box>
      )
    }

    const ecoTab = () => {
      if (!log) return <Text dimColor>{t('panel.ecoNoMeasurement')}</Text>

      const setup = log.setup
      const setupDetails = setup && (
        <Box flexDirection="column" marginBottom={1}>
          {!setup.metricsAvailable && (
            <Text color="yellow" wrap="truncate-end">{t('setup.metricsMissing', { path: setup.metricsPath })}</Text>
          )}
          {!setup.configAvailable && (
            <Text dimColor wrap="truncate-end">{t('setup.configMissing', { path: setup.configPath })}</Text>
          )}
          {!setup.priceConfigured && (
            <Text dimColor wrap="truncate-end">{t('setup.priceMissing')}</Text>
          )}
        </Box>
      )
      if (log.error) {
        return (
          <Box flexDirection="column">
            {setupDetails}
            <Text color="error">{t('panel.readFailed', { reason: log.error })}</Text>
            <Text dimColor>{t('setup.readHelp')}</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {setupDetails}
          <Box marginBottom={1}>
            <Text dimColor>
              {t('panel.ecoSessionSummary', { saved: kTokens(log.totalSaved), filtered: formatNumber(log.totalFiltered), unit: t('unit.tokens') })}
            </Text>
          </Box>

          {section(t('panel.latestSavings'))}
          <Box flexDirection="column" marginBottom={1}>
            {log.savings.length === 0 && <Text dimColor>{t('panel.noneYet')}</Text>}
            {log.savings.map(g => (
              <Box flexDirection="column" marginBottom={1}>
                  {line(t('panel.savingTokens', { tokens: kTokens(g.before - g.after), percent: formatNumber(Math.round(g.pct)), unit: t('unit.tokens') }), clock(g.at), 'success')}
                <Text wrap="truncate-end">{g.what}</Text>
                <Text dimColor wrap="truncate-end">
                  {g.how}
                </Text>
              </Box>
            ))}
          </Box>

          {section(t('panel.latestJevCalls'))}
          <Box flexDirection="column">
            {log.jev.length === 0 && <Text dimColor>{t('panel.noneYet')}</Text>}
            {log.jev.map(j => (
              <Box flexDirection="column" marginBottom={1}>
                {line(`${j.ok ? '✓' : '✗'} ${j.title}`, clock(j.at), j.ok ? 'success' : 'error')}
                <Text wrap="truncate-end">{j.what}</Text>
                <Text dimColor wrap="truncate-end">
                  {j.error ? `${j.error} · ` : ''}
                  {formatNumber(j.latencyMs)} ms {t('panel.jevCost', { input: kTokens(j.inputTokens), output: kTokens(j.outputTokens), unit: t('unit.tokens') })}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const gainRow = (r: { name: string; count: number; before: number; after: number }, label: string) =>
      line(label, `−${kTokens(r.before - r.after)} · ${pct(r.before - r.after, r.before)} · ${formatNumber(r.count)}×`)

    const gainTab = () => {
      const gs = gainState
      const period = gs?.period ?? 'today'
      const periods = (
        <Box flexDirection="row" gap={1}>
          {GAIN_PERIODS.map(p => (
            <Button
              key={`period-${p.id}`}
              variant={p.id === period ? 'primary' : 'secondary'}
              label={t(p.labelKey)}
              onPress={async () => {
                await update($, gainPeriod, () => p.id)
                await refreshGain($)
              }}
            />
          ))}
        </Box>
      )
      if (!gs) return <Box flexDirection="column" gap={1}>{periods}<Text dimColor>{t('panel.ecoNoMeasurement')}</Text></Box>
      const g = gs.gain
      const j = gs.jev

      return (
        <Box flexDirection="column" gap={1}>
          {periods}
          {gs.project && (
            <Text dimColor wrap="truncate-start">
              {t('panel.workspace')}: {shortPath(gs.project, home)}
            </Text>
          )}

          <Box flexDirection="column">
            {section(t('panel.gainTitle'))}
            {gs.gainError && <Text color="error">{t('panel.readFailed', { reason: gs.gainError })}</Text>}
            {g && (
              <Box flexDirection="column">
                {meter(t('panel.tokensSaved'), Math.round(g.savingsPct), t('panel.savedOfTotal', { saved: kTokens(g.before - g.after), total: kTokens(g.before), count: formatNumber(g.interceptions) }))}
                <Text dimColor>{t('panel.costAvoided', { amount: formatUsd(g.costAvoidedUsd) })}</Text>
                {g.families.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>{t('panel.byFamily')}</Text>
                    {g.families.slice(0, 6).map(r => gainRow(r, familyLabel(r.name)))}
                  </Box>
                )}
              </Box>
            )}
          </Box>

          <Box flexDirection="column">
            {section(t('panel.jevTitle'))}
            {gs.jevError && <Text color="error">{t('panel.readFailed', { reason: gs.jevError })}</Text>}
            {j && (
              <Box flexDirection="column">
                {line(t('panel.calls'), t('panel.callsSummary', { calls: formatNumber(j.calls), successful: formatNumber(j.ok), fallbacks: tp('count.fallbacks', j.fallbacks) }), j.ok < j.calls ? 'warning' : undefined)}
                {line(t('panel.cost'), `${formatUsd(j.costUsd, 4)} · ${kTokens(j.inputTokens)} → ${kTokens(j.outputTokens)}`)}
                {line(t('panel.latency'), t('panel.averageLatency', { average: formatNumber(j.avgLatencyMs), p95: formatNumber(j.p95LatencyMs) }))}
                {j.timeline.length > 0 && (
                  <Text color="claude" wrap="truncate-start">
                    {sparkline(j.timeline, width)}
                  </Text>
                )}
                {j.purposes.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>{t('panel.byPurpose')}</Text>
                    {j.purposes.map(p =>
                      line(
                        purposeLabel(p.name),
                        `${formatNumber(p.calls)}× · ${formatNumber(p.avgLatencyMs)} ms`,
                        p.ok < p.calls ? 'warning' : undefined,
                      ),
                    )}
                  </Box>
                )}
                {j.errors.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>{t('panel.errors')}</Text>
                    {j.errors.map(e => line(e.kind, `${formatNumber(e.count)}×`, 'error'))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    const watchTab = () => {
      const ws = watchState
      if (!ws) return <Text dimColor>{t('panel.watchUnreadable')}</Text>
      const cur = ws.current

      return (
        <Box flexDirection="column">
          {section(t('panel.thisFolder'))}
          <Text dimColor wrap="truncate-start">
            {shortPath(ws.cwd, home)}
          </Text>
          {line(t('panel.state'), cur ? t('panel.running') : t('panel.stopped'), cur ? 'success' : undefined)}
          {cur && (
            <Text dimColor>
              PID {cur.pid === undefined ? '—' : formatNumber(cur.pid)} · {tp('count.sessions', cur.sessions)}
              {cur.startedAt ? ` ${t('panel.since', { time: clock(cur.startedAt) })}` : ''}
            </Text>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button
              key="watch-toggle"
              hotkey="w"
              variant={cur ? 'secondary' : 'primary'}
              label={cur ? t('panel.stop') : t('panel.start')}
              onPress={() => void runWatch($, !cur)}
            />
          </Box>

          {cur && (
            <Box flexDirection="column" marginTop={1}>
              {section(t('panel.log'))}
              {ws.log.length === 0 ? (
                <Text dimColor>{t('panel.noneYet')}</Text>
              ) : (
                ws.log.map(l => (
                  <Text dimColor wrap="truncate-end">
                    {shortenWatchedPath(l, ws.cwd)}
                  </Text>
                ))
              )}
            </Box>
          )}

          {ws.others.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {section(t('panel.otherWatchedFolders'))}
              {ws.others.map(o => line(shortPath(o.path, home), `PID ${o.pid === undefined ? '—' : formatNumber(o.pid)}`, undefined, true))}
            </Box>
          )}
        </Box>
      )
    }

    const agentRow = (r: AgentRow) => {
      const s = AGENT_STATUS[r.status] ?? AGENT_STATUS.pending
      const running = isActive(r.status)
      const kind = [
        r.name ? r.type : '',
        r.isTeammate ? t('panel.teammate') : r.isBackground ? t('panel.background') : '',
        r.model ? shortModel(r.model) : '',
      ]
      const facts = [
        elapsedLabel(r, now),
        `${tp('count.tools', r.toolUses)}${running && r.lastTool ? ` (${r.lastTool})` : ''}`,
        r.inputTokens + r.outputTokens > 0 ? `${kTokens(r.inputTokens)} → ${kTokens(r.outputTokens)} ${t('unit.tokens')}` : '',
        r.costUsd === undefined ? '' : costLabel(r.costUsd),
      ]

      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold={running} dimColor={!running && r.status !== 'idle'} wrap="truncate-end">
              {r.parentId ? '↳ ' : ''}
              {r.name ?? r.type}
            </Text>
            <Text color={s.color}>
              {s.glyph} {t(s.label)}
            </Text>
          </Box>
          <Text wrap="truncate-end">{r.description || '—'}</Text>
          {kind.some(Boolean) && (
            <Text dimColor wrap="truncate-end">
              {kind.filter(Boolean).join(' · ')}
            </Text>
          )}
          <Text dimColor wrap="truncate-end">
            {facts.filter(Boolean).join(' · ')}
          </Text>
        </Box>
      )
    }

    // A shell's or a monitor's command under its description; how it ended is not told, only that it did.
    const taskRow = (task: TaskRow) => {
      const s = TASK_STATUS[task.status] ?? TASK_STATUS.running
      const running = isTaskActive(task.status)
      const facts = [taskElapsedLabel(task, now), task.agentId ? t('panel.agentStartedTask') : '']

      return (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold={running} dimColor={!running} wrap="truncate-end">
              {taskKindLabel(task.kind)}
            </Text>
            <Text color={s.color}>
              {s.glyph} {t(s.label)}
            </Text>
          </Box>
          <Text wrap="truncate-end">{task.description || task.command || '—'}</Text>
          {task.description !== '' && task.command && (
            <Text dimColor wrap="truncate-end">
              $ {task.command}
            </Text>
          )}
          {facts.some(Boolean) && (
            <Text dimColor wrap="truncate-end">
              {facts.filter(Boolean).join(' · ')}
            </Text>
          )}
        </Box>
      )
    }

    const agentsTab = () => {
      const st = agentsState
      if (!st) return <Text dimColor>{t('panel.ecoNoMeasurement')}</Text>
      const tasks = st.tasks ?? []
      const active = st.rows.filter(r => isActive(r.status)).length + tasks.filter(t => isTaskActive(t.status)).length

      return (
        <Box flexDirection="column">
          {st.error && <Text color="error">{t('panel.agentListUnreadable', { reason: st.error })}</Text>}
          {st.rows.length === 0 && tasks.length === 0 ? (
            <Text dimColor>{t('panel.noAgentOrTask')}</Text>
          ) : (
            <Box flexDirection="column">
              <Box marginBottom={1}>
                <Text dimColor>
                  {t('panel.agentSummary', {
                    agents: tp('count.agents', st.rows.length),
                    tasks: tp('count.tasks', tasks.length),
                    active: tp('count.active', active),
                  })}
                </Text>
              </Box>
              {section('Agents')}
              {st.rows.length === 0 ? (
                <Box marginBottom={1}>
                  <Text dimColor>{t('panel.noAgents')}</Text>
                </Box>
              ) : (
                st.rows.map(agentRow)
              )}
              {section(t('panel.backgroundTasks'))}
              {tasks.length === 0 ? <Text dimColor>{t('panel.noBackgroundTasks')}</Text> : tasks.map(taskRow)}
            </Box>
          )}
        </Box>
      )
    }

    const drawTab = () => {
      switch (current) {
        case 'agents':
          return agentsTab()
        case 'watch':
          return watchTab()
        case 'gain':
          return gainTab()
        case 'session':
          return sessionTab()
        case 'context':
          return contextTab()
        case 'eco':
          return ecoTab()
      }
    }

    // $.state outlives a reload: a value saved by an older version may lack a field. A tab that
    // cannot be drawn says so, and the tab bar stays usable.
    const safeTab = () => {
      try {
        return drawTab()
      } catch (error) {
        return <Text color="error">{t('panel.renderFailed', { reason: message(error) })}</Text>
      }
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabBar}
        {safeTab()}
      </Box>
    )
  })
}
