import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'ecotokens-panel',
  props: {
    title: 'ecotokens-panel',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the session tab shows context and quota once refreshed', async ($, on) => {
  const clock = mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  await clock.set(Date.parse('2098-12-31T22:00:00Z'))
  on('session.usage', async () => ({
  value: {
    startedAt: 0,
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 73, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 12.5 },
    ],
    cost: { usd: 1.234 },
  },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: /84\.0k \/ 200k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Session \(5 h\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^73%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /réinit. dans 2 h 0 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Semaine \(7 j\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the footer keeps the engine modes and adds the toggle button', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ecotokens-panel',
      surface,
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })
    expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('the context tab breaks the window down', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 60_000,
        window: 200_000,
        percent: 30,
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 57_000, color: 'permission', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 107_000, color: 'inactive', isDeferred: false, kind: 'free' },
            { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
            { name: 'MCP tools', tokens: 9_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
          ],
          totalTokens: 60_000,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          autocompactSource: 'auto',
          percentage: 30,
          gridRows: [[{ color: 'permission', isFilled: true, categoryName: 'Messages', tokens: 57_000, percentage: 29, squareFullness: 1 }]],
          model: 'claude-opus-5-5',
          memoryFiles: [{ path: '/var/home/hansi/.claude/CLAUDE.md', type: 'User', tokens: 1_200 }],
          mcpTools: [
            { name: 'mcp__godot__run_project', serverName: 'godot', tokens: 400, isLoaded: true },
            { name: 'mcp__godot__stop_project', serverName: 'godot', tokens: 300, isLoaded: false },
          ],
          agents: [],
          autoCompactThreshold: 167_000,
          isAutoCompactEnabled: true,
          apiUsage: { input_tokens: 10, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 58_000, output_tokens: 500 },
        },
      },
      rateLimits: [],
    },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'tab-context' })
    expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Auto-compactage à 167k · encore 107k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● Messages' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '57.0k · 28.5%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '~/.claude/CLAUDE.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'godot (1/2 outils)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⛁' })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    await ui.unmount()
  }
})

test('the ecotokens tab lists the session savings and Jev calls', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  on('session.usage', async () => ({
    value: { startedAt: Date.parse('2026-10-06T08:00:00Z'), context: { window: 200_000 }, rateLimits: [] },
  }))
  const queries: string[] = []
  on('process.run', async (_$, e) => {
    const sql = e.argv[4] ?? ''
    queries.push(`${e.argv[3]} ${sql}`)
    const rows = sql.includes('count(*)')
      ? [{ saved: 18_471, filtered: 20 }]
      : sql.includes('jev_calls')
        ? [
            { timestamp: '2026-10-06T09:16:27.735119961+00:00', purpose: 'router', agent: 'router-everyday', ok: 1, error_kind: null, http_status: null, latency_ms: 595, input_tokens: 564, output_tokens: 67, size: 'everyday', confidence: 0.89, followup_prob: 0.1 },
            { timestamp: '2026-10-06T09:10:00.000000000+00:00', purpose: 'filter_lines', agent: null, ok: 0, error_kind: 'timeout', http_status: 504, latency_ms: 5000, input_tokens: 0, output_tokens: 0, size: null, confidence: null, followup_prob: null },
          ]
        : [{ timestamp: '2026-10-06T09:06:20.043287756+00:00', command: 'Read /x/register.tsx', command_family: 'native_read', tokens_before: 1250, tokens_after: 75, savings_pct: 94, mode: 'filtered' }]

    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'tab-eco' })
    expect(queries.some(q => q.startsWith('/home/me/.config/ecotokens/metrics.db') && q.includes("timestamp >= '2026-10-06T08:00:00.000Z'"))).toBe(true)
    expect(queries.some(q => q.includes("git_root = '/home/me/proj'"))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /18\.5k tokens économisés sur 20/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '−1.2k tokens (94%)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Lecture du fichier register.tsx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sortie filtrée (lignes inutiles retirées) · 1250 → 75 tokens' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ Routage du message' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Message jugé courant (p=0.89) → délégué à router-everyday (Sonnet)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ Filtrage IA d’une sortie trop longue' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /timeout 504 · 5000 ms · coût Jev/ })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    await ui.unmount()
  }
})

test('the watch tab shows this directory\'s watcher and stops it', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  let running = true
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    const ok = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[2] === '--stop') {
      running = false
      return ok('')
    }
    if (e.argv[2] === '--status') {
      const map = {
        ...(running ? { '/home/me/proj': { sessions: 1, watcher_pid: 42, log_file: '/l/proj.log', started_at: '2026-10-06T10:24:13.6+00:00' } } : {}),
        '/home/me/other': { sessions: 1, watcher_pid: 43, log_file: '/l/other.log', started_at: 'x' },
      }
      return ok(JSON.stringify(map))
    }
    if (e.argv[0] === 'tail') return ok('[2026-10-06 10:20:48] /home/me/proj/src/a.ts re-indexed\n')
    return ok('', 1)
  })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-watch' })
  expect(await ui.find({ type: 'Text', text: 'en cours' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PID 42 · 1 session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /re-indexed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '~/other' })).toBeDefined()
  await ui.press({ key: 'watch-toggle' })
  expect(ran).toContain('ecotokens watch --stop --path /home/me/proj')
  expect(await ui.find({ type: 'Text', text: 'arrêté' })).toBeDefined()
  await ui.unmount()
})

test('the gains tab reads ecotokens gain and jev for this workspace over the chosen period', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    const ok = (body: unknown) => ({
      value: { exitCode: 0, stdout: JSON.stringify(body), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[1] === 'gain') {
      return ok({
        total_interceptions: 257, total_tokens_before: 136_867, total_tokens_after: 64_226, total_savings_pct: 53.07, cost_avoided_usd: 0.1462,
        by_family: { generic: { count: 197, tokens_before: 86_260, tokens_after: 52_298 } },
        by_project: {},
      })
    }
    if (e.argv[1] === 'jev') {
      return ok({
        calls: 62, ok: 62, fallbacks: 0, input_tokens: 127_211, output_tokens: 30_291, cost_usd: 0.0053, avg_latency_ms: 520, p95_latency_ms: 1191,
        by_purpose: { router: { calls: 58, ok: 58, avg_latency_ms: 512 } },
        errors: {},
        timeline: [1, 2, 3],
      })
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'non', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-gain' })
  expect(ran).toContain('ecotokens gain --period today --project /home/me/proj --json')
  expect(await ui.find({ type: 'Text', text: 'Workspace : ~/proj' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /72\.6k sur 137k · 257 sorties/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Coût évité : $0.15' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'generic' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62 · 62 réussis · 0 repli' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Routage des messages' })).toBeDefined()
  await ui.press({ key: 'period-week' })
  expect(ran).toContain('ecotokens jev --period week --project /home/me/proj --json')
  await ui.press({ key: 'tab-session' })
  await ui.unmount()
})

test('a tab whose saved state predates a field still draws', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  // A GainState saved before `project` existed.
  const saved: Record<string, unknown> = { tab: 'gain', gain: { period: 'today', measuredAt: 0, gainError: 'ancien' } }
  on('state.get', async (_$, e, next) =>
    e.plugin === 'ecotokens-panel' && e.key in saved ? { value: { value: saved[e.key] as never, version: 1 } } : next(e),
  )
  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'tab-gain' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ancien/ })).toBeDefined()
  await ui.unmount()
})
