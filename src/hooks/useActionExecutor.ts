import { useEffect, useState, useCallback } from 'react'
import { ALL_CHAIN_IDS } from '../constants'

// Supported actions that we handle
export type ExecuteAction = 'launchProject' | 'queueRuleset' | 'deployERC20' | 'distribute'

// Event detail structure from TransactionPreview
interface ExecuteActionEventDetail {
  action: string
  contract: string
  chainId: string
  projectId?: string
  parameters: Record<string, unknown>
}

// Parsed launch project parameters
export interface LaunchProjectParams {
  owner: string
  projectUri: string
  chainIds: number[]
  rulesetConfigurations: unknown[]
  terminalConfigurations: unknown[]
  memo: string
  projectName?: string
  synchronizedStartTime?: number
}

// State for the action executor
export interface ActionExecutorState {
  // Launch project modal
  launchProjectOpen: boolean
  launchProjectParams: LaunchProjectParams | null
}

export function useActionExecutor() {
  const [state, setState] = useState<ActionExecutorState>({
    launchProjectOpen: false,
    launchProjectParams: null,
  })

  // Handle execute action events
  const handleExecuteAction = useCallback((event: CustomEvent<ExecuteActionEventDetail>) => {
    const { action, parameters, chainId } = event.detail

    if (action === 'launchProject') {
      // Parse the launch project parameters from the event
      const params = parameters as Record<string, unknown>

      // Extract chain IDs - could be in different formats
      let chainIds: number[] = []
      if (params.chainIds && Array.isArray(params.chainIds)) {
        chainIds = params.chainIds.map(Number)
      } else if (chainId) {
        chainIds = [Number(chainId)]
      }

      // Default to supported chains if none specified (environment-aware)
      if (chainIds.length === 0) {
        chainIds = [...ALL_CHAIN_IDS]
      }

      // Extract owner address
      const owner = (params.owner as string) || ''

      // Extract project URI (IPFS CID for metadata)
      const projectUri = (params.projectUri as string) || ''

      // Extract ruleset configurations
      const rulesetConfigurations = (params.rulesetConfigurations as unknown[]) || []

      // Extract terminal configurations
      const terminalConfigurations = (params.terminalConfigurations as unknown[]) || []

      // Extract memo
      const memo = (params.memo as string) || 'Project launch'

      // Extract project name for display
      const projectName = (params.projectName as string) || (params.name as string) || 'New Project'

      // Calculate synchronized start time (15 minutes from now if not specified)
      const synchronizedStartTime = (params.synchronizedStartTime as number) ||
        (params.mustStartAtOrAfter as number) ||
        Math.floor(Date.now() / 1000) + 15 * 60

      const launchParams: LaunchProjectParams = {
        owner,
        projectUri,
        chainIds,
        rulesetConfigurations,
        terminalConfigurations,
        memo,
        projectName,
        synchronizedStartTime,
      }

      setState(prev => ({
        ...prev,
        launchProjectOpen: true,
        launchProjectParams: launchParams,
      }))
    }

    // TODO: Handle other actions (queueRuleset, deployERC20, distribute) similarly
  }, [])

  // Close the launch project modal
  const closeLaunchProject = useCallback(() => {
    setState(prev => ({
      ...prev,
      launchProjectOpen: false,
      launchProjectParams: null,
    }))
  }, [])

  // Listen for execute action events
  useEffect(() => {
    const listener = (event: Event) => {
      handleExecuteAction(event as CustomEvent<ExecuteActionEventDetail>)
    }

    window.addEventListener('juice:execute-action', listener)

    return () => {
      window.removeEventListener('juice:execute-action', listener)
    }
  }, [handleExecuteAction])

  return {
    // Launch project state
    launchProjectOpen: state.launchProjectOpen,
    launchProjectParams: state.launchProjectParams,
    closeLaunchProject,
  }
}
