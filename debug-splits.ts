import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

const client = createPublicClient({
  chain: base,
  transport: http('https://base.publicnode.com'),
})

const JB_DIRECTORY = '0x0061e516886a0540f63157f112c0588ee0651dcf'
const JB_RULESETS = '0x6292281d69c3593fcf6ea074e5797341476ab428'
const JB_SPLITS = '0x7160a322fea44945a6ef9adfd65c322258df3c5e'
const REV_DEPLOYER = '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d'
const PROJECT_ID = 6n // Artizen on Base

async function main() {
  // First get the controller for this project from JBDirectory
  const controller = await client.readContract({
    address: JB_DIRECTORY as `0x${string}`,
    abi: [{
      name: 'controllerOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'projectId', type: 'uint256' }],
      outputs: [{ name: '', type: 'address' }],
    }] as const,
    functionName: 'controllerOf',
    args: [PROJECT_ID],
  })
  console.log('Controller for project', PROJECT_ID.toString(), ':', controller)

  // Get current ruleset from the actual controller
  const [ruleset, metadata] = await client.readContract({
    address: controller as `0x${string}`,
    abi: [{
      name: 'currentRulesetOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'projectId', type: 'uint256' }],
      outputs: [
        { name: 'ruleset', type: 'tuple', components: [
          { name: 'cycleNumber', type: 'uint48' },
          { name: 'id', type: 'uint48' },
          { name: 'basedOnId', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ]},
        { name: 'metadata', type: 'tuple', components: [
          { name: 'reservedPercent', type: 'uint16' },
        ]},
      ],
    }] as const,
    functionName: 'currentRulesetOf',
    args: [PROJECT_ID],
  })

  console.log('Current ruleset:')
  console.log('  cycleNumber:', ruleset.cycleNumber)
  console.log('  id:', ruleset.id)
  console.log('  basedOnId:', ruleset.basedOnId)
  console.log('  reservedPercent:', metadata.reservedPercent)

  // Get all rulesets to see what IDs exist
  const allRulesets = await client.readContract({
    address: JB_RULESETS as `0x${string}`,
    abi: [{
      name: 'allOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'projectId', type: 'uint256' },
        { name: 'startingId', type: 'uint256' },
        { name: 'size', type: 'uint256' },
      ],
      outputs: [{
        name: 'rulesets',
        type: 'tuple[]',
        components: [
          { name: 'cycleNumber', type: 'uint48' },
          { name: 'id', type: 'uint48' },
          { name: 'basedOnId', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ],
      }],
    }] as const,
    functionName: 'allOf',
    args: [PROJECT_ID, 0n, 20n],
  })

  console.log('\nAll rulesets and their splits:')
  const seenIds = new Set<number>()

  for (const rs of allRulesets) {
    if (rs.cycleNumber > 0 && !seenIds.has(rs.id)) {
      seenIds.add(rs.id)
      console.log('\n  rulesetId:', rs.id, '(cycle', rs.cycleNumber, ', basedOnId:', rs.basedOnId, ')')

      // Check splits for each distinct id
      const rsSplits = await client.readContract({
        address: JB_SPLITS as `0x${string}`,
        abi: [{
          name: 'splitsOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'projectId', type: 'uint256' },
            { name: 'rulesetId', type: 'uint256' },
            { name: 'group', type: 'uint256' },
          ],
          outputs: [{
            name: 'splits',
            type: 'tuple[]',
            components: [
              { name: 'preferAddToBalance', type: 'bool' },
              { name: 'percent', type: 'uint256' },
              { name: 'projectId', type: 'uint256' },
              { name: 'beneficiary', type: 'address' },
              { name: 'lockedUntil', type: 'uint256' },
              { name: 'hook', type: 'address' },
            ],
          }],
        }] as const,
        functionName: 'splitsOf',
        args: [PROJECT_ID, BigInt(rs.id), 2n],
      })

      console.log('    reserved splits (group 2):', rsSplits.length)
      if (rsSplits.length > 0) {
        for (const s of rsSplits) {
          const pct = Number(s.percent) / 1e9 * 100
          console.log('      -', s.beneficiary, ':', pct.toFixed(2), '%')
        }
      }
    }
  }
}

  // Also check REVDeployer's stored split operator
  console.log('\n--- Checking REVDeployer ---')
  try {
    const revConfig = await client.readContract({
      address: REV_DEPLOYER as `0x${string}`,
      abi: [{
        name: 'configurationOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'revnetId', type: 'uint256' }],
        outputs: [{
          name: '',
          type: 'tuple',
          components: [
            { name: 'description', type: 'tuple', components: [
              { name: 'name', type: 'string' },
              { name: 'ticker', type: 'string' },
              { name: 'uri', type: 'string' },
              { name: 'salt', type: 'bytes32' },
            ]},
            { name: 'baseCurrency', type: 'uint32' },
            { name: 'splitOperator', type: 'address' },
            { name: 'stageConfigurations', type: 'tuple[]', components: [
              { name: 'startsAtOrAfter', type: 'uint40' },
              { name: 'splitPercent', type: 'uint16' },
              { name: 'initialIssuance', type: 'uint112' },
              { name: 'issuanceDecayFrequency', type: 'uint32' },
              { name: 'issuanceDecayPercent', type: 'uint32' },
              { name: 'cashOutTaxRate', type: 'uint16' },
              { name: 'extraMetadata', type: 'uint16' },
            ]},
          ],
        }],
      }] as const,
      functionName: 'configurationOf',
      args: [PROJECT_ID],
    })
    console.log('  splitOperator:', revConfig.splitOperator)
    console.log('  stages:', revConfig.stageConfigurations.length)
    for (let i = 0; i < revConfig.stageConfigurations.length; i++) {
      const stage = revConfig.stageConfigurations[i]
      console.log(`    Stage ${i + 1}: splitPercent = ${Number(stage.splitPercent) / 100}%`)
    }
  } catch (e) {
    console.log('  REVDeployer configurationOf failed (possibly older version)')
  }
}

main().catch(console.error)
