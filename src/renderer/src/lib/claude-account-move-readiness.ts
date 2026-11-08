import type { AgentStatusEntry } from '../../../shared/agent-status/contracts/agent-status-types'
import type { AppState } from '@/store'
import { agentChildWorkLiveness } from '../../../shared/agent-status/child-work/agent-status-child-work-liveness'

/** Whether the pane's Claude is mid-turn; a restart during a permission prompt or question drops it. */
export function isClaudePaneMidTurn(state: AppState, paneKey: string): boolean {
  const entry = state.agentStatusByPaneKey[paneKey]
  if (entry?.agentType !== 'claude' || entry.state === 'done') {
    return false
  }
  // Shells can keep the combined row working after Stop/StopFailure ended the main turn.
  return !(
    entry.state === 'working' &&
    entry.mainAgent?.state === 'done' &&
    !claudePaneHasActiveAgentWork(entry)
  )
}

export function claudePaneHasActiveAgentWork(
  entry: Pick<AgentStatusEntry, 'children' | 'subagents'>
): boolean {
  const liveness = agentChildWorkLiveness(
    entry.children ??
      entry.subagents?.map((child) => ({ kind: 'agent' as const, state: child.state }))
  )
  return liveness === 'working' || liveness === 'waiting'
}
