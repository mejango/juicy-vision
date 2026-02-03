/**
 * Bendystraw GraphQL Client
 *
 * Server-side client for querying Bendystraw API.
 * Used for payment verification and project data.
 */

import { getConfig } from '../utils/config.ts'

// =============================================================================
// Types
// =============================================================================

export interface Participant {
  id: string
  address: string
  balance: string
  volume: string
  stakedBalance: string
  lastPaidTimestamp: number | null
}

export interface Project {
  id: string
  projectId: number
  chainId: number
  owner: string
  name?: string
  handle?: string
  logoUri?: string
}

// =============================================================================
// GraphQL Queries
// =============================================================================

const USER_PARTICIPANT_QUERY = `
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

const PROJECT_QUERY = `
  query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
      owner
      name
      handle
      logoUri
    }
  }
`

// =============================================================================
// API Client
// =============================================================================

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function queryBendystraw<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  const config = getConfig()

  if (!config.bendystrawApiKey) {
    console.error('Bendystraw API key not configured')
    return null
  }

  const endpoint = `https://bendystraw.xyz/${config.bendystrawApiKey}/graphql`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Bendystraw query failed:', response.status, errorText)
      return null
    }

    const result: GraphQLResponse<T> = await response.json()

    if (result.errors?.length) {
      console.error('Bendystraw GraphQL errors:', result.errors)
      return null
    }

    return result.data || null
  } catch (error) {
    console.error('Bendystraw query error:', error)
    return null
  }
}

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Check if an address has paid a specific project.
 * Returns the participant record if they have, null otherwise.
 */
export async function getParticipant(
  projectId: number,
  chainId: number,
  address: string
): Promise<Participant | null> {
  const data = await queryBendystraw<{
    participants: { items: Participant[]; totalCount: number }
  }>(USER_PARTICIPANT_QUERY, {
    projectId,
    chainId,
    address: address.toLowerCase(),
  })

  if (!data?.participants?.items?.length) {
    return null
  }

  return data.participants.items[0]
}

/**
 * Check if an address has paid a project (volume > 0).
 */
export async function hasAddressPaidProject(
  projectId: number,
  chainId: number,
  address: string
): Promise<boolean> {
  const participant = await getParticipant(projectId, chainId, address)

  if (!participant) {
    return false
  }

  // Check if volume > 0 (they've sent payments)
  const volume = BigInt(participant.volume || '0')
  return volume > 0n
}

/**
 * Get project info by ID.
 */
export async function getProject(
  projectId: number,
  chainId: number,
  version: number = 5
): Promise<Project | null> {
  const data = await queryBendystraw<{ project: Project | null }>(
    PROJECT_QUERY,
    { projectId, chainId, version }
  )

  return data?.project || null
}

/**
 * Check if an address owns a project.
 */
export async function isProjectOwner(
  projectId: number,
  chainId: number,
  address: string
): Promise<boolean> {
  const project = await getProject(projectId, chainId)

  if (!project) {
    return false
  }

  return project.owner.toLowerCase() === address.toLowerCase()
}
