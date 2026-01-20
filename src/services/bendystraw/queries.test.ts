import { describe, it, expect } from 'vitest'
import {
  PROJECT_QUERY,
  PROJECTS_QUERY,
  PARTICIPANTS_QUERY,
  SEARCH_PROJECTS_QUERY,
  ACTIVITY_EVENTS_QUERY,
  USER_PARTICIPANT_QUERY,
  PROJECT_RULESET_QUERY,
  RECENT_PAY_EVENTS_QUERY,
  CONNECTED_CHAINS_QUERY,
  TOKEN_HOLDERS_QUERY,
  SUCKER_GROUP_PARTICIPANTS_QUERY,
  PROJECT_SUCKER_GROUP_QUERY,
  SUCKER_GROUP_BY_ID_QUERY,
  CASH_OUT_TAX_SNAPSHOTS_QUERY,
  SUCKER_GROUP_MOMENTS_QUERY,
  PAY_EVENTS_HISTORY_QUERY,
  CASH_OUT_EVENTS_HISTORY_QUERY,
  REVNET_OPERATOR_QUERY,
} from './queries'

describe('GraphQL Query Structure', () => {
  describe('PROJECT_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PROJECT_QUERY).toBe('string')
      expect(PROJECT_QUERY).toContain('query Project')
    })

    it('accepts projectId, chainId, and version variables', () => {
      expect(PROJECT_QUERY).toContain('$projectId: Float!')
      expect(PROJECT_QUERY).toContain('$chainId: Float!')
      expect(PROJECT_QUERY).toContain('$version: Float!')
    })

    it('requests essential project fields', () => {
      expect(PROJECT_QUERY).toContain('projectId')
      expect(PROJECT_QUERY).toContain('chainId')
      expect(PROJECT_QUERY).toContain('owner')
      expect(PROJECT_QUERY).toContain('metadataUri')
      expect(PROJECT_QUERY).toContain('metadata')
      expect(PROJECT_QUERY).toContain('volume')
      expect(PROJECT_QUERY).toContain('balance')
    })
  })

  describe('PROJECTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PROJECTS_QUERY).toBe('string')
      expect(PROJECTS_QUERY).toContain('query Projects')
    })

    it('accepts pagination and ordering variables', () => {
      expect(PROJECTS_QUERY).toContain('$limit: Int')
      expect(PROJECTS_QUERY).toContain('$offset: Int')
      expect(PROJECTS_QUERY).toContain('$orderBy: String')
      expect(PROJECTS_QUERY).toContain('$orderDirection: String')
    })

    it('requests items array with project fields', () => {
      expect(PROJECTS_QUERY).toContain('items')
      expect(PROJECTS_QUERY).toContain('projectId')
      expect(PROJECTS_QUERY).toContain('name')
      expect(PROJECTS_QUERY).toContain('volume')
    })

    it('includes trending fields', () => {
      expect(PROJECTS_QUERY).toContain('trendingScore')
      expect(PROJECTS_QUERY).toContain('trendingVolume')
      expect(PROJECTS_QUERY).toContain('trendingPaymentsCount')
    })
  })

  describe('PARTICIPANTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PARTICIPANTS_QUERY).toBe('string')
      expect(PARTICIPANTS_QUERY).toContain('query Participants')
    })

    it('accepts projectId, chainId, and limit variables', () => {
      expect(PARTICIPANTS_QUERY).toContain('$projectId: Int!')
      expect(PARTICIPANTS_QUERY).toContain('$chainId: Int!')
      expect(PARTICIPANTS_QUERY).toContain('$limit: Int')
    })

    it('orders by balance descending', () => {
      expect(PARTICIPANTS_QUERY).toContain('orderBy: "balance"')
      expect(PARTICIPANTS_QUERY).toContain('orderDirection: "desc"')
    })

    it('requests participant fields', () => {
      expect(PARTICIPANTS_QUERY).toContain('address')
      expect(PARTICIPANTS_QUERY).toContain('balance')
      expect(PARTICIPANTS_QUERY).toContain('volume')
      expect(PARTICIPANTS_QUERY).toContain('stakedBalance')
    })
  })

  describe('SEARCH_PROJECTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof SEARCH_PROJECTS_QUERY).toBe('string')
      expect(SEARCH_PROJECTS_QUERY).toContain('query SearchProjects')
    })

    it('accepts text and first variables', () => {
      expect(SEARCH_PROJECTS_QUERY).toContain('$text: String!')
      expect(SEARCH_PROJECTS_QUERY).toContain('$first: Int')
    })

    it('uses projectSearch field', () => {
      expect(SEARCH_PROJECTS_QUERY).toContain('projectSearch')
    })

    it('requests metadata nested fields', () => {
      expect(SEARCH_PROJECTS_QUERY).toContain('metadata')
      expect(SEARCH_PROJECTS_QUERY).toContain('name')
      expect(SEARCH_PROJECTS_QUERY).toContain('description')
      expect(SEARCH_PROJECTS_QUERY).toContain('logoUri')
    })
  })

  describe('ACTIVITY_EVENTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof ACTIVITY_EVENTS_QUERY).toBe('string')
      expect(ACTIVITY_EVENTS_QUERY).toContain('query ActivityEvents')
    })

    it('accepts pagination and ordering variables', () => {
      expect(ACTIVITY_EVENTS_QUERY).toContain('$limit: Int')
      expect(ACTIVITY_EVENTS_QUERY).toContain('$offset: Int')
      expect(ACTIVITY_EVENTS_QUERY).toContain('$orderBy: String')
      expect(ACTIVITY_EVENTS_QUERY).toContain('$orderDirection: String')
    })

    it('includes all event types', () => {
      expect(ACTIVITY_EVENTS_QUERY).toContain('payEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('projectCreateEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('cashOutTokensEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('addToBalanceEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('mintTokensEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('burnEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('deployErc20Event')
      expect(ACTIVITY_EVENTS_QUERY).toContain('sendPayoutsEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('useAllowanceEvent')
      expect(ACTIVITY_EVENTS_QUERY).toContain('mintNftEvent')
    })

    it('includes project info for context', () => {
      expect(ACTIVITY_EVENTS_QUERY).toContain('project')
      expect(ACTIVITY_EVENTS_QUERY).toContain('handle')
      expect(ACTIVITY_EVENTS_QUERY).toContain('logoUri')
    })
  })

  describe('USER_PARTICIPANT_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof USER_PARTICIPANT_QUERY).toBe('string')
      expect(USER_PARTICIPANT_QUERY).toContain('query UserParticipant')
    })

    it('accepts projectId, chainId, and address variables', () => {
      expect(USER_PARTICIPANT_QUERY).toContain('$projectId: Int!')
      expect(USER_PARTICIPANT_QUERY).toContain('$chainId: Int!')
      expect(USER_PARTICIPANT_QUERY).toContain('$address: String!')
    })

    it('limits to 1 result', () => {
      expect(USER_PARTICIPANT_QUERY).toContain('limit: 1')
    })
  })

  describe('PROJECT_RULESET_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PROJECT_RULESET_QUERY).toBe('string')
      expect(PROJECT_RULESET_QUERY).toContain('query ProjectRuleset')
    })

    it('requests owner and metadata for permission checks', () => {
      expect(PROJECT_RULESET_QUERY).toContain('owner')
      expect(PROJECT_RULESET_QUERY).toContain('metadata')
      expect(PROJECT_RULESET_QUERY).toContain('balance')
    })
  })

  describe('RECENT_PAY_EVENTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof RECENT_PAY_EVENTS_QUERY).toBe('string')
      expect(RECENT_PAY_EVENTS_QUERY).toContain('query RecentPayEvents')
    })

    it('orders by timestamp descending', () => {
      expect(RECENT_PAY_EVENTS_QUERY).toContain('orderBy: "timestamp"')
      expect(RECENT_PAY_EVENTS_QUERY).toContain('orderDirection: "desc"')
    })

    it('limits to 5 events for issuance calculation', () => {
      expect(RECENT_PAY_EVENTS_QUERY).toContain('limit: 5')
    })

    it('requests amount and token count for issuance rate', () => {
      expect(RECENT_PAY_EVENTS_QUERY).toContain('amount')
      expect(RECENT_PAY_EVENTS_QUERY).toContain('newlyIssuedTokenCount')
    })
  })

  describe('CONNECTED_CHAINS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof CONNECTED_CHAINS_QUERY).toBe('string')
      expect(CONNECTED_CHAINS_QUERY).toContain('query ConnectedChains')
    })

    it('requests suckerGroup with connected projects', () => {
      expect(CONNECTED_CHAINS_QUERY).toContain('suckerGroup')
      expect(CONNECTED_CHAINS_QUERY).toContain('projects')
      expect(CONNECTED_CHAINS_QUERY).toContain('items')
    })
  })

  describe('TOKEN_HOLDERS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof TOKEN_HOLDERS_QUERY).toBe('string')
      expect(TOKEN_HOLDERS_QUERY).toContain('query TokenHolders')
    })

    it('filters for balance > 0', () => {
      expect(TOKEN_HOLDERS_QUERY).toContain('balance_gt: "0"')
    })

    it('orders by balance descending', () => {
      expect(TOKEN_HOLDERS_QUERY).toContain('orderBy: "balance"')
      expect(TOKEN_HOLDERS_QUERY).toContain('orderDirection: "desc"')
    })
  })

  describe('SUCKER_GROUP_PARTICIPANTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof SUCKER_GROUP_PARTICIPANTS_QUERY).toBe('string')
      expect(SUCKER_GROUP_PARTICIPANTS_QUERY).toContain('query SuckerGroupParticipants')
    })

    it('accepts suckerGroupId variable', () => {
      expect(SUCKER_GROUP_PARTICIPANTS_QUERY).toContain('$suckerGroupId: String!')
    })

    it('filters for balance > 0', () => {
      expect(SUCKER_GROUP_PARTICIPANTS_QUERY).toContain('balance_gt: "0"')
    })
  })

  describe('PROJECT_SUCKER_GROUP_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PROJECT_SUCKER_GROUP_QUERY).toBe('string')
      expect(PROJECT_SUCKER_GROUP_QUERY).toContain('query ProjectSuckerGroup')
    })

    it('requests suckerGroupId', () => {
      expect(PROJECT_SUCKER_GROUP_QUERY).toContain('suckerGroupId')
    })
  })

  describe('SUCKER_GROUP_BY_ID_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof SUCKER_GROUP_BY_ID_QUERY).toBe('string')
      expect(SUCKER_GROUP_BY_ID_QUERY).toContain('query SuckerGroupById')
    })

    it('accepts id variable', () => {
      expect(SUCKER_GROUP_BY_ID_QUERY).toContain('$id: String!')
    })

    it('requests aggregated balance and supply', () => {
      expect(SUCKER_GROUP_BY_ID_QUERY).toContain('balance')
      expect(SUCKER_GROUP_BY_ID_QUERY).toContain('tokenSupply')
      expect(SUCKER_GROUP_BY_ID_QUERY).toContain('paymentsCount')
    })
  })

  describe('CASH_OUT_TAX_SNAPSHOTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof CASH_OUT_TAX_SNAPSHOTS_QUERY).toBe('string')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('query CashOutTaxSnapshots')
    })

    it('accepts suckerGroupId, limit, and after variables', () => {
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('$suckerGroupId: String!')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('$limit: Int')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('$after: String')
    })

    it('orders by start ascending for floor price history', () => {
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('orderBy: "start"')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('orderDirection: "asc"')
    })

    it('includes pageInfo for pagination', () => {
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('pageInfo')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('hasNextPage')
      expect(CASH_OUT_TAX_SNAPSHOTS_QUERY).toContain('endCursor')
    })
  })

  describe('SUCKER_GROUP_MOMENTS_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof SUCKER_GROUP_MOMENTS_QUERY).toBe('string')
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('query SuckerGroupMoments')
    })

    it('orders by timestamp ascending', () => {
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('orderBy: "timestamp"')
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('orderDirection: "asc"')
    })

    it('requests balance and tokenSupply over time', () => {
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('timestamp')
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('balance')
      expect(SUCKER_GROUP_MOMENTS_QUERY).toContain('tokenSupply')
    })
  })

  describe('PAY_EVENTS_HISTORY_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof PAY_EVENTS_HISTORY_QUERY).toBe('string')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('query PayEventsHistory')
    })

    it('accepts projectId, chainId, version, limit, and after variables', () => {
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('$projectId: Int!')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('$chainId: Int!')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('$version: Int!')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('$limit: Int')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('$after: String')
    })

    it('requests payment details', () => {
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('amount')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('amountUsd')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('from')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('memo')
      expect(PAY_EVENTS_HISTORY_QUERY).toContain('txHash')
    })
  })

  describe('CASH_OUT_EVENTS_HISTORY_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof CASH_OUT_EVENTS_HISTORY_QUERY).toBe('string')
      expect(CASH_OUT_EVENTS_HISTORY_QUERY).toContain('query CashOutEventsHistory')
    })

    it('queries cashOutTokensEvents', () => {
      expect(CASH_OUT_EVENTS_HISTORY_QUERY).toContain('cashOutTokensEvents')
    })

    it('requests reclaim amount and cash out count', () => {
      expect(CASH_OUT_EVENTS_HISTORY_QUERY).toContain('reclaimAmount')
      expect(CASH_OUT_EVENTS_HISTORY_QUERY).toContain('cashOutCount')
    })
  })

  describe('REVNET_OPERATOR_QUERY', () => {
    it('is a valid GraphQL query string', () => {
      expect(typeof REVNET_OPERATOR_QUERY).toBe('string')
      expect(REVNET_OPERATOR_QUERY).toContain('query RevnetOperator')
    })

    it('accepts projectId and chainId variables', () => {
      expect(REVNET_OPERATOR_QUERY).toContain('$projectId: Int!')
      expect(REVNET_OPERATOR_QUERY).toContain('$chainId: Int!')
    })

    it('filters for isRevnetOperator true', () => {
      expect(REVNET_OPERATOR_QUERY).toContain('isRevnetOperator: true')
    })

    it('requests permission holder details', () => {
      expect(REVNET_OPERATOR_QUERY).toContain('operator')
      expect(REVNET_OPERATOR_QUERY).toContain('account')
      expect(REVNET_OPERATOR_QUERY).toContain('permissions')
    })
  })
})

describe('Query Consistency', () => {
  it('all queries use consistent Float types for project identifiers', () => {
    const queriesWithProjectParams = [
      PROJECT_QUERY,
      PROJECT_RULESET_QUERY,
      CONNECTED_CHAINS_QUERY,
      PROJECT_SUCKER_GROUP_QUERY,
    ]

    for (const query of queriesWithProjectParams) {
      // These queries should use Float for main project lookup
      expect(query).toContain('$projectId: Float!')
    }
  })

  it('all queries use consistent Int types for filter variables', () => {
    const queriesWithIntParams = [
      PARTICIPANTS_QUERY,
      USER_PARTICIPANT_QUERY,
      RECENT_PAY_EVENTS_QUERY,
      TOKEN_HOLDERS_QUERY,
      PAY_EVENTS_HISTORY_QUERY,
      CASH_OUT_EVENTS_HISTORY_QUERY,
      REVNET_OPERATOR_QUERY,
    ]

    for (const query of queriesWithIntParams) {
      // These queries should use Int for filter where clauses
      expect(query).toContain('$projectId: Int!')
    }
  })

  it('all paginated queries include pageInfo', () => {
    const paginatedQueries = [
      CASH_OUT_TAX_SNAPSHOTS_QUERY,
      SUCKER_GROUP_MOMENTS_QUERY,
      PAY_EVENTS_HISTORY_QUERY,
      CASH_OUT_EVENTS_HISTORY_QUERY,
    ]

    for (const query of paginatedQueries) {
      expect(query).toContain('pageInfo')
      expect(query).toContain('hasNextPage')
    }
  })
})
