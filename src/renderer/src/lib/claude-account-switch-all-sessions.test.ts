import type * as AccountMove from './claude-session-account-move'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../shared/constants'
import {
  findClaudeSwitchSessions,
  findQueuedClaudeRestartsOnAccount
} from './claude-session-account-move'
import {
  handleRunningClaudeSessionsAfterSwitch,
  resetClaudeAccountSwitchSessionsForTests
} from './claude-account-switch-sessions'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }))
vi.mock('./claude-session-account-move', async (original) => ({
  ...(await original<typeof AccountMove>()),
  findClaudeSwitchSessions: vi.fn(),
  findQueuedClaudeRestartsOnAccount: vi.fn(() => [])
}))
const ROSTER = { accounts: [], activeAccountId: null }
const SWITCH = {
  owner: { kind: 'local' as const },
  target: { runtime: 'host' as const },
  before: { state: ROSTER, accountId: 'a' },
  after: { state: ROSTER, accountId: 'b' }
}
const pane = { worktreeId: 'wt1', tabId: 'tab-1', leafId: 'leaf-1', ptyId: 'pty-1' }

describe('switching all Claude accounts', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/home/dev'),
        claudeAccountSwitchRunningSessions: 'restart'
      }
    })
    resetClaudeAccountSwitchSessionsForTests()
    vi.mocked(findQueuedClaudeRestartsOnAccount).mockReturnValue([])
  })

  it('retries an explicit move to the already-selected account despite the keep preference', async () => {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/home/dev'), claudeAccountSwitchRunningSessions: 'keep' }
    })
    vi.mocked(findClaudeSwitchSessions).mockResolvedValue({
      onAccount: [],
      elsewhere: [{ ...pane, accountId: null }],
      cantMove: []
    })

    await handleRunningClaudeSessionsAfterSwitch({
      ...SWITCH,
      before: SWITCH.after,
      restartAll: true
    })

    expect(useAppStore.getState().pendingPaneAccountRestarts).toEqual({ 'pty-1': 'claude' })
  })

  it('queues sessions elsewhere even when none remain on the outgoing account', async () => {
    vi.mocked(findClaudeSwitchSessions).mockResolvedValue({
      onAccount: [],
      elsewhere: [{ ...pane, accountId: null }],
      cantMove: []
    })

    await handleRunningClaudeSessionsAfterSwitch(SWITCH)

    expect(useAppStore.getState().pendingPaneAccountRestarts).toEqual({ 'pty-1': 'claude' })
  })
})
