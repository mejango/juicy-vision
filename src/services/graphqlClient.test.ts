import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bendystrawOperationId, GraphQLClient } from './graphqlClient'

describe('GraphQLClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the document and variables and returns validated data', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { project: { id: '1' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const client = new GraphQLClient('/proxy/bendystraw')
    const query = 'query Project($id: ID!) { project(id: $id) { id } }'
    await expect(client.request(query, { id: '1' }))
      .resolves.toEqual({ project: { id: '1' } })

    expect(fetchMock).toHaveBeenCalledWith('/proxy/bendystraw', expect.objectContaining({
      method: 'POST',
      headers: {
        Accept: 'application/graphql-response+json, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation: await bendystrawOperationId(query),
        variables: { id: '1' },
      }),
    }))
  })

  it('rejects GraphQL errors even when the HTTP request succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ errors: [{ message: 'Query rejected' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))

    await expect(new GraphQLClient('/graphql').request('query { projects { id } }'))
      .rejects.toThrow('Query rejected')
  })

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({}),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))

    await expect(new GraphQLClient('/graphql').request('query { projects { id } }'))
      .rejects.toThrow('missing data')
  })

  it('rejects invalid variables and nested response shapes before callers can use them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { project: {} } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const client = new GraphQLClient('/graphql')
    const query = 'query Project($id: Int!) { project(id: $id) { id } }'

    await expect(client.request(query, { id: 'wrong' }))
      .rejects.toThrow('received invalid variables')
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(client.request(query, { id: 1 }))
      .rejects.toThrow('returned invalid data')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
