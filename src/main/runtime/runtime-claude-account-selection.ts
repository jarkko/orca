import type { ClaudeAccountService } from '../claude-accounts/service'
import type {
  ClaudeAccountSelectionChange,
  ClaudeRateLimitAccountsState
} from '../../shared/managed-account-types'
import {
  getClaudeSelectionTargetForAccount,
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from '../claude-accounts/runtime-selection'

function selected(
  state: ClaudeRateLimitAccountsState,
  target: ClaudeAccountSelectionTarget
): string | null {
  return getSelectedClaudeAccountIdForTarget(
    {
      activeClaudeManagedAccountId: state.activeAccountId,
      activeClaudeManagedAccountIdsByRuntime: state.activeAccountIdsByRuntime
    },
    target
  )
}

export async function selectClaudeAccountAndMoveSessions(
  accounts: Pick<ClaudeAccountService, 'listAccounts' | 'selectAccount'>,
  accountId: string | null,
  options: { movesRunningSessions?: true; restartAll?: true },
  notify: ((change: ClaudeAccountSelectionChange) => void) | undefined
): Promise<ClaudeRateLimitAccountsState> {
  if (options.restartAll && !notify) {
    throw new Error('Moving running Claude sessions requires an open Orca desktop on this host.')
  }
  if (options.movesRunningSessions) {
    return accounts.selectAccount(accountId)
  }
  const before = accounts.listAccounts()
  const account = before.accounts.find((candidate) => candidate.id === accountId)
  const target: ClaudeAccountSelectionTarget = account
    ? getClaudeSelectionTargetForAccount(account)
    : { runtime: 'host' }
  const after =
    options.restartAll && selected(before, target) === accountId
      ? before
      : await accounts.selectAccount(accountId)
  notify?.({
    ...(options.restartAll ? { restartAll: true as const } : {}),
    target,
    before: { state: before, accountId: selected(before, target) },
    after: { state: after, accountId: selected(after, target) }
  })
  return after
}
