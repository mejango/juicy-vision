import { resolveEnsName } from '../../utils/ens'

/**
 * Resolves ENS names for wallet-beneficiary splits (projectId === 0),
 * keyed by lowercased address. Addresses without an ENS name are omitted.
 * Shared by the dynamic forms/tabs that render split beneficiary lists.
 */
export async function resolveSplitEnsNames(
  splitGroups: Array<Array<{ beneficiary?: string | null; projectId: number }>>,
): Promise<Record<string, string>> {
  const beneficiaries = new Set<string>()
  splitGroups.forEach(splits => {
    splits.forEach(split => {
      if (split.beneficiary && split.projectId === 0) {
        beneficiaries.add(split.beneficiary.toLowerCase())
      }
    })
  })

  const resolved = await Promise.all(
    Array.from(beneficiaries).map(async addr => ({ addr, ens: await resolveEnsName(addr) })),
  )

  const ensMap: Record<string, string> = {}
  resolved.forEach(({ addr, ens }) => {
    if (ens) ensMap[addr] = ens
  })
  return ensMap
}
