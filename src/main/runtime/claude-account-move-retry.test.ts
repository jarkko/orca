import { expect, it } from 'vitest'
import { selectClaudeAccountAndMoveSessions } from './runtime-claude-account-selection'
import type { ClaudeAccountSelectionChange } from '../../shared/managed-account-types'

it('requests a move to the current account without selecting it again, and refuses a headless host', async () => {
  let change: ClaudeAccountSelectionChange | undefined
  const accounts = {
    listAccounts: () => ({ activeAccountId: 'account-b', accounts: [] }),
    selectAccount: () => {
      throw new Error('must not select an unchanged account')
    }
  }
  await selectClaudeAccountAndMoveSessions(accounts, 'account-b', { restartAll: true }, (event) => {
    change = event
  })

  expect(change).toMatchObject({
    restartAll: true,
    target: { runtime: 'host' },
    before: { accountId: 'account-b' },
    after: { accountId: 'account-b' }
  })
  await expect(
    selectClaudeAccountAndMoveSessions(accounts, 'account-b', { restartAll: true }, undefined)
  ).rejects.toThrow('Moving running Claude sessions requires an open Orca desktop on this host.')
})
