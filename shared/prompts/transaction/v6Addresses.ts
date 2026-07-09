/**
 * V6 Contract Addresses sub-module (~900 tokens)
 * Hints: deploy, launch, create project, new project, revnet, sucker, bridge
 */

export const V6_ADDRESSES_CONTEXT = `
### Juicebox V6 Contracts

**Every core V6 contract has the SAME address on all 8 chains** (Ethereum, Optimism, Base, Arbitrum + their Sepolia testnets). There is only one Juicebox version - no version detection needed.

| Contract | Address |
|----------|---------|
| JBController | 0x3fcec3572e84b624477bcff4e2cf1f7deab648f1 |
| JBMultiTerminal | 0x130f5dd2bd8805443cf41755253d778a75a67f53 |
| JBRulesets | 0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba |
| JBTerminalStore | 0x7497ae014a60561925b51c0a3b4ade7460b9927c |
| JBTokens | 0x1f80d8f057ee36b4c2656d107e4e4558b71ba7d9 |
| JBProjects | 0x6017d1fba9dc279bfa0b03fd931c22e242ab3691 |
| JBDirectory | 0x5aff29060e023e6fb87be5596652b33c65af535b |
| JBSplits | 0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3 |
| JBFundAccessLimits | 0xc93360158f187fc8fc8f1062a1b31d06f185dbab |
| JBPermissions | 0xf92ac1ab5a00033e35a3975739124f61928c36b0 |
| JBPrices | 0xad45e4627f068d1e6b21e5301870d807543a8401 |
| JBFeelessAddresses | 0x657d0e588fca6f8c49394c9ca8a1cf6505b10314 |
| JBHeldFees | 0x62e77076b6e902e7aec8b2925acc9b46058e3d38 |
| JBOmnichainDeployer | 0xb853758a70a6b4216c09f1d071ea2344aba0a34f |
| REVDeployer | 0xb552eb94284f94b833837d4b2cbb237128415d4e |
| REVLoans | 0x056265c31157748818f0910d1859acd2f7d427de |
| REVOwner | 0x2ba4705ad0332cdfb299b452068438bcba3faaf3 |
| JB721TiersHookStore | 0x69913acf79dbba170d9efafe605ee62b42164f9c |
| JB721TiersHookDeployer | 0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78 |
| JB721TiersHookProjectDeployer | 0x3ffdc94e7f1de4b74c52158ec9dd3b965585f451 |
| JBSuckerRegistry | 0x7903a854ae91eaf635430d120a1a434085cef297 |
| JBBuybackHook | 0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948 |
| JBBuybackHookRegistry | 0x72f55a54cd53410a5ff175508a5a384227081788 |
| JBRouterTerminal | 0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7 |
| JBRouterTerminalRegistry | 0xe0427f250fdb0379c8e98e884ee4570521208cbc |

Revnets are deployed via REVDeployer. Revnet project NFTs are owned by the REVOwner singleton (0x2ba4705ad0332cdfb299b452068438bcba3faaf3) - owner === REVOwner means the project is a revnet. \`tiered721HookOf\` lives on REVOwner.

### Native-Bridge Sucker Deployers (Ethereum ↔ L2, same address on both sides)

| Deployer | Address |
|----------|---------|
| JBOptimismSuckerDeployer | 0x298a775c030adcedb641a89d9047ec9972674e1a |
| JBBaseSuckerDeployer | 0x54140331902de5c3445eb0c26e15099a5a9d59e6 |
| JBArbitrumSuckerDeployer | 0xa12ebfca3d4e0810e4ed174e4c08277c26917acb |

### CCIP Sucker Deployers (per chain PAIR, same address on both sides; identical for mainnet and testnet families)

| Chain Pair | Deployer |
|------------|----------|
| Ethereum ↔ Optimism | 0x41d28bedd5b0fbf65424b48c0e1de92d5c882fc7 |
| Ethereum ↔ Arbitrum | 0x36a2e30029d87c46f77f71b7b6b97fec8a760660 |
| Ethereum ↔ Base | 0x3955fec11fe15f0be4dfa2b0153feef55d55e1ee |
| Optimism ↔ Arbitrum | 0x1d58d56fbdb753de44737be926c33b79cf009afa |
| Optimism ↔ Base | 0x8f6f0a70939997310309d7ab66b1b199faafe7f0 |
| Arbitrum ↔ Base | 0x2845f919af9ed7d8dab188d42114bd590340a242 |
`;

export const V6_ADDRESSES_HINTS = [
  'deploy', 'launch', 'create project', 'new project', 'start project',
  'revnet', 'autonomous', 'REVDeployer', 'sucker', 'bridge', 'cross-chain',
  'buyback hook', 'controller', 'terminal address', 'contract address'
];

export const V6_ADDRESSES_TOKEN_ESTIMATE = 900;
