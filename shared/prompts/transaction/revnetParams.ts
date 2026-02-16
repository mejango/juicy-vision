/**
 * Revnet Parameters sub-module (~800 tokens)
 * Hints: revnet, issuance decay, autonomous, splitPercent
 */

export const REVNET_PARAMS_CONTEXT = `
### Revnet Configuration (deploy721Revnet)

**WHEN USER CHOSE "AUTONOMOUS OPERATION" (revnet), USE action="deploy721Revnet"**

**Key revnet parameters:**
- action = "deploy721Revnet" (ALWAYS use 721 variant, even with empty tiers - enables future sales)
- contract = "REV_721_DEPLOYER"
- **startsAtOrAfter** = Math.floor(Date.now()/1000) + 300 (same as other projects!)
- **splitPercent** = operator % × 10^9 (e.g., 30% to operator = 300000000, supporters get remaining 70%)
- **splitOperator** = address that receives the operator split (creator's wallet)
- **initialIssuance** = starting tokens per payment unit (e.g., 1M tokens per dollar = "1000000000000000000000000")
- **issuanceDecayFrequency** = seconds between decay (604800 = 1 week)
- **issuanceDecayPercent** = % decay each period × 10^9 (50000000 = 5% decay per week)
- **cashOutTaxRate** = tax on cash outs × 10^9 (200000000 = 20% tax)

**splitPercent values (what operator/creator keeps):**
| Operator % | Supporter % | splitPercent value |
|------------|-------------|-------------------|
| 70% | 30% | 700000000 |
| 50% | 50% | 500000000 |
| 30% | 70% | 300000000 |
| 20% | 80% | 200000000 |

**issuanceDecayPercent values:**
| Decay Rate | Per Period | issuanceDecayPercent |
|------------|------------|---------------------|
| 1% | per week | 10000000 |
| 5% | per week | 50000000 |
| 10% | per week | 100000000 |
| 20% | per week | 200000000 |

**Revnet conversation triggers:**
- User mentions "autonomous", "no human control", "credibly neutral"
- User wants "maximum trust" or "guaranteed rules"
- User mentions "load-based", "early supporter rewards", "issuance decay"
- User explicitly asks for a revnet

**CONTRACT-OWNED PROJECTS (revnets) CANNOT use queueRulesets:**
- If owner = REVDeployer (0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d), project is a revnet
- Revnets have staged parameters baked in - no human can change them
- **Revnet operators CAN call setUriOf** to update metadata (name, description, logo)
- Check project owner before suggesting queueRulesets
`;

export const REVNET_PARAMS_HINTS = [
  'revnet', 'issuance decay', 'autonomous', 'splitPercent', 'decay',
  'no human control', 'credibly neutral', 'guaranteed rules',
  'early supporter', 'load-based', 'REVDeployer'
];

export const REVNET_PARAMS_TOKEN_ESTIMATE = 800;
