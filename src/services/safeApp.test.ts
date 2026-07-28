/**
 * The Safe App provider is a money path: writes must PROPOSE to the Safe
 * (sendTransactions), never send a bare tx, and reads must proxy through the
 * Safe. This locks the postMessage protocol + request mapping.
 *
 * Ported from website/test/safe-app.test.js.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  detectSafeApp,
  makeSafeProvider,
  proposeSafeTransactions,
  type SafeTx,
} from "./safeApp";

const SAFE = "0x1111111111111111111111111111111111111111" as const;

const SAFE_ORIGIN = "https://app.safe.global";

// Minimal Safe parent stub: answer postMessages by method, echoing the id back
// on the window as a 'message' event. Replies carry the Safe origin and the
// parent as their source (spoofable knobs for the validation tests below).
function installSafeParent(
  answers: Record<string, unknown>,
  delayMs = 0,
  reply?: { origin?: string; sourceIsParent?: boolean },
) {
  const calls: Array<{
    id: string;
    method: string;
    params: { txs?: SafeTx[] };
    targetOrigin?: string;
  }> = [];
  const parent = {
    postMessage(
      msg: {
        id: string;
        method: string;
        params: { txs?: SafeTx[] };
      },
      targetOrigin?: string,
    ) {
      calls.push({ ...msg, targetOrigin });
      const data = answers[msg.method];
      const send = () => {
        const event = new MessageEvent("message", {
          data: {
            id: msg.id,
            success: data !== undefined,
            data,
            version: "9.1.0",
          },
          origin: reply?.origin ?? SAFE_ORIGIN,
        });
        // jsdom's MessageEvent constructor brand-checks `source`; override the
        // prototype getter with an own property so the stub parent can pose as
        // the event source (or deliberately not).
        Object.defineProperty(event, "source", {
          configurable: true,
          value: reply?.sourceIsParent === false ? null : parent,
        });
        window.dispatchEvent(event);
      };
      if (delayMs) window.setTimeout(send, delayMs);
      else queueMicrotask(send);
    },
  };
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
  return calls;
}

afterEach(() => {
  // Restore jsdom's default (window.parent === window) so inIframe() resets.
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: window,
  });
});

describe("Safe App provider", () => {
  it("detects a Safe via getSafeInfo when framed", async () => {
    installSafeParent({
      getSafeInfo: {
        safeAddress: SAFE,
        chainId: 8453,
        owners: [SAFE],
        threshold: 1,
      },
    });
    const info = await detectSafeApp(200);
    expect(info).not.toBeNull();
    expect(info?.safeAddress).toBe(SAFE);
    expect(info?.chainId).toBe(8453);
  });

  it("does not misclassify a slow first-load Safe iframe as an ordinary wallet", async () => {
    installSafeParent(
      {
        getSafeInfo: {
          safeAddress: SAFE,
          chainId: 8453,
          owners: [SAFE],
          threshold: 1,
        },
      },
      650,
    );
    await expect(detectSafeApp()).resolves.toMatchObject({
      safeAddress: SAFE,
      chainId: 8453,
    });
  });

  it("returns null when not framed (jsdom top window)", async () => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
    const info = await detectSafeApp(200);
    expect(info).toBeNull();
  });

  it("returns the Safe address for eth_accounts and the chain for eth_chainId", async () => {
    installSafeParent({});
    const p = makeSafeProvider({ safeAddress: SAFE, chainId: 8453 });
    expect(await p.request({ method: "eth_accounts" })).toEqual([SAFE]);
    expect(await p.request({ method: "eth_requestAccounts" })).toEqual([SAFE]);
    expect(await p.request({ method: "eth_chainId" })).toBe("0x2105"); // 8453
    expect(p.isSafe).toBe(true);
  });

  it("never exposes a proposal hash as a mined eth_sendTransaction hash", async () => {
    const calls = installSafeParent({
      sendTransactions: { safeTxHash: "0xabc" },
      getTxBySafeTxHash: { txHash: "0xdef" },
    });
    const p = makeSafeProvider({ safeAddress: SAFE, chainId: 8453 });
    const res = await p.request({
      method: "eth_sendTransaction",
      params: [{ to: SAFE, value: "0x0", data: "0xdead" }],
    });
    expect(res).toBe("0xdef");
    const sent = calls.find((c) => c.method === "sendTransactions");
    expect(sent?.params.txs).toEqual([
      { to: SAFE, value: "0x0", data: "0xdead" },
    ]);
    expect(calls.some((c) => c.method === "getTxBySafeTxHash")).toBe(true);
  });

  it("batches multiple txs via proposeSafeTransactions (approval + main call as one entry)", async () => {
    const calls = installSafeParent({
      sendTransactions: { safeTxHash: "0xbatch" },
    });
    const txs: SafeTx[] = [
      { to: SAFE, value: "0x0", data: "0xapprove" },
      { to: SAFE, value: "0x0", data: "0xpay" },
    ];
    expect(await proposeSafeTransactions(txs)).toBe("0xbatch");
    expect(
      calls.find((c) => c.method === "sendTransactions")?.params.txs,
    ).toEqual(txs);
  });

  it("posts to the Safe origin, never '*'", async () => {
    const calls = installSafeParent({
      getSafeInfo: { safeAddress: SAFE, chainId: 8453 },
    });
    await detectSafeApp(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.targetOrigin).toBe(SAFE_ORIGIN);
    }
  });

  it("ignores responses from a non-allowlisted origin", async () => {
    installSafeParent(
      { getSafeInfo: { safeAddress: SAFE, chainId: 8453 } },
      0,
      { origin: "https://evil.example" },
    );
    await expect(detectSafeApp(150)).resolves.toBeNull();
  });

  it("ignores responses whose source is not the parent window", async () => {
    installSafeParent(
      { getSafeInfo: { safeAddress: SAFE, chainId: 8453 } },
      0,
      { sourceIsParent: false },
    );
    await expect(detectSafeApp(150)).resolves.toBeNull();
  });

  it("rejects switching to a chain other than the Safe's", async () => {
    installSafeParent({});
    const p = makeSafeProvider({ safeAddress: SAFE, chainId: 8453 });
    await expect(
      p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      }),
    ).rejects.toMatchObject({ code: 4902 });
    // Same chain resolves.
    await expect(
      p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      }),
    ).resolves.toBeNull();
  });
});
