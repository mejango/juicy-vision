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
