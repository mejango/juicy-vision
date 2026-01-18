export const PROJECT_QUERY = `
  query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
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
      }
    }
  }
`

export const PARTICIPANTS_QUERY = `
  query Participants($projectId: Int!, $chainId: Int, $first: Int) {
    participants(
      where: { project_: { projectId: $projectId, chainId: $chainId } }
      first: $first
      orderBy: balance
      orderDirection: desc
    ) {
      id
      wallet
      balance
      volume
      stakedBalance
      lastPaidTimestamp
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

// Query to check a specific user's token balance for a project
export const USER_PARTICIPANT_QUERY = `
  query UserParticipant($projectId: Int!, $chainId: Int, $wallet: String!) {
    participants(
      where: {
        project_: { projectId: $projectId, chainId: $chainId }
        wallet: $wallet
      }
      first: 1
    ) {
      id
      wallet
      balance
      volume
      stakedBalance
      lastPaidTimestamp
    }
  }
`

// Query to get project info for permission checks
// Note: Ruleset data must be fetched from the blockchain directly
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
export const RECENT_PAY_EVENTS_QUERY = `
  query RecentPayEvents($projectId: Float!, $chainId: Float!, $version: Float!) {
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

// Query to get suckerGroup with balance info for total balance calculation
export const SUCKER_GROUP_BALANCE_QUERY = `
  query SuckerGroupBalance($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      balance
      suckerGroup {
        projects {
          items {
            projectId
            chainId
            balance
          }
        }
      }
    }
  }
`

// Query to get participants (token holders) with balance > 0 for owners count
export const TOKEN_HOLDERS_QUERY = `
  query TokenHolders($projectId: Int!, $chainId: Int, $first: Int) {
    participants(
      where: {
        project_: { projectId: $projectId, chainId: $chainId }
        balance_gt: "0"
      }
      first: $first
      orderBy: balance
      orderDirection: desc
    ) {
      id
      wallet
      balance
    }
  }
`

export const ACTIVITY_EVENTS_QUERY = `
  query ActivityEvents($limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
    activityEvents(
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
