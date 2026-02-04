# Deploy ForwardableSimpleAccount with ERC2771Context

## Completed

- [x] Create Foundry project with contracts
  - `contracts/src/ForwardableSimpleAccount.sol` - extends SimpleAccount + ERC2771Context
  - `contracts/src/ForwardableSimpleAccountFactory.sol` - permissionless factory
  - `contracts/foundry.toml` - Solidity 0.8.28
  - Git submodules: account-abstraction, openzeppelin-contracts
- [x] Deploy factory to 4 testnet chains via CREATE2 (deterministic deployer)
  - Factory: `0x69a05d911af23501ff9d6b811a97cac972dade05` (all chains)
  - Implementation: `0x605Cb84933FE2C28B56089912e8428DaC417495B` (all chains)
  - Sepolia: tx `0x029dc5f01fe8973bfb29761f739830384bdffde7311b08331083a38419b426d8`
  - Base Sepolia: tx `0x6abbda440cfda4bfcf893ae1d27132877bfb258319d121fb0d33f9252dc814f6`
  - OP Sepolia: tx `0x55423cc8e4f96f30ca0391e7ce667e6b1d59788d485f87166929db94ffcf4538`
  - Arb Sepolia: tx `0x3b36fb8dd96a62e0dd7e8e0cc3e48ac7a264d5885938bee7932ba1eafc16227a`
- [x] Update backend config
  - `smartAccounts.ts`: factory address + async `computeSmartAccountAddress` via factory `getAddress()`
  - `relayrBundle.ts`: restored ERC-2771 wrapping for smart account routing (removed direct execution)
  - `smartAccounts.test.ts`: updated factory address
  - `ARCHITECTURE.md`: updated factory address (2 places)
- [x] Update frontend
  - `useOmnichainSetUri.ts`: removed direct txHashes path, all bundles go through Relayr polling
  - `useManagedWallet.ts`: removed txHashes from return type
- [x] Verify
  - `forge build`: compiles successfully
  - `npx tsc --noEmit` (frontend): clean
  - `npx tsc --noEmit` (backend): clean
  - `isTrustedForwarder(forwarder)`: returns true on deployed contracts

## Still needed

- [ ] Clear `user_smart_accounts` table (addresses will change with new factory)
- [ ] Set RELAYR env vars in backend deployment for server-side bundle creation
- [ ] End-to-end test: full setUriOf flow through the app
