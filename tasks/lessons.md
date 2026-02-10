# Lessons Learned

## 2026-02-06: Technical Details must show ALL transaction parameters

**Bug**: TransactionPreview's technical details section was filtering out `launchProjectConfig` from display, hiding critical project parameters like duration, payout limits, reserved percent, etc.

**Root cause**: Line 2765 in `TransactionPreview.tsx` had a filter that excluded `launchProjectConfig`:
```javascript
.filter(([key]) => !['chainConfigs', 'projectMetadata', 'suckerDeploymentConfiguration', 'raw', 'launchProjectConfig'].includes(key))
```

The comment said "Hide fields shown separately" but `launchProjectConfig` was never shown anywhere else.

**Rule**: When hiding fields from technical details with "shown separately" as the reason, verify those fields ARE actually shown somewhere. Don't filter out data without displaying it elsewhere.

**Fix**: Removed `launchProjectConfig` from the filter so it displays in technical details.

## 2026-02-10: JB721TiersHook tiers sorted by CATEGORY, not price

**Bug**: AI prompt incorrectly stated that tiers must be sorted by price when calling `adjustTiers` or `launch721Project`.

**Reality**: The JB721TiersHookStore contract enforces **category** sorting:
```solidity
// Revert if the category is not equal or greater than the previously added tier's category.
if (tierToAdd.category < previousTier.category) {
    revert JB721TiersHookStore_InvalidCategorySortOrder(tierToAdd.category, previousTier.category);
}
```

**Rule**: When documenting contract function requirements, verify the actual sort/validation logic in the contract code. Don't assume common conventions (like price sorting) without checking.

**Fix**: Updated `shared/prompts/transaction/nftTiers.ts` to say "MUST be sorted by category (lowest to highest)".
