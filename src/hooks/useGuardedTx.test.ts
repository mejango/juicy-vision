import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardedWalletContext } from "../services/projectTx";
import { useGuardedTx } from "./useGuardedTx";

const EXTERNAL = "0x1111111111111111111111111111111111111111" as const;
const MANAGED = "0x2222222222222222222222222222222222222222" as const;
const SAFE = "0x3333333333333333333333333333333333333333" as const;
const TARGET = "0x4444444444444444444444444444444444444444" as const;
const HASH = `0x${"aa".repeat(32)}` as const;

const mocks = vi.hoisted(() => ({
  accountAddress: undefined as `0x${string}` | undefined,
  walletClient: null as unknown,
  managed: {
    isManagedMode: false,
    address: null as `0x${string}` | null,
  },
  safe: {
    isSafeApp: false,
    safeInfo: null as { safeAddress: `0x${string}`; chainId: number } | null,
    detecting: false,
  },
  switchChain: vi.fn(),
  runGuardedTx: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.accountAddress }),
  useWalletClient: () => ({ data: mocks.walletClient }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

vi.mock("./useManagedWallet", () => ({
  useManagedWallet: () => mocks.managed,
}));

vi.mock("./useSafeApp", () => ({
  useSafeApp: () => mocks.safe,
}));

vi.mock("../services/projectTx", () => ({
  runGuardedTx: mocks.runGuardedTx,
}));

const REQUEST = { chainId: 10, to: TARGET, data: "0x1234" as const };

describe("useGuardedTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountAddress = EXTERNAL;
    mocks.walletClient = { account: { address: EXTERNAL } };
    mocks.managed.isManagedMode = false;
    mocks.managed.address = null;
    mocks.safe.isSafeApp = false;
    mocks.safe.safeInfo = null;
    mocks.safe.detecting = false;
    mocks.switchChain.mockResolvedValue(undefined);
    mocks.runGuardedTx.mockResolvedValue(HASH);
  });

  it("gives a detected Safe precedence and passes its exact chain context to the guard", async () => {
    mocks.managed.isManagedMode = true;
    mocks.managed.address = MANAGED;
    mocks.safe.isSafeApp = true;
    mocks.safe.safeInfo = { safeAddress: SAFE, chainId: 10 };
    const { result } = renderHook(() => useGuardedTx());

    expect(result.current.activeAddress).toBe(SAFE);
    expect(result.current.isSafeMode).toBe(true);

    await act(async () => {
      await expect(result.current.run(REQUEST)).resolves.toBe(HASH);
    });

    const [context, passedRequest] = mocks.runGuardedTx.mock.calls[0] as [
      GuardedWalletContext,
      typeof REQUEST,
    ];
    expect(context).toMatchObject({
      activeAddress: SAFE,
      isManagedMode: true,
      isSafeMode: true,
      safeChainId: 10,
      walletClient: mocks.walletClient,
    });
    expect(passedRequest).toBe(REQUEST);
    await context.switchChain?.(10);
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 10 });
  });

  it("fails closed before invoking the transaction service when disconnected", async () => {
    mocks.accountAddress = undefined;
    mocks.walletClient = null;
    const { result } = renderHook(() => useGuardedTx());

    expect(result.current.activeAddress).toBeNull();
    await expect(result.current.run(REQUEST)).rejects.toThrow(
      "Connect a wallet first",
    );
    expect(mocks.runGuardedTx).not.toHaveBeenCalled();
  });

  it("fails closed while Safe detection is still resolving", async () => {
    mocks.safe.detecting = true;
    const { result } = renderHook(() => useGuardedTx());

    expect(result.current.activeAddress).toBeNull();
    await expect(result.current.run(REQUEST)).rejects.toThrow(
      "Connecting to Safe{Wallet}",
    );
    expect(mocks.runGuardedTx).not.toHaveBeenCalled();
  });

  it("uses the managed account when no Safe is active", async () => {
    mocks.managed.isManagedMode = true;
    mocks.managed.address = MANAGED;
    const { result } = renderHook(() => useGuardedTx());

    expect(result.current.activeAddress).toBe(MANAGED);
    await act(async () => {
      await expect(result.current.run(REQUEST)).resolves.toBe(HASH);
    });
    expect(mocks.runGuardedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        activeAddress: MANAGED,
        isManagedMode: true,
        isSafeMode: false,
      }),
      REQUEST,
    );
  });

  it("uses the connected external account outside managed and Safe modes", async () => {
    const { result } = renderHook(() => useGuardedTx());

    expect(result.current.activeAddress).toBe(EXTERNAL);
    await act(async () => {
      await expect(result.current.run(REQUEST)).resolves.toBe(HASH);
    });
    expect(mocks.runGuardedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        activeAddress: EXTERNAL,
        isManagedMode: false,
        isSafeMode: false,
      }),
      REQUEST,
    );
  });
});
