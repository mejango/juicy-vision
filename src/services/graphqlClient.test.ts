import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphQLClient } from './graphqlClient'

describe('GraphQLClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the document and variables and returns validated data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { project: { id: '1' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const client = new GraphQLClient('/proxy/bendystraw')
    await expect(client.request('query Project($id: ID!) { project(id: $id) { id } }', { id: '1' }))
      .resolves.toEqual({ project: { id: '1' } })

    expect(fetchMock).toHaveBeenCalledWith('/proxy/bendystraw', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({
        query: 'query Project($id: ID!) { project(id: $id) { id } }',
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
})
