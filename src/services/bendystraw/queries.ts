export const PROJECT_QUERY = `
  query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
      version
      handle
      owner
      deployer
      isRevnet
      suckerGroupId
      metadataUri
      metadata
      name
      description
      projectTagline
      logoUri
      coverImageUri
      infoUri
      payDisclosure
      twitter
      farcaster
      discord
      telegram
      domain
      tags
      tokens
      volume
      volumeUsd
      balance
      token
      decimals
      currency
      tokenSupply
      nftsMintedCount
      paymentsCount
      createdAt
      tokenSymbol
    }
  }
`

// Query projects owned by a specific address
export const PROJECTS_BY_OWNER_QUERY = `
  query ProjectsByOwner($owner: String!, $limit: Int!, $offset: Int!) {
    projects(
      where: { owner: $owner, version: 6 }
      limit: $limit
      offset: $offset
      orderBy: "createdAt"
      orderDirection: "desc"
    ) {
      totalCount
      items {
        id
        projectId
        chainId
        version
        handle
        name
        logoUri
        owner
        deployer
        volume
        volumeUsd
        balance
        contributorsCount
        paymentsCount
        createdAt
      }
    }
  }
`

export const PROJECTS_QUERY = `
  query Projects($limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    projects(
      where: { version: 6 }
      limit: $limit
      offset: $offset
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      totalCount
      items {
        id
        projectId
        chainId
        version
        suckerGroupId
        handle
        name
        logoUri
        volume
        volumeUsd
        balance
        contributorsCount
        paymentsCount
        createdAt
        trendingScore
        trendingVolume
        trendingPaymentsCount
      }
    }
  }
`

// Query to get project info for permission checks
// Note: currentRuleset is fetched separately via on-chain reads
export const PROJECT_RULESET_QUERY = `
  query ProjectRuleset($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
      owner
      deployer
      isRevnet
      suckerGroupId
      metadataUri
      metadata
      handle
      name
      description
      projectTagline
      logoUri
      coverImageUri
      infoUri
      payDisclosure
      twitter
      farcaster
      discord
      telegram
      domain
      tags
      tokens
      balance
    }
  }
`

// Query to get recent pay events for calculating current issuance rate
// Note: payEvents where clause expects Int types
export const RECENT_PAY_EVENTS_QUERY = `
  query RecentPayEvents($projectId: Int!, $chainId: Int!, $version: Int!) {
    payEvents(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      limit: 5
      orderBy: "timestamp"
      orderDirection: "desc"
    ) {
      items {
        amount
        newlyIssuedTokenCount
        timestamp
      }
    }
  }
`

// Query to get connected chains via suckerGroup
export const CONNECTED_CHAINS_QUERY = `
  query ConnectedChains($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      suckerGroup {
        projects {
          items {
            projectId
            chainId
          }
        }
      }
    }
  }
`

// Query project-token owners across one or more chains. Bendystraw's V6
// participant resolver requires the versioned `chainId_in` shape used by
// website/; its singular `chainId` filter currently fails at runtime.
export const TOKEN_HOLDERS_QUERY = `
  query TokenHolders(
    $where: participantFilter!
    $limit: Int
    $offset: Int
  ) {
    participants(
      where: $where
      limit: $limit
      offset: $offset
      orderBy: "balance"
      orderDirection: "desc"
    ) {
      totalCount
      items {
        address
        chainId
        projectId
        version
        balance
        volume
        volumeUsd
      }
    }
  }
`

// Query to get participants across all chains via suckerGroupId
export const SUCKER_GROUP_PARTICIPANTS_QUERY = `
  query SuckerGroupParticipants(
    $suckerGroupId: String!
    $version: Int!
    $limit: Int
    $offset: Int
  ) {
    participants(
      where: {
        suckerGroupId: $suckerGroupId
        version: $version
        balance_gt: "0"
      }
      limit: $limit
      offset: $offset
      orderBy: "balance"
      orderDirection: "desc"
    ) {
      totalCount
      items {
        address
        chainId
        balance
        volume
        volumeUsd
      }
    }
  }
`

// Query to get project with suckerGroupId (also fetches balance for single-chain projects)
export const PROJECT_SUCKER_GROUP_QUERY = `
  query ProjectSuckerGroup($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      balance
      volume
      volumeUsd
      token
      decimals
      currency
      paymentsCount
      suckerGroupId
    }
  }
`

// Query to get suckerGroup directly by ID with aggregated balance and volume
export const SUCKER_GROUP_BY_ID_QUERY = `
  query SuckerGroupById($id: String!) {
    suckerGroup(id: $id) {
      id
      balance
      volume
      volumeUsd
      tokenSupply
      paymentsCount
      contributorsCount
      projects {
        items {
          projectId
          chainId
          balance
          volume
          tokenSupply
          paymentsCount
          token
          decimals
          currency
        }
      }
    }
  }
`

// Query to get cash out tax snapshots for floor price history
export const CASH_OUT_TAX_SNAPSHOTS_QUERY = `
  query CashOutTaxSnapshots($suckerGroupId: String!, $limit: Int, $after: String) {
    cashOutTaxSnapshots(
      where: { suckerGroupId: $suckerGroupId }
      orderBy: "start"
      orderDirection: "asc"
      limit: $limit
      after: $after
    ) {
      items {
        cashOutTax
        start
        duration
        rulesetId
        suckerGroupId
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Query to get sucker group moments (balance/supply snapshots over time)
export const SUCKER_GROUP_MOMENTS_QUERY = `
  query SuckerGroupMoments($suckerGroupId: String!, $limit: Int, $after: String) {
    suckerGroupMoments(
      where: { suckerGroupId: $suckerGroupId }
      orderBy: "timestamp"
      orderDirection: "asc"
      limit: $limit
      after: $after
    ) {
      items {
        timestamp
        balance
        tokenSupply
        suckerGroupId
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Query to get pay events for volume over time
export const PAY_EVENTS_HISTORY_QUERY = `
  query PayEventsHistory($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int, $after: String) {
    payEvents(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      limit: $limit
      orderBy: "timestamp"
      orderDirection: "asc"
      after: $after
    ) {
      items {
        amount
        amountUsd
        timestamp
        from
        newlyIssuedTokenCount
        txHash
        memo
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Query to get cash out events for redemption history
export const CASH_OUT_EVENTS_HISTORY_QUERY = `
  query CashOutEventsHistory($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int, $after: String) {
    cashOutTokensEvents(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      limit: $limit
      orderBy: "timestamp"
      orderDirection: "asc"
      after: $after
    ) {
      items {
        reclaimAmount
        reclaimAmountUsd
        cashOutCount
        timestamp
        from
        txHash
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Query to get historical per-chain balance snapshots
export const PROJECT_MOMENTS_QUERY = `
  query ProjectMoments($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int, $after: String) {
    projectMoments(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      limit: $limit
      orderBy: "timestamp"
      orderDirection: "asc"
      after: $after
    ) {
      items {
        timestamp
        block
        balance
        volume
        volumeUsd
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Candidate Revnet operators come from indexed permission-holder events. The
// current operator is verified against the live REVOwner contract before use.
export const REVNET_OPERATOR_QUERY = `
  query RevnetOperator($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!) {
    permissionHolders(
      where: {
        projectId: $projectId
        chainId: $chainId
        version: $version
        isRevnetOperator: true
      }
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        operator
        account
        projectId
        chainId
        version
        isRevnetOperator
        permissions
      }
    }
  }
`

// Everything an account has done OR received across projects. The from-branch
// mirrors ACTIVITY_EVENTS_QUERY's selection set (plus sub-event ids so the
// merge can dedupe). The top-level activityEventFilter has NO beneficiary
// field, so events where the account only receives value (payments to them,
// mints, automints) are fetched from the beneficiary-bearing event roots and
// merged client-side (mergeAccountActivityEvents). Every branch pins version 6
// in an explicit AND group — this Ponder version does not AND sibling fields
// inside OR branches.
const ACCOUNT_ACTIVITY_PROJECT_FIELDS = `
        project {
          projectId
          name
          handle
          logoUri
          decimals
          currency
        }`

export const ACCOUNT_ACTIVITY_EVENTS_QUERY = `
  query AccountActivityEvents($address: String!, $limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    activityEvents(
      where: { AND: [{ from: $address }, { version: 6 }] }
      limit: $limit
      offset: $offset
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        from
        txHash
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
        payEvent {
          id
          amount
          amountUsd
          from
          txHash
        }
        projectCreateEvent {
          from
          txHash
        }
        cashOutTokensEvent {
          id
          reclaimAmount
          from
          txHash
        }
        addToBalanceEvent {
          amount
          from
          txHash
        }
        mintTokensEvent {
          id
          tokenCount
          beneficiary
          from
          txHash
        }
        manualMintTokensEvent {
          id
          tokenCount: beneficiaryTokenCount
          beneficiary
          from
          txHash
        }
        autoIssueEvent {
          id
          tokenCount: count
          beneficiary
          from
          txHash
        }
        burnEvent {
          amount
          from
          txHash
        }
        deployErc20Event {
          symbol
          from
          txHash
        }
        sendPayoutsEvent {
          amount
          from
          txHash
        }
        sendReservedTokensToSplitsEvent {
          from
          txHash
        }
        useAllowanceEvent {
          amount
          from
          txHash
        }
        mintNftEvent {
          from
          txHash
        }
      }
    }
    beneficiaryPayEvents: payEvents(
      where: { AND: [{ beneficiary: $address }, { from_not: $address }, { version: 6 }] }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        txHash
        from
        beneficiary
        amount
        amountUsd
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
      }
    }
    beneficiaryCashOutEvents: cashOutTokensEvents(
      where: { AND: [{ beneficiary: $address }, { from_not: $address }, { version: 6 }] }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        txHash
        from
        beneficiary
        reclaimAmount
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
      }
    }
    beneficiaryMintTokensEvents: mintTokensEvents(
      where: { AND: [{ beneficiary: $address }, { from_not: $address }, { version: 6 }] }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        txHash
        from
        beneficiary
        tokenCount: beneficiaryTokenCount
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
      }
    }
    beneficiaryManualMintTokensEvents: manualMintTokensEvents(
      where: { AND: [{ beneficiary: $address }, { from_not: $address }, { version: 6 }] }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        txHash
        from
        beneficiary
        tokenCount: beneficiaryTokenCount
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
      }
    }
    beneficiaryAutoIssueEvents: autoIssueEvents(
      where: { AND: [{ beneficiary: $address }, { from_not: $address }, { version: 6 }] }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        chainId
        timestamp
        txHash
        from
        beneficiary
        tokenCount: count
${ACCOUNT_ACTIVITY_PROJECT_FIELDS}
      }
    }
  }
`

// Every V6 project token balance an account holds, biggest first (the site is
// V6-only — legacy versions live on juicebox.money). suckerGroupId drives the
// cross-chain grouping; creditBalance/erc20Balance split the total into
// unclaimed credits vs claimed ERC-20. totalCount lets the view surface
// truncation when the account holds more rows than the window.
export const ACCOUNT_TOKEN_HOLDINGS_QUERY = `
  query AccountTokenHoldings($account: String!, $limit: Int, $offset: Int) {
    participants(
      where: { address: $account, balance_gt: "0", version: 6 }
      orderBy: "balance"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        chainId
        projectId
        version
        balance
        creditBalance
        erc20Balance
        suckerGroupId
      }
    }
  }
`

// Every V6 store item (721 token) an account currently owns, newest first.
// The hook address is selected because it is part of the token's identity —
// JB721 tokenIds repeat across every collection on a chain.
export const ACCOUNT_NFTS_QUERY = `
  query AccountNfts($owner: String!, $limit: Int, $offset: Int) {
    nfts(
      where: { owner: $owner, version: 6 }
      orderBy: "createdAt"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        chainId
        projectId
        hook {
          address
        }
        tokenId
        tierId
      }
    }
  }
`

// Every project an account can operate on someone's behalf: permissionHolders
// filtered by operator. Grouping by (chainId, projectId) happens client-side.
export const ACCOUNT_PERMISSION_HOLDERS_QUERY = `
  query AccountPermissionHolders($operator: String!, $version: Int!, $limit: Int!, $offset: Int!) {
    permissionHolders(
      where: { operator: $operator, version: $version }
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        chainId
        projectId
        account
        operator
        permissions
        isRevnetOperator
      }
    }
  }
`

const ACTIVITY_EVENT_SELECTION = `
  id
  chainId
  timestamp
  from
  txHash
  project {
    projectId
    name
    handle
    logoUri
    decimals
    currency
  }
  payEvent { amount amountUsd from txHash }
  projectCreateEvent { from txHash }
  cashOutTokensEvent { reclaimAmount from txHash }
  addToBalanceEvent { amount from txHash }
  mintTokensEvent { tokenCount beneficiary from txHash }
  manualMintTokensEvent { tokenCount: beneficiaryTokenCount beneficiary from txHash }
  autoIssueEvent { tokenCount: count beneficiary from txHash }
  burnEvent { amount from txHash }
  deployErc20Event { symbol from txHash }
  sendPayoutsEvent { amount from txHash }
  sendReservedTokensToSplitsEvent { from txHash }
  useAllowanceEvent { amount from txHash }
  mintNftEvent { from txHash }
  sendPayoutToSplitEvent { amount beneficiary from txHash }
  sendReservedTokensToSplitEvent { tokenCount beneficiary from txHash }
  borrowLoanEvent { borrowAmount collateral beneficiary from txHash }
  repayLoanEvent { repayBorrowAmount collateralCountToReturn from txHash }
  liquidateLoanEvent { borrowAmount collateral from txHash }
  setUriEvent { caller from txHash }
  projectTransferEvent { owner from txHash }
  operatorPermissionsSetEvent { caller from txHash }
  addNftTierEvent { caller from txHash }
  removeNftTierEvent { caller from txHash }
  swapEvent { terminalTokenAmount caller from txHash }
  buybackPoolEvent { caller from txHash }
  bridgeClaimEvent { terminalTokenAmount beneficiary from txHash }
`

export const ACTIVITY_EVENTS_QUERY = `
  query ActivityEvents($limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    activityEvents(
      where: { version: 6 }
      limit: $limit
      offset: $offset
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      items {
        ${ACTIVITY_EVENT_SELECTION}
      }
    }
  }
`

export const PROJECT_ACTIVITY_EVENTS_QUERY = `
  query ProjectActivityEvents(
    $suckerGroupId: String!
    $limit: Int!
    $offset: Int!
  ) {
    activityEvents(
      where: { suckerGroupId: $suckerGroupId, version: 6 }
      limit: $limit
      offset: $offset
      orderBy: "timestamp"
      orderDirection: "desc"
    ) {
      items { ${ACTIVITY_EVENT_SELECTION} }
      totalCount
    }
  }
`

export const SINGLE_PROJECT_ACTIVITY_EVENTS_QUERY = `
  query SingleProjectActivityEvents(
    $projectId: Int!
    $chainId: Int!
    $limit: Int!
    $offset: Int!
  ) {
    activityEvents(
      where: { projectId: $projectId, chainId: $chainId, version: 6 }
      limit: $limit
      offset: $offset
      orderBy: "timestamp"
      orderDirection: "desc"
    ) {
      items { ${ACTIVITY_EVENT_SELECTION} }
      totalCount
    }
  }
`
