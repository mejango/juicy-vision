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
  query ProjectsByOwner($owner: String!, $limit: Int) {
    projects(
      where: { owner: $owner, version: 6 }
      limit: $limit
      orderBy: "createdAt"
      orderDirection: "desc"
    ) {
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
      items {
        id
        projectId
        chainId
        version
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
  query TokenHolders($projectId: Int!, $chainIds: [Int!]!, $version: Int!, $limit: Int) {
    participants(
      where: {
        projectId: $projectId
        chainId_in: $chainIds
        version: $version
        balance_gt: "0"
      }
      limit: $limit
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

// Query to get participants across all chains via suckerGroupId
export const SUCKER_GROUP_PARTICIPANTS_QUERY = `
  query SuckerGroupParticipants($suckerGroupId: String!, $version: Int!, $limit: Int) {
    participants(
      where: {
        suckerGroupId: $suckerGroupId
        version: $version
        balance_gt: "0"
      }
      limit: $limit
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
  query RevnetOperator($projectId: Int!, $chainId: Int!, $version: Int!) {
    permissionHolders(
      where: {
        projectId: $projectId
        chainId: $chainId
        version: $version
        isRevnetOperator: true
      }
      limit: 10
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

// Everything an account has done across projects: same selection set as
// ACTIVITY_EVENTS_QUERY, filtered by the event's top-level `from` address.
export const ACCOUNT_ACTIVITY_EVENTS_QUERY = `
  query AccountActivityEvents($address: String!, $limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    activityEvents(
      where: { version: 6, from: $address }
      limit: $limit
      offset: $offset
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      items {
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
        payEvent {
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
          tokenCount
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
  }
`

// Every project an account can operate on someone's behalf: permissionHolders
// filtered by operator. Grouping by (chainId, projectId) happens client-side.
export const ACCOUNT_PERMISSION_HOLDERS_QUERY = `
  query AccountPermissionHolders($operator: String!, $version: Int!, $limit: Int) {
    permissionHolders(
      where: { operator: $operator, version: $version }
      limit: $limit
    ) {
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
        payEvent {
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
          tokenCount
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
  }
`
