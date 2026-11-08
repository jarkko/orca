import type * as NodeOs from 'node:os'
import type * as ProcessSnapshots from '../../shared/process-table-snapshot-reader'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverClaudeAccountMoveSessions } from './claude-account-move-processes'

let root: string
vi.mock('node:os', async (original) => ({
  ...(await original<typeof NodeOs>()),
  homedir: () => root
}))
vi.mock('../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => ({
    userConfigDir: () => join(root, '.claude'),
    accountHomes: () => [join(root, 'profile')]
  }),
  claudeProfileHistoryDirs: () => []
}))
vi.mock('../ipc/pty/provider/registry', () => ({
  localProvider: {
    listProcesses: async () => [
      { id: 'pty-a', rootProcessId: 100 },
      { id: 'pty-b', rootProcessId: 200 },
      { id: 'pty-reused', rootProcessId: 300 },
      { id: 'pty-fork', rootProcessId: 400 }
    ]
  }
}))
vi.mock('../../shared/process-table-snapshot-reader', async (original) => ({
  ...(await original<typeof ProcessSnapshots>()),
  getFreshProcessTableSnapshot: async () => [
    { pid: 100, ppid: 1, stat: 'S', command: 'zsh', startTime: 'root-a' },
    { pid: 101, ppid: 100, stat: 'S', command: 'claude', startTime: 'birth-a' },
    { pid: 200, ppid: 1, stat: 'S', command: 'zsh', startTime: 'root-b' },
    { pid: 201, ppid: 200, stat: 'S', command: 'claude', startTime: 'birth-b' },
    { pid: 300, ppid: 1, stat: 'S', command: 'zsh', startTime: 'root-c' },
    { pid: 301, ppid: 300, stat: 'S', command: 'claude', startTime: 'new-birth' },
    { pid: 400, ppid: 1, stat: 'S', command: 'zsh', startTime: 'root-fork' },
    {
      pid: 401,
      ppid: 400,
      stat: 'S',
      command:
        'claude --resume 11111111-1111-4111-8111-111111111111 --fork-session --session-id 44444444-4444-4444-8444-444444444444',
      startTime: 'birth-fork'
    }
  ]
}))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-claude-move-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it.skipIf(process.platform === 'win32')(
  'recovers distinct conversations in the same folder and rejects a reused PID record',
  async () => {
    const home = join(root, '.claude')
    await mkdir(join(home, 'sessions'), { recursive: true })
    await mkdir(join(home, 'projects', 'same-folder'), { recursive: true })
    await Promise.all([
      writeFile(
        join(home, 'sessions', '101.json'),
        JSON.stringify({
          pid: 101,
          pidDomain: process.platform,
          procStart: 'birth-a',
          sessionId: '11111111-1111-4111-8111-111111111111',
          cwd: '/same/folder',
          status: 'idle',
          statusUpdatedAt: 10
        })
      ),
      writeFile(
        join(home, 'sessions', '201.json'),
        JSON.stringify({
          pid: 201,
          pidDomain: process.platform,
          procStart: 'birth-b',
          sessionId: '22222222-2222-4222-8222-222222222222',
          cwd: '/same/folder',
          status: 'busy',
          statusUpdatedAt: 20
        })
      ),
      writeFile(
        join(home, 'sessions', '301.json'),
        JSON.stringify({
          pid: 301,
          pidDomain: process.platform,
          procStart: 'old-birth',
          sessionId: '33333333-3333-4333-8333-333333333333',
          status: 'idle'
        })
      ),
      writeFile(
        join(home, 'projects', 'same-folder', '11111111-1111-4111-8111-111111111111.jsonl'),
        ''
      ),
      writeFile(
        join(home, 'projects', 'same-folder', '22222222-2222-4222-8222-222222222222.jsonl'),
        ''
      )
    ])

    await writeFile(
      join(home, 'projects', 'same-folder', '44444444-4444-4444-8444-444444444444.jsonl'),
      ''
    )
    const sessions = await discoverClaudeAccountMoveSessions([
      'pty-a',
      'pty-b',
      'pty-reused',
      'pty-fork'
    ])

    expect(
      sessions.map(({ ptyId, providerSession, state }) => ({
        ptyId,
        session: providerSession.id,
        state
      }))
    ).toEqual([
      { ptyId: 'pty-a', session: '11111111-1111-4111-8111-111111111111', state: 'done' },
      { ptyId: 'pty-b', session: '22222222-2222-4222-8222-222222222222', state: 'working' },
      { ptyId: 'pty-fork', session: '44444444-4444-4444-8444-444444444444', state: 'working' }
    ])
  }
)

it.skipIf(process.platform === 'win32')(
  'uses the current same-process declaration rather than a copied registry record',
  async () => {
    for (const [home, id, updatedAt] of [
      ['.claude', '11111111-1111-4111-8111-111111111111', 10],
      ['profile', '55555555-5555-4555-8555-555555555555', 20]
    ] as const) {
      await mkdir(join(root, home, 'sessions'), { recursive: true })
      await mkdir(join(root, home, 'projects', 'project'), { recursive: true })
      await writeFile(
        join(root, home, 'sessions', '101.json'),
        JSON.stringify({
          pid: 101,
          pidDomain: process.platform,
          procStart: 'birth-a',
          sessionId: id,
          status: 'idle',
          statusUpdatedAt: updatedAt
        })
      )
      await writeFile(join(root, home, 'projects', 'project', `${id}.jsonl`), '')
    }

    const sessions = await discoverClaudeAccountMoveSessions(['pty-a'])

    expect(sessions.map(({ providerSession }) => providerSession.id)).toEqual([
      '55555555-5555-4555-8555-555555555555'
    ])
  }
)
