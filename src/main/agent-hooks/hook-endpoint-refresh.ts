import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { getEndpointFileName } from '../../shared/agent-hook-listener/transport/endpoint-publication'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'

export function localHookEndpointFilePath(): string | undefined {
  const app = getAppEnvironment()
  return app.isPackaged()
    ? join(app.getPath('userData'), 'agent-hooks', getEndpointFileName())
    : undefined
}

/** Old daemon shells predate ORCA_AGENT_HOOK_ENDPOINT; their profile path still identifies the stable production receiver. */
export function buildPosixHookEndpointRefreshLines(fallbackEndpointPath?: string): string[] {
  return [
    'if [ -z "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ "$ORCA_AGENT_HOOK_ENV" = production ]; then',
    '  if [ -n "$ORCA_USER_DATA_PATH" ]; then',
    '    ORCA_AGENT_HOOK_ENDPOINT="$ORCA_USER_DATA_PATH/agent-hooks/endpoint.env"',
    ...(fallbackEndpointPath
      ? ['  else', `    ORCA_AGENT_HOOK_ENDPOINT=${quotePosixShell(fallbackEndpointPath)}`]
      : []),
    '  fi',
    'fi',
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  unset ORCA_AGENT_HOOK_TRANSPORT',
    '  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi'
  ]
}

export function buildWindowsHookEndpointRefreshLines(fallbackEndpointPath?: string): string[] {
  return [
    'if not defined ORCA_AGENT_HOOK_ENDPOINT if "%ORCA_AGENT_HOOK_ENV%"=="production" if defined ORCA_USER_DATA_PATH set "ORCA_AGENT_HOOK_ENDPOINT=%ORCA_USER_DATA_PATH%\\agent-hooks\\endpoint.cmd"',
    ...(fallbackEndpointPath
      ? [
          `if not defined ORCA_AGENT_HOOK_ENDPOINT if "%ORCA_AGENT_HOOK_ENV%"=="production" set "ORCA_AGENT_HOOK_ENDPOINT=${fallbackEndpointPath.replaceAll('%', '%%')}"`
        ]
      : []),
    'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul'
  ]
}
