import { claudePaneHasActiveAgentWork } from './claude-account-move-readiness'
import { pickParsedAgentStatusPayload } from '../../../shared/agent-status/contracts/agent-status-types'
import { useAppStore } from '@/store'
import { isTerminalLeafId, makePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import {
  isForeignMachineCodexPtyId,
  resolveCodexPaneSelectionLane
} from './codex-pane-selection-lane'

/** Recover exact live-session identity before scanning; no folder/cwd-based conversation matching. */
export async function refreshClaudeAccountMoveSessions(
  onlyPtyIds?: readonly string[],
  isCurrent: () => boolean = () => true
): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }
  const initial = useAppStore.getState()
  const requested = onlyPtyIds ? new Set(onlyPtyIds) : null
  const panes = new Map<string, { tabId: string; leafId: string; worktreeId: string }>()
  for (const [worktreeId, tabs] of Object.entries(initial.tabsByWorktree)) {
    for (const tab of tabs) {
      const bound = initial.ptyIdsByTabId[tab.id] ?? []
      for (const [leafId, ptyId] of Object.entries(
        initial.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}
      )) {
        if (
          !isTerminalLeafId(leafId) ||
          !bound.includes(ptyId) ||
          isForeignMachineCodexPtyId(ptyId) ||
          (requested && !requested.has(ptyId)) ||
          initial.agentStatusByPaneKey[makePaneKey(tab.id, leafId)]?.structuredHostOwned
        ) {
          continue
        }
        if (resolveCodexPaneSelectionLane({ state: initial, tab, ptyId }).laneKey !== 'host') {
          continue
        }
        panes.set(ptyId, { tabId: tab.id, leafId, worktreeId })
      }
    }
  }
  if (panes.size === 0) {
    return
  }
  const discover = window.api.claudeAccounts?.discoverSessions
  if (!discover) {
    return
  }
  const sessions = await discover({ ptyIds: [...panes.keys()] })
  if (!isCurrent()) {
    return
  }
  for (const session of sessions) {
    const pane = panes.get(session.ptyId)
    if (!pane) {
      continue
    }
    const state = useAppStore.getState()
    if (state.terminalLayoutsByTabId[pane.tabId]?.ptyIdsByLeafId?.[pane.leafId] !== session.ptyId) {
      continue
    }
    const paneKey = makePaneKey(pane.tabId, pane.leafId)
    const entry = state.agentStatusByPaneKey[paneKey]
    if (entry?.structuredHostOwned) {
      continue
    }
    // Fresh hook evidence wins; argv cannot downgrade an idle hook to an unproven busy state.
    if (
      entry?.agentType === 'claude' &&
      entry.providerSession?.id === session.providerSession.id &&
      (session.source === 'argv' ||
        (entry.evidenceObservedAt ?? entry.updatedAt) > session.observedAt ||
        (session.state === 'done' && claudePaneHasActiveAgentWork(entry)))
    ) {
      if (
        !entry.providerSession.transcriptPath ||
        (session.source === 'registry' &&
          entry.providerSession.transcriptPath !== session.providerSession.transcriptPath)
      ) {
        state.setAgentStatus(
          paneKey,
          pickParsedAgentStatusPayload(entry),
          undefined,
          { updatedAt: entry.updatedAt, evidenceObservedAt: entry.evidenceObservedAt },
          pane,
          { providerSession: session.providerSession }
        )
      }
      continue
    }
    state.setAgentStatus(
      paneKey,
      {
        agentType: 'claude',
        state: session.state,
        prompt: entry?.prompt ?? '',
        mainAgent: { state: session.state, stateStartedAt: session.observedAt },
        ...(entry?.providerSession?.id === session.providerSession.id
          ? { subagents: entry.subagents }
          : {})
      },
      undefined,
      { updatedAt: Math.max(session.observedAt, entry?.updatedAt ?? 0) },
      pane,
      { providerSession: session.providerSession }
    )
  }
}

/** Busy legacy processes may still have obsolete hook env; stop probing as soon as their accepted move settles. */
export function installClaudeAccountMoveRecovery(): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  const pending = (): string[] =>
    Object.entries(useAppStore.getState().pendingPaneAccountRestarts)
      .filter(([, agent]) => agent === 'claude')
      .map(([id]) => id)
  const refresh = async (): Promise<void> => {
    timer = undefined
    if (disposed || running || pending().length === 0) {
      return
    }
    running = true
    try {
      await refreshClaudeAccountMoveSessions(pending(), () => !disposed)
    } catch (error) {
      console.warn('[claude-account-switch] process recovery failed:', error)
    } finally {
      running = false
      if (!disposed && pending().length > 0) {
        timer = setTimeout(() => void refresh(), 2000)
      }
    }
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (
      state.pendingPaneAccountRestarts !== previous.pendingPaneAccountRestarts &&
      !timer &&
      !running &&
      pending().length > 0
    ) {
      void refresh()
    }
  })
  void refresh()
  return () => {
    disposed = true
    clearTimeout(timer)
    unsubscribe()
  }
}
