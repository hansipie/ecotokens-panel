import type { HandoffEntry, HandoffState } from '../types'

// ecotokens' session handoff: `ecotokens handoff status --json` reports it,
// `on` / `off` install or remove its hook and skills. Saving a state is the `/handoff` skill's job
// (`write`, then `set` with the model's fields): the panel runs that command, never `write` alone.
export const HANDOFF_STATUS = ['ecotokens', 'handoff', 'status', '--json']

// `list` has no --cwd: it reads the directory the process runs in, so the caller sets `cwd`.
export const HANDOFF_LIST = ['ecotokens', 'handoff', 'list', '--json']

export function handoffToggle(enable: boolean) {
  return ['ecotokens', 'handoff', enable ? 'on' : 'off']
}

type StatusJson = {
  enabled?: unknown
  hook_installed?: unknown
  skills_installed?: unknown
  pending?: unknown
  consumed?: unknown
  stale_hours?: unknown
  max_chars?: unknown
  retention_days?: unknown
  inject_startup?: unknown
  injections?: { count?: unknown }
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

export function parseHandoff(stdout: string, now: number): HandoffState {
  const j = JSON.parse(stdout) as StatusJson
  if (typeof j.enabled !== 'boolean') throw new Error('réponse inattendue de ecotokens handoff status')

  return {
    enabled: j.enabled,
    hookInstalled: j.hook_installed === true,
    skillsInstalled: j.skills_installed === true,
    pending: num(j.pending),
    consumed: num(j.consumed),
    staleHours: num(j.stale_hours),
    maxChars: num(j.max_chars),
    retentionDays: num(j.retention_days),
    injectStartup: j.inject_startup === true,
    injections: num(j.injections?.count),
    entries: [],
    measuredAt: now,
  }
}

type ListJson = { id?: unknown; age_hours?: unknown; status?: unknown; objective?: unknown; stale?: unknown; cwd?: unknown }

// One line, for a row: newlines folded, cut at `max` characters.
export function oneLine(text: string, max = 80) {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// Rows for `cwd` only (a row without a cwd is kept), the newest first as ecotokens lists them.
export function parseHandoffList(stdout: string, cwd?: string): HandoffEntry[] {
  const rows = JSON.parse(stdout) as unknown
  if (!Array.isArray(rows)) throw new Error('réponse inattendue de ecotokens handoff list')

  return (rows as ListJson[])
    .filter(r => typeof r?.id === 'string' && (cwd === undefined || typeof r.cwd !== 'string' || r.cwd === cwd))
    .map(r => ({
      id: r.id as string,
      ageHours: num(r.age_hours),
      status: typeof r.status === 'string' ? r.status : '?',
      stale: r.stale === true,
      objective: typeof r.objective === 'string' ? oneLine(r.objective) : '',
    }))
}
