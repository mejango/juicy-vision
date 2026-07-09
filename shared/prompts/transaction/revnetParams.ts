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
- **splitPercent** = operator % out of 10,000 (uint16; e.g., 30% to operator = 3000, supporters get remaining 70%)
- **splitOperator** = address that receives the operator split (creator's wallet)
- **initialIssuance** = starting tokens per payment unit (e.g., 1M tokens per dollar = "1000000000000000000000000")
- **issuanceCutFrequency** (V6; was issuanceDecayFrequency) = seconds between issuance cuts (604800 = 1 week; must be >= 24 hours)
- **issuanceCutPercent** (V6; was issuanceDecayPercent) = % cut each period × 10^9 (50000000 = 5% cut per week)
- **cashOutTaxRate** = tax on cash outs out of 10,000 (uint16; 2000 = 20% tax)

**Creation fee:** REVDeployer.deployFor is payable and requires \`msg.value == JBProjects.creationFee()\` EXACTLY (currently ≤ 0.001 ETH; read from chain, never hardcode). The frontend attaches it automatically.

**splitPercent values (what operator/creator keeps, out of 10,000):**
| Operator % | Supporter % | splitPercent value |
|------------|-------------|-------------------|
| 70% | 30% | 7000 |
| 50% | 50% | 5000 |
| 30% | 70% | 3000 |
| 20% | 80% | 2000 |

**issuanceCutPercent values (out of 1,000,000,000):**
| Cut Rate | Per Period | issuanceCutPercent |
|----------|------------|--------------------|
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
- If owner = REVOwner singleton (0x2ba4705ad0332cdfb299b452068438bcba3faaf3), project is a revnet (revnets are deployed via REVDeployer 0xb552eb94284f94b833837d4b2cbb237128415d4e; the project NFT is held by REVOwner)
- Revnets have staged parameters baked in - no human can change them
- **Revnet operators CAN call setUriOf** to update metadata (name, description, logo)
- Check project owner before suggesting queueRulesets
`;

export const REVNET_PARAMS_HINTS = [
  'revnet', 'issuance cut', 'issuance decay', 'autonomous', 'splitPercent', 'decay',
  'no human control', 'credibly neutral', 'guaranteed rules',
  'early supporter', 'load-based', 'REVDeployer'
];

export const REVNET_PARAMS_TOKEN_ESTIMATE = 800;
