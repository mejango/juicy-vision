/**
 * Step 0: Flavor — React port of the website's renderType (create-flow.js):
 * flavor select, chains + bridge selector, accounting token(s) + custom-token
 * lookup, and the owner/operator field. Copy comes verbatim from the source.
 */

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, isAddress } from "viem";
import { tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import { ALL_CHAIN_IDS, CHAINS } from "../../../constants";
import { getSafetyPublicClient } from "../../../utils/transactionSafety";
import type {
  AcceptKind,
  CreateFlowState,
  ProjectType,
  SuckerType,
} from "./state";
import {
  CHAIN_PAIRS,
  chainName,
  customAccounting,
  sanitizeState,
  saveDraft,
  stepsFor,
  tickerLabel,
} from "./state";
import NetworkModeSelect from "../../../components/common/NetworkModeSelect";
import {
  EnsAddressInput,
  FieldBlock,
  Hint,
  InfoNote,
  InlineToggleLink,
  Pill,
  PinkNote,
  Select,
  StepHead,
  WarnNote,
  useIsDark,
} from "./controls";
import { PerChainAddrControl } from "./pickers";

interface StepProps {
  state: CreateFlowState;
  update: (fn: (s: CreateFlowState) => void) => void;
}

// ---------------------------------------------------------------------------
// Accounting helpers — ports of customAccounting / customCurrencyId /
// tickerLabel / applyAccountingDefaults / uncoveredPairs
// ---------------------------------------------------------------------------

// A custom ERC-20's currency id = uint32(uint160(address)) — so every ruleset/shop
// currency equals it and no JBPrices feed is needed.
function customCurrencyId(state: CreateFlowState): number {
  const a = state.customToken.address;
  return isAddress(a, { strict: false }) ? tokenCurrencyId(a) : 0;
}

// Point every ruleset/shop currency at the right base id. A custom ERC-20 → its own currency id. Otherwise,
// USD(2) whenever USDC is accepted (alone OR alongside ETH) so BOTH ETH and USDC resolve via the default
// ETH/USD + USDC/USD feeds — a base of ETH(1) has no USDC→ETH feed and every USDC payment would revert.
// Pure ETH stays ETH(1) (the user may still switch it to USD via the dropdown; ETH→USD has a feed).
export function applyAccountingDefaults(state: CreateFlowState): void {
  const accepts = state.accepts || [];
  if (!accepts.length) return;
  let cur: number;
  if (accepts[0] === "custom") {
    cur = customCurrencyId(state);
    if (!cur) return; // token not resolved yet
  } else {
    cur = accepts.includes("usdc") ? 2 : 1;
  }
  state.storePricingCurrency = cur;
  if (state.projectType === "revnet") state.revBaseCurrency = cur;
  else
    (state.stages || []).forEach((s) => {
      s.baseCurrency = cur;
      s.payoutCurrency = cur;
      s.surplusAllowanceCurrency = cur;
      // A custom token has no default price feed, so keep the owner's escape hatch open: pricing in ETH/USD
      // later requires adding a feed, which the ruleset must allow.
      if (accepts[0] === "custom") s.allowAddPriceFeed = true;
    });
}

// Selected-chain pairs that won't link under the chosen sucker type. Native bridges only connect
// Ethereum (L1) with an L2 — an L2↔L2 pair is uncovered. CCIP (and "both") connects any pair.
function isL1Chain(id: number): boolean {
  return id === 1 || id === 11155111;
}

function uncoveredPairs(state: CreateFlowState): [number, number][] {
  if (state.suckerType !== "native") return [];
  const ids = state.chainIds;
  const out: [number, number][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!isL1Chain(ids[i]) && !isL1Chain(ids[j])) out.push([ids[i], ids[j]]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chain pill — Pill styling + the chain's color dot
// ---------------------------------------------------------------------------

function ChainPill(props: {
  id: number;
  selected: boolean;
  onClick: () => void;
}) {
  const isDark = useIsDark();
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border transition-colors ${
        props.selected
          ? "border-teal-400 text-teal-400 bg-teal-400/10"
          : isDark
            ? "border-white/15 text-gray-400 hover:border-white/30"
            : "border-gray-300 text-gray-500 hover:border-gray-400"
      }`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: CHAINS[props.id]?.color }}
      />
      {CHAINS[props.id]?.shortName || String(props.id)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chains block ("On") — chain multi-select + bridge selector when >1 chain
// ---------------------------------------------------------------------------

function ChainBridgeBlock({ state, update }: StepProps) {
  const isDark = useIsDark();
  // Transient UI flag (the source's state._bridgeOpen) — lives outside draft state.
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const unc = uncoveredPairs(state);
  const usdcAcct = state.accepts[0] === "usdc";

  // "On [Mainnets ▾]" — the network is part of the sentence (website parity).
  // Before the mode switch reloads, remap the draft's chains to their pair
  // twins and save it; the restored draft re-verifies any custom token.
  const remapDraft = (mode: "mainnet" | "testnet") => {
    const draft = sanitizeState(state);
    draft.network = mode;
    draft.chainIds = draft.chainIds.map((cid) => {
      const pair = CHAIN_PAIRS.find(
        (p) => p.canon === cid || p.testnet === cid,
      );
      return pair ? (mode === "mainnet" ? pair.canon : pair.testnet) : cid;
    });
    if (draft.customToken.address) draft.customToken.status = "idle";
    saveDraft(draft);
  };

  return (
    <FieldBlock label={null}>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span
          className={`block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          On
        </span>
        {/* Inline, borderless — the website's paybox-mode look, part of the sentence */}
        <NetworkModeSelect beforeSwitch={remapDraft} />
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_CHAIN_IDS.map((id) => {
          const on = state.chainIds.includes(id);
          return (
            <ChainPill
              key={id}
              id={id}
              selected={on}
              onClick={() => {
                update((s) => {
                  let ids = s.chainIds.slice();
                  if (on) ids = ids.filter((x) => x !== id);
                  else ids.push(id);
                  s.chainIds = ids.length ? ids : [id]; // min 1 chain
                });
                // The custom-token lookup effect re-verifies on the new chain set automatically.
              }}
            />
          );
        })}
      </div>

      {state.chainIds.length > 1 ? (
        <>
          <Hint>
            {`Your project will exist on ${state.chainIds.length} chains, `}
            <InlineToggleLink
              label="linked"
              title="Choose how the chains are connected"
              onClick={() => setBridgeOpen((v) => !v)}
            />
            {" so your token and balances can move between them."}
          </Hint>
          {bridgeOpen && (
            <>
              <div className="flex items-center gap-2 mt-3 text-sm">
                <span>Connect chains via</span>
                <Select
                  value={state.suckerType || "both"}
                  onChange={(v) =>
                    update((s) => {
                      s.suckerType = v as SuckerType;
                    })
                  }
                  options={[
                    ["native", "Native bridges"],
                    ["ccip", "CCIP"],
                    ["both", "Native and CCIP"],
                  ]}
                />
              </div>
              <Hint>
                Native bridges connect Ethereum with L2s (strongest guarantees).
                CCIP (Chainlink) connects any chains. Native and CCIP gives the
                broadest coverage.
              </Hint>
            </>
          )}
          {/* USDC moves over CCIP only (website 6b330c4): canonical USDC over an
              OP-stack/Arbitrum native bridge locks funds in bridge escrow. */}
          {usdcAcct && state.suckerType === "native" && (
            <WarnNote>
              USDC moves between chains over CCIP only — native bridges can’t
              carry canonical USDC. Choose CCIP (or Native and CCIP) to link
              these chains.
            </WarnNote>
          )}
          {usdcAcct && state.suckerType === "both" && (
            <InfoNote>
              USDC moves between chains over CCIP only, so this project links
              its chains with CCIP suckers.
            </InfoNote>
          )}
          {unc.length > 0 && !(usdcAcct && state.suckerType === "native") && (
            <WarnNote>
              {`${unc.length} chain pair${unc.length > 1 ? "s" : ""} can’t connect with native bridges (they only link Ethereum↔L2). Choose CCIP or Native and CCIP to link L2↔L2 pairs.`}
            </WarnNote>
          )}
        </>
      ) : (
        <InfoNote>
          {"Deploys on a single chain. " +
            (state.projectType === "revnet"
              ? "You can add more chains later if they exactly match the configuration you deploy with now."
              : "You can add more chains later.")}
        </InfoNote>
      )}
    </FieldBlock>
  );
}

// ---------------------------------------------------------------------------
// Custom accounting token — address input + onchain ERC-20 lookup verifying
// the SAME token (symbol + decimals) at the same address on EVERY chain
// ---------------------------------------------------------------------------

interface ChainLookupResult {
  cid: number;
  ok: boolean;
  name: string | null;
  symbol: string;
  decimals: number;
  /** Failure was transport-level (RPC), not an on-chain "no contract here". */
  rpcFail?: boolean;
}

function CustomTokenBlock({ state, update }: StepProps) {
  const isDark = useIsDark();
  const ct = state.customToken;
  const address = ct.address;
  const chainKey = state.chainIds.join(",");

  useEffect(() => {
    const addr = address.trim();
    if (!isAddress(addr, { strict: false })) {
      update((s) => {
        const t = s.customToken;
        t.status = addr ? "error" : "idle";
        t.error = addr ? "Not a valid address." : "";
        t.name = "";
        t.symbol = "";
        t.decimals = null;
      });
      return;
    }
    const chainIds = chainKey
      .split(",")
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!chainIds.length) return;
    let cancelled = false;
    // 400ms debounce, then loading → ok|error (the source's lookupCustomToken).
    const timer = window.setTimeout(async () => {
      update((s) => {
        s.customToken.status = "loading";
        s.customToken.error = "";
      });
      let results: ChainLookupResult[];
      try {
        results = await Promise.all(
          chainIds.map(async (cid): Promise<ChainLookupResult> => {
            try {
              const pub = getSafetyPublicClient(cid);
              const [name, symbol, decimals] = await Promise.all([
                pub
                  .readContract({
                    address: addr as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "name",
                  })
                  .catch(() => null),
                pub.readContract({
                  address: addr as `0x${string}`,
                  abi: erc20Abi,
                  functionName: "symbol",
                }),
                pub.readContract({
                  address: addr as `0x${string}`,
                  abi: erc20Abi,
                  functionName: "decimals",
                }),
              ]);
              return {
                cid,
                ok: true,
                name,
                symbol,
                decimals: Number(decimals),
              };
            } catch (e) {
              // A transport failure must not read as "token doesn't exist" —
              // classify it so the error can say retry (website 5317b9e).
              const msg =
                String((e as Error)?.name || "") +
                " " +
                String((e as Error)?.message || "");
              return {
                cid,
                ok: false,
                name: null,
                symbol: "",
                decimals: 0,
                rpcFail: /HttpRequestError|timeout|fetch|network/i.test(msg),
              };
            }
          }),
        );
      } catch {
        if (cancelled) return;
        update((s) => {
          if (s.customToken.address.trim().toLowerCase() !== addr.toLowerCase())
            return;
          s.customToken.status = "error";
          s.customToken.error =
            "Could not look up the token (RPC error). Try again.";
        });
        return;
      }
      if (cancelled) return;
      update((s) => {
        const t = s.customToken;
        if (t.address.trim().toLowerCase() !== addr.toLowerCase()) return; // stale
        const first = results.find((r) => r.ok);
        if (!first) {
          t.status = "error";
          // Name the exact chains checked (website 5317b9e); the testnet-toggle
          // hint is website-only — juicy's chains are fixed per build.
          t.error = results.every((r) => r.rpcFail)
            ? "Could not look up the token (RPC error). Try again."
            : `No ERC-20 found at this address on ${chainIds.map(chainName).join(", ")}.`;
          t.symbol = "";
          t.decimals = null;
          return;
        }
        t.name = first.name || "";
        t.symbol = first.symbol || "";
        t.decimals = Number(first.decimals);
        if (
          !Number.isInteger(t.decimals) ||
          t.decimals < 0 ||
          t.decimals > 36
        ) {
          t.status = "error";
          t.error = `This token reports ${t.decimals} decimals; Juicebox accounting contexts support 0–36.`;
          return;
        }
        // Every selected chain must have the same token (same symbol + decimals) at this address.
        const bad = results.filter(
          (r) =>
            !r.ok ||
            r.symbol !== first.symbol ||
            Number(r.decimals) !== Number(first.decimals),
        );
        if (bad.length) {
          t.status = "error";
          t.error =
            "Not the same token on " +
            bad
              .map(
                (r) =>
                  chainName(r.cid) +
                  (r.ok ? ` (${r.symbol}, ${r.decimals} dec)` : " — not found"),
              )
              .join("; ") +
            `. Deploy ${t.symbol} at this exact address on every selected chain, or deselect those chains.`;
        } else {
          t.status = "ok";
          t.error = "";
        }
        applyAccountingDefaults(s);
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, chainKey, update]);

  const n = state.chainIds.length;
  return (
    <div className="mt-2.5">
      <input
        type="text"
        value={ct.address}
        onChange={(e) =>
          update((s) => {
            s.customToken.address = e.target.value.trim();
            s.customToken.status = "idle";
          })
        }
        placeholder="0x… (ERC-20 token address)"
        className={`w-full px-3 py-2 text-sm border outline-none transition-colors font-mono ${
          isDark
            ? "bg-white/5 border-white/15 text-white placeholder-gray-500 focus:border-teal-400"
            : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-teal-600"
        }`}
      />
      {ct.status === "loading" && <Hint>Looking up token…</Hint>}
      {ct.status === "ok" && (
        <div className="text-xs mt-2 text-teal-400">
          {(ct.name ? ct.name + " — " : "") +
            ct.symbol +
            " | " +
            ct.decimals +
            " decimals" +
            (n > 1 ? " | verified on all " + n + " chains" : "")}
        </div>
      )}
      {ct.status === "error" && <Hint warn>{ct.error}</Hint>}
      <Hint>
        {"Must be deployed at the SAME address on every selected chain. Every ruleset, payout, and shop price is denominated in " +
          (ct.symbol || "this token") +
          " itself, so issuing tokens and paying need no price feed. Pricing in ETH or USD instead requires the owner to add a " +
          (ct.symbol || "token") +
          " price feed after deploy (Owner tab → Add price feed) — the “Allow adding price feeds” rule is on by default for custom-token projects."}
      </Hint>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounting block — ETH/USDC/Custom pills + notes / custom-token lookup
// ---------------------------------------------------------------------------

function AccountingBlock({ state, update }: StepProps) {
  const isRev = state.projectType === "revnet";
  const isCustom = customAccounting(state);

  const toggleAccept = (key: AcceptKind) => {
    update((s) => {
      const cust = s.accepts[0] === "custom";
      if (key === "custom") {
        if (!cust) {
          s.accepts = ["custom"];
          applyAccountingDefaults(s);
        }
        return;
      }
      // ETH/USDC are multi-select among themselves but mutually exclusive with a custom token.
      let a: AcceptKind[] = cust ? [] : s.accepts.slice();
      if (a.includes(key)) {
        a = a.filter((x) => x !== key);
        if (!a.length) a = [key === "eth" ? "usdc" : "eth"];
      } else {
        a.push(key);
      }
      s.accepts = (["eth", "usdc"] as AcceptKind[]).filter((k) =>
        a.includes(k),
      ); // canonical order
      applyAccountingDefaults(s);
    });
  };

  const opts: { key: AcceptKind; label: string }[] = [
    { key: "eth", label: "ETH" },
    { key: "usdc", label: "USDC" },
    { key: "custom", label: "Custom token" },
  ];

  return (
    <FieldBlock label="Accounting">
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <Pill
            key={o.key}
            label={o.label}
            selected={state.accepts.includes(o.key)}
            onClick={() => toggleAccept(o.key)}
          />
        ))}
      </div>
      {isCustom ? (
        <CustomTokenBlock state={state} update={update} />
      ) : (
        <>
          <Hint>
            {isRev
              ? `The reserve asset(s) that back the value of $${tickerLabel(state)}.`
              : "The token(s) that make up your project’s balance."}
          </Hint>
          {/* Multi-asset revnet: the backing is fixed by the proportion of payments received and can't be rebalanced. */}
          {isRev && state.accepts.length > 1 && (
            <PinkNote>
              Your revnet’s token will be backed by both ETH and USDC paid in by
              users. Holders can cash out for either, and the backing mix is set
              entirely by the proportion of payments received in each — you
              can’t rebalance between them later.
            </PinkNote>
          )}
          {/* Router-terminal (any-token auto-swap) note stays grouped right under the main note (custom only). */}
          {!isRev && (
            <Hint>
              {state.swapRouter
                ? "Other payment tokens auto-swap to your chosen accounting token(s) as they’re paid in. "
                : "Payers can only pay in your accounting token(s). "}
              <InlineToggleLink
                label={
                  state.swapRouter
                    ? "Make payers pay in your accounting token"
                    : "Allow payers to pay in any token"
                }
                onClick={() =>
                  update((s) => {
                    s.swapRouter = !s.swapRouter;
                  })
                }
              />
            </Hint>
          )}
          <Hint>
            {isRev
              ? "Accounting contexts cannot be added or removed later."
              : "Accounting tokens cannot be removed later."}
          </Hint>
        </>
      )}
    </FieldBlock>
  );
}

// ---------------------------------------------------------------------------
// Owner (custom) / Operator (revnet) sections
// ---------------------------------------------------------------------------

function perChainAddrActive(state: CreateFlowState, key: string): boolean {
  if (state.chainIds.length < 2) return false;
  return Object.values(state.perChain).some((c) => !!c.addr?.[key]);
}

function OwnerSection({ state, update }: StepProps) {
  const onResolved = useCallback(
    (addr: string | null) => {
      update((s) => {
        s.details.ownerResolved = addr || undefined;
      });
    },
    [update],
  );
  return (
    <FieldBlock label="Project owner">
      {!perChainAddrActive(state, "owner") && (
        <EnsAddressInput
          value={state.details.owner}
          onChange={(v) =>
            update((s) => {
              s.details.owner = v.trim();
            })
          }
          onResolved={onResolved}
        />
      )}
      <PerChainAddrControl state={state} update={update} fieldKey="owner" />
      <InfoNote>
        The address that can make changes around the configured rulesets.
      </InfoNote>
    </FieldBlock>
  );
}

function OperatorSection({ state, update }: StepProps) {
  const onResolved = useCallback(
    (addr: string | null) => {
      update((s) => {
        s.revOperatorResolved = addr || undefined;
      });
    },
    [update],
  );
  return (
    <FieldBlock label="Project operator">
      {!perChainAddrActive(state, "op") && (
        <EnsAddressInput
          value={state.revOperator}
          onChange={(v) =>
            update((s) => {
              s.revOperator = v.trim();
            })
          }
          onResolved={onResolved}
        />
      )}
      <PerChainAddrControl state={state} update={update} fieldKey="op" />
      <InfoNote>
        The address that operates the few controls available in revnets.
      </InfoNote>
    </FieldBlock>
  );
}

// ---------------------------------------------------------------------------
// Step component
// ---------------------------------------------------------------------------

export default function StepFlavor({ state, update }: StepProps) {
  const isRev = state.projectType === "revnet";

  return (
    <div>
      <StepHead desc="Follow a preset, or design your project from scratch." />

      <FieldBlock label="Flavor">
        <Select
          value={state.projectType}
          onChange={(v) => {
            update((s) => {
              s.projectType = v as ProjectType;
              // Revnets hold a single reserve asset — collapse a custom ETH+USDC selection to one.
              if (v === "revnet" && s.accepts.length > 1)
                s.accepts = [s.accepts[0] ?? "eth"];
              s.step = Math.min(s.step, stepsFor(s).length - 1); // clamp if the new flow has fewer steps
            });
          }}
          options={[
            ["custom", "Custom project"],
            ["revnet", "Revnet"],
          ]}
        />
        <Hint>
          {isRev
            ? "Fixed rules that run forever, guaranteed. Tokens are always backed by revenues and funds raised, allowing for increasing price floors, loans, and predictability."
            : "Full control and customizability."}
        </Hint>
      </FieldBlock>

      {/* Settlement basics (chains + accounting token) are collected up front, so every downstream address
          and currency field knows the chain set and accounting token(s). Chains first, then accounting. */}
      <ChainBridgeBlock state={state} update={update} />
      <AccountingBlock state={state} update={update} />

      {/* Owner (custom) or operator (revnet) is collected here. */}
      {isRev ? (
        <OperatorSection state={state} update={update} />
      ) : (
        <OwnerSection state={state} update={update} />
      )}
    </div>
  );
}
