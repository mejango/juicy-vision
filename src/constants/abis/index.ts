// Consolidated ABI exports for Juicebox V5 contracts

export {
  JB_MULTI_TERMINAL_ADDRESS,
  JB_MULTI_TERMINAL_ABI,
  NATIVE_TOKEN,
} from './jbMultiTerminal'

export {
  JB_CONTROLLER_ADDRESS,
  JB_CONTROLLER_ABI,
} from './jbController'

export {
  REV_DEPLOYER_ADDRESS,
  REV_DEPLOYER_ABI,
} from './revDeployer'

export {
  JB_SUCKER_REGISTRY_ADDRESS,
  JB_SUCKER_REGISTRY_ABI,
} from './jbSuckerRegistry'

// Type definitions for ABI inputs
export interface PayParams {
  projectId: bigint
  token: `0x${string}`
  amount: bigint
  beneficiary: `0x${string}`
  minReturnedTokens: bigint
  memo: string
  metadata: `0x${string}`
}

export interface CashOutParams {
  holder: `0x${string}`
  projectId: bigint
  cashOutCount: bigint
  tokenToReclaim: `0x${string}`
  minTokensReclaimed: bigint
  beneficiary: `0x${string}`
  metadata: `0x${string}`
}

export interface SendPayoutsParams {
  projectId: bigint
  token: `0x${string}`
  amount: bigint
  currency: bigint
  minTokensPaidOut: bigint
}

export interface UseAllowanceParams {
  projectId: bigint
  token: `0x${string}`
  amount: bigint
  currency: bigint
  minTokensPaidOut: bigint
  beneficiary: `0x${string}`
  feeBeneficiary: `0x${string}`
  memo: string
}

export interface DeployERC20Params {
  projectId: bigint
  name: string
  symbol: string
  salt: `0x${string}`
}
