export type RequestDocument = string
export type Variables = Record<string, unknown>

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message?: unknown }>
}

function responseErrorMessage(response: GraphQLResponse<unknown>): string | undefined {
  const messages = response.errors
    ?.map((error) => error.message)
    .filter((message): message is string => typeof message === 'string' && message.length > 0)
  return messages?.length ? messages.join('; ') : undefined
}

/**
 * Minimal GraphQL-over-HTTP transport for Bendystraw.
 *
 * The frontend only sends static string documents and JSON variables, so a
 * general GraphQL parser/client adds no runtime capability. Keeping this
 * transport local also lets us validate malformed and partial responses before
 * indexed data reaches the product UI.
 */
export class GraphQLClient {
  constructor(private readonly endpoint: string) {}

  async request<T>(document: RequestDocument, variables: Variables = {}): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/graphql-response+json, application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: document, variables }),
    })

    let payload: GraphQLResponse<T>
    try {
      payload = await response.json() as GraphQLResponse<T>
    } catch {
      throw new Error(`Bendystraw returned an invalid response (${response.status})`)
    }

    const graphQLError = responseErrorMessage(payload)
    if (!response.ok || graphQLError) {
      throw new Error(graphQLError ?? `Bendystraw request failed (${response.status})`)
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new Error('Bendystraw response is missing data')
    }

    return payload.data as T
  }
}
