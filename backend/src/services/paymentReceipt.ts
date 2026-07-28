import { type Address, decodeEventLog, type Hex, isAddressEqual } from 'viem';
import { CONTRACTS, KNOWN_BUYBACK_HOOKS } from '@shared/chains.ts';

const PAY_EVENT_ABI = [{
  name: 'Pay',
  type: 'event',
  inputs: [
    { name: 'rulesetId', type: 'uint256', indexed: true },
    { name: 'rulesetCycleNumber', type: 'uint256', indexed: true },
    { name: 'projectId', type: 'uint256', indexed: true },
    { name: 'payer', type: 'address', indexed: false },
    { name: 'beneficiary', type: 'address', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'newlyIssuedTokenCount', type: 'uint256', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'metadata', type: 'bytes', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
}] as const;

const MINT_TOKENS_EVENT_ABI = [{
  name: 'MintTokens',
  type: 'event',
  inputs: [
    { name: 'beneficiary', type: 'address', indexed: true },
    { name: 'projectId', type: 'uint256', indexed: true },
    { name: 'tokenCount', type: 'uint256', indexed: false },
    { name: 'beneficiaryTokenCount', type: 'uint256', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'reservedPercent', type: 'uint256', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
}] as const;

interface ReceiptLog {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
}

/**
 * Verify the terminal event and recover the beneficiary's actual project-token
 * mint. On a buyback route Pay.newlyIssuedTokenCount is zero because the hook
 * mints after the terminal emits Pay, so MintTokens is the receipt-side count.
 */
export function verifyProtectedPaymentReceipt(params: {
  logs: readonly ReceiptLog[];
  entrypoint: Address;
  projectId: bigint;
  payer: Address;
  beneficiary: Address;
  amount: bigint;
  memo: string;
  metadata: Hex;
  minimum: bigint;
}): bigint {
  let terminalIssued: bigint | null = null;

  const payerMatchesEntrypoint = (eventPayer: Address): boolean => {
    if (isAddressEqual(params.entrypoint, CONTRACTS.JBMultiTerminal as Address)) {
      return isAddressEqual(eventPayer, params.payer);
    }
    if (isAddressEqual(params.entrypoint, CONTRACTS.JBRouterTerminal as Address)) {
      return isAddressEqual(eventPayer, CONTRACTS.JBRouterTerminal as Address);
    }
    if (isAddressEqual(params.entrypoint, CONTRACTS.JBRouterTerminalRegistry as Address)) {
      // The registry can forward either directly to the multi terminal or
      // through the router terminal. The decoded top-level pay call is bound
      // separately by each confirmation service.
      return isAddressEqual(eventPayer, CONTRACTS.JBRouterTerminalRegistry as Address) ||
        isAddressEqual(eventPayer, CONTRACTS.JBRouterTerminal as Address);
    }
    return false;
  };

  for (const log of params.logs) {
    if (!isAddressEqual(log.address, CONTRACTS.JBMultiTerminal as Address)) continue;
    try {
      const event = decodeEventLog({
        abi: PAY_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (
        event.eventName === 'Pay' &&
        event.args.projectId === params.projectId &&
        payerMatchesEntrypoint(event.args.payer) &&
        isAddressEqual(event.args.beneficiary, params.beneficiary) &&
        event.args.amount === params.amount &&
        event.args.memo === params.memo &&
        event.args.metadata === params.metadata
      ) {
        terminalIssued = event.args.newlyIssuedTokenCount;
        break;
      }
    } catch {
      // Ignore unrelated terminal logs.
    }
  }
  if (terminalIssued === null) {
    throw new Error('Confirmed transaction did not emit the expected payment');
  }

  let controllerIssued = 0n;
  for (const log of params.logs) {
    if (!isAddressEqual(log.address, CONTRACTS.JBController as Address)) continue;
    try {
      const event = decodeEventLog({
        abi: MINT_TOKENS_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (
        event.eventName === 'MintTokens' &&
        event.args.projectId === params.projectId &&
        isAddressEqual(event.args.beneficiary, params.beneficiary) &&
        (
          isAddressEqual(event.args.caller, CONTRACTS.JBMultiTerminal as Address) ||
          // Any known-good buyback hook counts: projects can be registry-pinned
          // to the pre-upgrade instance, which mints through the same path.
          KNOWN_BUYBACK_HOOKS.some(hook => isAddressEqual(event.args.caller, hook as Address))
        )
      ) {
        controllerIssued += event.args.beneficiaryTokenCount;
      }
    } catch {
      // Ignore unrelated controller logs.
    }
  }

  const beneficiaryTokenCount = controllerIssued > terminalIssued
    ? controllerIssued
    : terminalIssued;
  if (beneficiaryTokenCount < params.minimum || beneficiaryTokenCount <= 0n) {
    throw new Error('Confirmed payment did not issue the protected project-token minimum');
  }
  return beneficiaryTokenCount;
}
