import { ipcMain } from 'electron'
import { z } from 'zod'
import { discoverClaudeAccountMoveSessions } from '../claude/claude-account-move-processes'
import type { ClaudeAccountService } from '../claude-accounts/service'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import { openAccountSignInLink } from './account-sign-in-link-opener'

export function registerClaudeAccountHandlers(claudeAccounts: ClaudeAccountService): void {
  claudeAccounts.setWslSignInLinkOpener((signInLink) => openAccountSignInLink('claude', signInLink))
  ipcMain.handle('claudeAccounts:discoverSessions', (_event, args: unknown) => {
    const { ptyIds } = z
      .object({ ptyIds: z.array(z.string().min(1).max(4096)).max(4096) })
      .parse(args)
    return discoverClaudeAccountMoveSessions(ptyIds)
  })
  ipcMain.handle('claudeAccounts:list', () => claudeAccounts.listAccounts())
  ipcMain.handle(
    'claudeAccounts:add',
    (_event, args?: ClaudeAccountSelectionTarget & { copyLink?: boolean }) =>
      claudeAccounts.addAccount(args, args?.copyLink)
  )
  ipcMain.handle('claudeAccounts:cancelPendingLogin', () => claudeAccounts.cancelPendingLogin())
  ipcMain.handle(
    'claudeAccounts:reauthenticate',
    (_event, args: { accountId: string; copyLink?: boolean }) =>
      claudeAccounts.reauthenticateAccount(args.accountId, args.copyLink)
  )
  ipcMain.handle('claudeAccounts:waitForSignInLink', () => claudeAccounts.waitForSignInLink())
  ipcMain.handle('claudeAccounts:remove', (_event, args: { accountId: string }) =>
    claudeAccounts.removeAccount(args.accountId)
  )
  ipcMain.handle(
    'claudeAccounts:select',
    (_event, args: { accountId: string | null } & ClaudeAccountSelectionTarget) =>
      args.runtime
        ? claudeAccounts.selectAccountForTarget(args.accountId, args)
        : claudeAccounts.selectAccount(args.accountId)
  )
}
