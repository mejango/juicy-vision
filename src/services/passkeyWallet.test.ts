import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signMessage: vi.fn(),
  signInWithWallet: vi.fn(),
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    signMessage: mocks.signMessage,
  }),
}))
vi.mock('./siwe', () => ({ signInWithWallet: mocks.signInWithWallet }))

import { authenticatePasskeyWallet } from './passkeyWallet'

describe('passkey wallet signing boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem('juice-auth-token', 'auth-token')
    mocks.signMessage.mockReset().mockResolvedValue(`0x${'ab'.repeat(65)}`)
    mocks.signInWithWallet.mockReset().mockImplementation(
      async (_address: string, _chainId: number, signer: (message: string) => Promise<string>) => {
        await signer('juicy.example wants you to sign in')
      },
    )

    const prfOutput = new Uint8Array(32).fill(7).buffer
    vi.stubGlobal('navigator', {
      credentials: {
        get: vi.fn().mockResolvedValue({
          id: 'credential-1',
          getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }),
        }),
      },
    })
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(value: T) => value,
      subtle: {
        importKey: vi.fn().mockResolvedValue({}),
        deriveBits: vi.fn().mockResolvedValue(new Uint8Array(32).fill(1).buffer),
      },
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          walletAddress: '0x1111111111111111111111111111111111111111',
          isPrimaryLinked: false,
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
  })

  it('uses the derived account to sign SIWE before persisting the wallet', async () => {
    await expect(authenticatePasskeyWallet()).resolves.toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
    })

    expect(mocks.signInWithWallet).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      1,
      expect.any(Function),
    )
    expect(mocks.signMessage).toHaveBeenCalledWith({
      message: 'juicy.example wants you to sign in',
    })
    expect(localStorage.getItem('juice-passkey-credential')).toBe('credential-1')
    expect(JSON.parse(localStorage.getItem('juice-passkey-wallet') ?? '{}')).toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
    })
  })

  it('fails without persisting when PRF output is unavailable', async () => {
    vi.mocked(navigator.credentials.get).mockResolvedValueOnce({
      id: 'credential-2',
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential)

    await expect(authenticatePasskeyWallet()).rejects.toThrow('PRF extension not supported')
    expect(mocks.signMessage).not.toHaveBeenCalled()
    expect(localStorage.getItem('juice-passkey-wallet')).toBeNull()
  })
})
