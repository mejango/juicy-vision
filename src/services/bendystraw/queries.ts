export const PROJECT_QUERY = `
  query Project($projectId: Int!, $chainId: Int) {
    project(projectId: $projectId, chainId: $chainId) {
      id
      projectId
      chainId
      handle
      owner
      metadataUri
      metadata {
        name
        description
        logoUri
        infoUri
        twitter
        discord
        telegram
      }
      volume
      volumeUSD
      balance
      contributorsCount
      nftsMintedCount
      paymentsCount
      createdAt
    }
  }
`

export const PROJECTS_QUERY = `
  query Projects($first: Int, $skip: Int, $orderBy: Project_orderBy, $orderDirection: OrderDirection) {
    projects(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
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
      contributorsCount
      createdAt
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
