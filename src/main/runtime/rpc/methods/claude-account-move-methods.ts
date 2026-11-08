import { getSelectedClaudeAccountIdForTarget } from '../../../claude-accounts/runtime-selection'
import { defineMethod } from '../core'
import { MoveClaudeSessionsParams } from '../../../../shared/rpc-contract/accounts-params'

export const CLAUDE_ACCOUNT_MOVE_METHODS = [
  defineMethod({
    name: 'accounts.moveClaudeSessions',
    permission: 'accounts-admin',
    params: MoveClaudeSessionsParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('Moving Claude sessions is only available to the local Orca CLI.')
      }
      const roster = runtime.getAccountsSnapshot().claude
      const accountId =
        params.accountId === undefined
          ? getSelectedClaudeAccountIdForTarget(
              {
                activeClaudeManagedAccountId: roster.activeAccountId,
                activeClaudeManagedAccountIdsByRuntime: roster.activeAccountIdsByRuntime
              },
              { runtime: 'host' }
            )
          : params.accountId
      const accounts = await runtime.selectClaudeAccount(accountId, { restartAll: true })
      return { requested: true, accounts }
    }
  })
]
