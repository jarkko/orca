import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getFreshProcessTableSnapshot } from '../../shared/process-table-snapshot-reader'
import { buildProcessTableIndex } from '../../shared/process-table-index'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-status/process/agent-process-recognition'
import { tokenizeStartupCommand } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import type { ClaudeAccountMoveSession } from '../../shared/claude-account-move-session'
import { readWindowsProcessTableFresh } from '../windows/windows-process-table'
import { localProvider } from '../ipc/pty/provider/registry'
import {
  claudeProfileHistoryDirs,
  getClaudeProfileRouter
} from '../claude-accounts/claude-profile-installed-router'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { resumeInvocationFromOptions } from '../native-chat/structured-agent-cli-conversations'
import { CLAUDE_CLI_CONVERSATIONS } from './claude-cli-conversations'

type ProcessSession = ClaudeAccountMoveSession & { recordUpdatedAt: number }

type ProcessRow = { pid: number; ppid: number; command: string; startTime?: string }
const SESSION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const CLAUDE_PROCESS_SESSION = z.object({
  pid: z.number().int().positive(),
  pidDomain: z.string(),
  procStart: z.union([z.string(), z.number()]),
  sessionId: z.string().regex(SESSION_ID),
  status: z.string(),
  statusUpdatedAt: z.number().nonnegative().optional(),
  updatedAt: z.number().nonnegative().optional()
})

async function processRows(): Promise<ProcessRow[]> {
  if (process.platform === 'win32') {
    return (await readWindowsProcessTableFresh()).map((row) => ({
      ...row,
      startTime: row.creationTimeMs === undefined ? undefined : String(row.creationTimeMs)
    }))
  }
  return (await getFreshProcessTableSnapshot()).filter((row) => !/[TZ]/.test(row.stat))
}

function sameStart(left: unknown, right: string | undefined): boolean {
  if ((typeof left !== 'string' && typeof left !== 'number') || !right) {
    return false
  }
  const a = String(left).trim().replace(/\s+/g, ' ')
  const b = right.trim().replace(/\s+/g, ' ')
  if (a === b) {
    return true
  }
  // Registry writers on Windows may use ISO time instead of the native millisecond marker.
  return /^\d{13}$/.test(b) && Math.abs(Date.parse(a) - Number(b)) < 1000
}

async function readRegistrySession(home: string, row: ProcessRow): Promise<ProcessSession | null> {
  try {
    const text = await readFile(join(home, 'sessions', `${row.pid}.json`), 'utf8')
    if (text.length > 64 * 1024) {
      return null
    }
    const record = CLAUDE_PROCESS_SESSION.parse(JSON.parse(text))
    if (
      record.pid !== row.pid ||
      record.pidDomain !== process.platform ||
      !sameStart(record.procStart, row.startTime)
    ) {
      return null
    }
    const transcriptPath = await resolveSessionFilePath('claude', record.sessionId, {
      claudeProjectsDir: join(home, 'projects')
    })
    if (!transcriptPath) {
      return null
    }
    return {
      ptyId: '',
      providerSession: { key: 'session_id', id: record.sessionId, transcriptPath },
      state: record.status === 'idle' && record.statusUpdatedAt !== undefined ? 'done' : 'working',
      observedAt: typeof record.statusUpdatedAt === 'number' ? record.statusUpdatedAt : Date.now(),
      source: 'registry',
      recordUpdatedAt: Math.max(record.updatedAt ?? 0, record.statusUpdatedAt ?? 0)
    }
  } catch {
    return null
  }
}

async function recoverSession(
  row: ProcessRow,
  homes: string[]
): Promise<ClaudeAccountMoveSession | null> {
  const records = (await Promise.all(homes.map((home) => readRegistrySession(home, row))))
    .filter((record): record is ProcessSession => record !== null)
    .sort((left, right) => right.recordUpdatedAt - left.recordUpdatedAt)
  const current = records[0]
  if (current) {
    // Copies can retain an older declaration of this PID; compare identity clocks, not transcript mtimes.
    if (
      records.some(
        (record) =>
          record.recordUpdatedAt === current.recordUpdatedAt &&
          record.providerSession.id !== current.providerSession.id
      )
    ) {
      return null
    }
    const { recordUpdatedAt: _recordUpdatedAt, ...session } = current
    return session
  }
  const parsed = tokenizeStartupCommand(row.command, process.platform === 'win32' ? 'cmd' : 'posix')
  if (!parsed.ok) {
    return null
  }
  const terminator = parsed.tokens.indexOf('--')
  const args = (terminator === -1 ? parsed.tokens : parsed.tokens.slice(0, terminator)).map(
    (token) => token.toLowerCase()
  )
  const outputIds = args.filter(
    (token) => token === '--session-id' || token.startsWith('--session-id=')
  )
  if (outputIds.length > 1) {
    return null
  }
  // A fork writes the explicit output session, not the conversation named by --resume.
  const invocation =
    outputIds.length > 0
      ? resumeInvocationFromOptions(args, { targetless: [], markers: ['--session-id'] })
      : CLAUDE_CLI_CONVERSATIONS.sessionHistory?.parseResumeArgs(args)
  const id = invocation?.target
  if (!id || !SESSION_ID.test(id)) {
    return null
  }
  // An argv resume proves identity, not idleness; a subsequent hook must end the turn.
  const paths = await Promise.all(
    homes.map((home) =>
      resolveSessionFilePath('claude', id, { claudeProjectsDir: join(home, 'projects') })
    )
  )
  const matches = paths.filter((path): path is string => path !== null)
  if (matches.length !== 1) {
    return null
  }
  return {
    ptyId: '',
    providerSession: { key: 'session_id', id, transcriptPath: matches[0] },
    state: 'working',
    observedAt: Date.now(),
    source: 'argv'
  }
}

/** A batch owns one host process capture; only an outer Claude inside an attested local PTY may move. */
export async function discoverClaudeAccountMoveSessions(
  ptyIds: readonly string[]
): Promise<ClaudeAccountMoveSession[]> {
  if (ptyIds.length === 0) {
    return []
  }
  const [panes, rows] = await Promise.all([
    localProvider.listProcesses({ ptyIds, targetOwnerOnly: true }),
    processRows()
  ])
  const requested = new Set(ptyIds)
  const roots = new Map(
    panes
      .filter(
        (pane) => requested.has(pane.id) && !pane.exiting && !pane.wslDistro && pane.rootProcessId
      )
      .map((pane) => [pane.rootProcessId!, pane.id])
  )
  const index = buildProcessTableIndex(rows)
  const candidates = new Map<string, ProcessRow[]>()
  for (const row of rows) {
    if (recognizeAgentProcessFromCommandLine(row.command)?.agent !== 'claude') {
      continue
    }
    let cursor: ProcessRow | undefined = row
    const visited = new Set<number>()
    while (cursor && !visited.has(cursor.pid)) {
      visited.add(cursor.pid)
      const ptyId = roots.get(cursor.pid)
      if (ptyId) {
        candidates.set(ptyId, [...(candidates.get(ptyId) ?? []), row])
        break
      }
      cursor = index.byPid.get(cursor.ppid)
      if (cursor && recognizeAgentProcessFromCommandLine(cursor.command)?.agent === 'claude') {
        break
      }
    }
  }
  const router = getClaudeProfileRouter()
  const homes = [
    ...new Set(
      [
        router?.userConfigDir(),
        join(homedir(), '.claude'),
        ...(router?.accountHomes() ?? []),
        ...claudeProfileHistoryDirs('projects').map(dirname)
      ].filter((home): home is string => Boolean(home))
    )
  ]
  const found = await Promise.all(
    [...candidates].map(async ([ptyId, processes]) => {
      if (processes.length !== 1) {
        return null
      }
      const session = await recoverSession(processes[0], homes)
      return session ? { ...session, ptyId } : null
    })
  )
  return found.filter((session): session is ClaudeAccountMoveSession => session !== null)
}
