export const PROJECT_QUERY = `
  query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
      version
      handle
      owner
      metadataUri
      metadata
      volume
      volumeUsd
      balance
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
      where: { owner: $owner }
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

// Query projects deployed by a specific address (deployer may differ from owner)
export const PROJECTS_BY_DEPLOYER_QUERY = `
  query ProjectsByDeployer($deployer: String!, $limit: Int) {
    projects(
      where: { deployer: $deployer }
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

// Uses Bendystraw schema with projectId/chainId filters and limit/items format
export const PARTICIPANTS_QUERY = `
  query Participants($projectId: Int!, $chainId: Int!, $limit: Int) {
    participants(
      where: { projectId: $projectId, chainId: $chainId }
      limit: $limit
      orderBy: "balance"
      orderDirection: "desc"
    ) {
      totalCount
      items {
        id
        address
        balance
        volume
        stakedBalance
        lastPaidTimestamp
      }
    }
  }
`

export const SEARCH_PROJECTS_QUERY = `
  query SearchProjects($text: String!, $first: Int) {
    projectSearch(text: $text, first: $first) {
      id
      projectId
      chainId
      handle
      metadata {
        name
        description
        logoUri
      }
      volume
      balance
    }
  }
`

// Semantic search using OR conditions across name, description, tags, and tagline
// This enables searching for projects by keywords that match any of these fields
export const SEMANTIC_SEARCH_PROJECTS_QUERY = `
  query SemanticSearchProjects($keyword: String!, $limit: Int) {
    projects(
      where: {
        OR: [
          { name_contains: $keyword },
          { description_contains: $keyword },
          { tags_has: $keyword },
          { projectTagline_contains: $keyword }
        ]
      }
      limit: $limit
      orderBy: "volumeUsd"
      orderDirection: "desc"
    ) {
      items {
        id
        projectId
        chainId
        version
        handle
        name
        description
        logoUri
        tags
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

// Query to check a specific user's token balance for a project
// Uses Bendystraw schema with projectId/chainId/address filters
export const USER_PARTICIPANT_QUERY = `
  query UserParticipant($projectId: Int!, $chainId: Int!, $address: String!) {
    participants(
      where: {
        projectId: $projectId
        chainId: $chainId
        address: $address
      }
      limit: 1
    ) {
      totalCount
      items {
        id
        address
        balance
        volume
        stakedBalance
        lastPaidTimestamp
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
      metadata
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

// Query to get suckerGroup with balance and payments info for total calculations
export const SUCKER_GROUP_BALANCE_QUERY = `
  query SuckerGroupBalance($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      balance
      paymentsCount
      suckerGroup {
        projects {
          items {
            projectId
            chainId
            balance
            paymentsCount
          }
        }
      }
    }
  }
`

// Query to get participants (token holders) with balance > 0 for owners count
// Uses Bendystraw schema with projectId/chainId filters and limit/items format
export const TOKEN_HOLDERS_QUERY = `
  query TokenHolders($projectId: Int!, $chainId: Int!, $limit: Int) {
    participants(
      where: {
        projectId: $projectId
        chainId: $chainId
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
      }
    }
  }
`

// Query to get participants across all chains via suckerGroupId
export const SUCKER_GROUP_PARTICIPANTS_QUERY = `
  query SuckerGroupParticipants($suckerGroupId: String!, $limit: Int) {
    participants(
      where: {
        suckerGroupId: $suckerGroupId
        balance_gt: "0"
      }
      limit: $limit
    ) {
      totalCount
      items {
        address
        chainId
        balance
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
  query ProjectMoments($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int) {
    projectMoments(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      limit: $limit
      orderBy: "timestamp"
      orderDirection: "asc"
    ) {
      items {
        timestamp
        block
        balance
        volume
        volumeUsd
      }
    }
  }
`

// Query to get Revnet operator via permission holders
// The operator is the address with isRevnetOperator=true and account=REV_DEPLOYER
export const REVNET_OPERATOR_QUERY = `
  query RevnetOperator($projectId: Int!, $chainId: Int!) {
    permissionHolders(
      where: {
        projectId: $projectId
        chainId: $chainId
        isRevnetOperator: true
      }
      limit: 10
    ) {
      items {
        operator
        account
        projectId
        chainId
        isRevnetOperator
        permissions
      }
    }
  }
`

export const ACTIVITY_EVENTS_QUERY = `
  query ActivityEvents($limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    activityEvents(
      where: { version: 5 }
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
