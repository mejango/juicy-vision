import { requestBendystraw } from '@bananapus/nana-sdk-core'

export type RequestDocument = string
export type Variables = Record<string, unknown>

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
    return requestBendystraw<T, Variables>(this.endpoint, document, variables)
  }
}
