import { describe, expect, it, vi } from 'vitest'
import { type Address, type PublicClient, zeroAddress } from 'viem'
import {
  getPaymentTerminal,
  getProjectController,
  requireRecognizedTerminal,
} from './paymentTerminal'
import {
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL,
  JB_ROUTER_TERMINAL_REGISTRY,
  NATIVE_TOKEN,
} from '../constants'

const UNKNOWN_CONTRACT = '0x9999999999999999999999999999999999999999' as Address

function clientReturning(...values: unknown[]): Pick<PublicClient, 'readContract'> {
  return {
    readContract: vi.fn().mockImplementation(() => Promise.resolve(values.shift())),
  } as unknown as Pick<PublicClient, 'readContract'>
}

describe('project contract discovery', () => {
  it('blocks an unknown payment terminal without an interface fallback', async () => {
    const client = clientReturning(UNKNOWN_CONTRACT)

    await expect(getPaymentTerminal(client, 1, 1n, NATIVE_TOKEN)).rejects.toThrow(
      `Terminal not recognized for pay: ${UNKNOWN_CONTRACT}`,
    )
    expect(client.readContract).toHaveBeenCalledTimes(1)
  })

  it('blocks a missing payment terminal instead of guessing a fallback', async () => {
    await expect(
      getPaymentTerminal(clientReturning(zeroAddress), 1, 1n, NATIVE_TOKEN),
    ).rejects.toThrow('This project does not accept the selected payment token')
  })

  it('accepts a recognized router only for payments', () => {
    expect(requireRecognizedTerminal(JB_ROUTER_TERMINAL_REGISTRY, 'pay').type).toBe('router')
    expect(() => requireRecognizedTerminal(JB_ROUTER_TERMINAL_REGISTRY, 'accounting')).toThrow(
      'Terminal not recognized for accounting',
    )
  })

  it('derives treasury actions from the listed multi terminal even when payments route', async () => {
    const nativeCurrency = Number(BigInt(NATIVE_TOKEN) & 0xffff_ffffn)
    const client = clientReturning(
      [JB_ROUTER_TERMINAL, JB_CONTRACTS.JBMultiTerminal],
      [{ token: NATIVE_TOKEN, decimals: 18, currency: nativeCurrency }],
    )

    await expect(getPaymentTerminal(
      client,
      1,
      1n,
      NATIVE_TOKEN,
      'accounting',
    )).resolves.toEqual({ address: JB_CONTRACTS.JBMultiTerminal, type: 'multi' })
  })

  it('blocks treasury actions when any listed terminal is unknown', async () => {
    await expect(getPaymentTerminal(
      clientReturning([JB_CONTRACTS.JBMultiTerminal, UNKNOWN_CONTRACT]),
      1,
      1n,
      NATIVE_TOKEN,
      'accounting',
    )).rejects.toThrow(`Terminal not recognized for pay: ${UNKNOWN_CONTRACT}`)
  })

  it('blocks a listed multi terminal without the selected accounting context', async () => {
    await expect(getPaymentTerminal(
      clientReturning([JB_CONTRACTS.JBMultiTerminal], []),
      1,
      1n,
      NATIVE_TOKEN,
      'accounting',
    )).rejects.toThrow('not a unique live accounting context')
  })

  it('blocks a registry payment whose downstream terminal is unknown', async () => {
    const client = clientReturning(JB_ROUTER_TERMINAL_REGISTRY, UNKNOWN_CONTRACT)

    await expect(getPaymentTerminal(client, 1, 1n, NATIVE_TOKEN)).rejects.toThrow(
      `Terminal not recognized for pay: ${UNKNOWN_CONTRACT}`,
    )
    expect(client.readContract).toHaveBeenCalledTimes(2)
  })

  it('accepts a registry payment whose downstream terminal is the multi terminal', async () => {
    await expect(getPaymentTerminal(
      clientReturning(JB_ROUTER_TERMINAL_REGISTRY, JB_CONTRACTS.JBMultiTerminal),
      1,
      1n,
      NATIVE_TOKEN,
    )).resolves.toEqual({ address: JB_ROUTER_TERMINAL_REGISTRY, type: 'router' })
  })

  it('blocks a router payment when any possible project terminal is unknown', async () => {
    const client = clientReturning(
      JB_ROUTER_TERMINAL,
      [JB_ROUTER_TERMINAL, JB_CONTRACTS.JBMultiTerminal, UNKNOWN_CONTRACT],
    )

    await expect(getPaymentTerminal(client, 1, 1n, NATIVE_TOKEN)).rejects.toThrow(
      `Terminal not recognized for pay: ${UNKNOWN_CONTRACT}`,
    )
  })

  it('accepts a router payment only when its complete terminal surface is recognized', async () => {
    await expect(getPaymentTerminal(
      clientReturning(JB_ROUTER_TERMINAL, [JB_ROUTER_TERMINAL, JB_CONTRACTS.JBMultiTerminal]),
      1,
      1n,
      NATIVE_TOKEN,
    )).resolves.toEqual({ address: JB_ROUTER_TERMINAL, type: 'router' })
  })

  it('blocks an unknown controller returned by JBDirectory', async () => {
    await expect(getProjectController(clientReturning(UNKNOWN_CONTRACT), 1n)).rejects.toThrow(
      `Controller not recognized: ${UNKNOWN_CONTRACT}`,
    )
  })

  it('accepts the recognized controller returned by JBDirectory', async () => {
    await expect(
      getProjectController(clientReturning(JB_CONTRACTS.JBController), 1n),
    ).resolves.toBe(JB_CONTRACTS.JBController)
  })
})
