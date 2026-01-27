import { useActionExecutor } from '../hooks'
import LaunchProjectModal from './payment/LaunchProjectModal'
import type { JBRulesetConfig, JBTerminalConfig } from '../services/relayr'

/**
 * ActionExecutor component - listens for juice:execute-action events
 * and renders appropriate modals for different action types.
 *
 * Currently supports:
 * - launchProject: Opens LaunchProjectModal for omnichain project launch
 *
 * Similar pattern to TransactionExecutor which handles juice:pay-project events.
 */
export default function ActionExecutor() {
  const {
    launchProjectOpen,
    launchProjectParams,
    closeLaunchProject,
  } = useActionExecutor()

  // Don't render anything if no modal is open
  if (!launchProjectOpen || !launchProjectParams) {
    return null
  }

  // Extract the first ruleset config (modal expects singular, params has array)
  const rulesetConfig = (launchProjectParams.rulesetConfigurations[0] || {}) as JBRulesetConfig
  const terminalConfigurations = (launchProjectParams.terminalConfigurations || []) as JBTerminalConfig[]

  return (
    <LaunchProjectModal
      isOpen={launchProjectOpen}
      onClose={closeLaunchProject}
      projectName={launchProjectParams.projectName || 'New Project'}
      owner={launchProjectParams.owner}
      projectUri={launchProjectParams.projectUri}
      chainIds={launchProjectParams.chainIds}
      rulesetConfig={rulesetConfig}
      terminalConfigurations={terminalConfigurations}
      synchronizedStartTime={launchProjectParams.synchronizedStartTime || Math.floor(Date.now() / 1000) + 15 * 60}
      memo={launchProjectParams.memo}
    />
  )
}
