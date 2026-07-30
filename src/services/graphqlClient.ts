import {
  requestBendystraw,
} from '@bananapus/nana-sdk-core'
import { compileBendystrawOperation } from './bendystrawOperation'

export type RequestDocument = string
export type Variables = Record<string, unknown>

export async function bendystrawOperationId(document: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(document),
  )
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function isPersistedOperationProxy(endpoint: string): boolean {
  try {
    return new URL(endpoint, 'https://local.invalid').pathname.endsWith('/proxy/bendystraw')
  } catch {
    return false
  }
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
    const contract = compileBendystrawOperation(document)
    const persistedOperation = isPersistedOperationProxy(this.endpoint)
      ? await bendystrawOperationId(document)
      : undefined
    return requestBendystraw<T, Variables>(this.endpoint, document, variables, {
      fetch: persistedOperation
        ? (input, init) =>
            fetch(input, {
              ...init,
              body: JSON.stringify({ operation: persistedOperation, variables }),
            })
        : undefined,
      operationName: contract.operationName,
      validateData: (value): value is T => contract.validateData(value),
      validateVariables: contract.validateVariables,
    })
  }
}
