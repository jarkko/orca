import type { CommandHandler } from '../dispatch'
import {
  callAgentLaunch,
  formatAgentLaunch,
  getAgentLaunchCapabilities,
  parseCliAgent,
  readCliAgentLaunch
} from '../agent-launch-request'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getRequiredWorktreeSelector } from '../selectors'
import { resolveCurrentAgentWorkspaceSelector } from '../agent-workspace-selector'

export const AGENT_LAUNCH_HANDLERS: Record<string, CommandHandler> = {
  'agent move-account': async ({ flags, client, json }) => {
    if (getRequiredStringFlag(flags, 'agent') !== 'claude' || client.isRemote) {
      throw new RuntimeClientError(
        'invalid_argument',
        'agent move-account requires --agent claude and the local Orca desktop.'
      )
    }
    const account = flags.get('account')
    const result = await client.call(
      'accounts.moveClaudeSessions',
      account === undefined ? {} : { accountId: account === 'default' ? null : account }
    )
    printResult(
      result,
      json,
      () =>
        'Requested Claude session moves. Busy sessions will resume on the selected account when idle.'
    )
  },
  'agent launch': async ({ flags, client, cwd, json, rawArgs }) => {
    const launch = readCliAgentLaunch(flags, parseCliAgent(getRequiredStringFlag(flags, 'agent')), {
      createsWorktree: false
    })
    if (client.isRemote && !flags.has('worktree')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Remote agent launch requires --worktree because the client cwd cannot identify a server worktree.'
      )
    }
    const selector = flags.get('worktree')
    const current = selector === undefined || selector === 'active' || selector === 'current'
    const worktree = current
      ? await resolveCurrentAgentWorkspaceSelector(cwd, client, { agent: launch.agent })
      : await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    const capabilities = await getAgentLaunchCapabilities(client)
    if (!capabilities) {
      if (launch.operationId) {
        throw new RuntimeClientError(
          'agent_session_operation_unknown',
          'This host cannot replay the earlier launch. Return to the original execution host; do not retry without --retry-launch.'
        )
      }
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host cannot start agents from the CLI. Update Orca on the execution host.'
      )
    }
    const result = await callAgentLaunch(
      client,
      launch,
      {
        target: { kind: 'existing', worktree },
        presentation: flags.get('focus') === true ? 'focused' : 'background'
      },
      capabilities,
      rawArgs
    )
    printResult(result, json, formatAgentLaunch)
  }
}
