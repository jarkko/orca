import type { AgentProviderSessionMetadata } from './agent-session/lifecycle/agent-session-resume'

export type ClaudeAccountMoveSession = {
  ptyId: string
  providerSession: AgentProviderSessionMetadata
  state: 'working' | 'done'
  observedAt: number
  source: 'registry' | 'argv'
}
