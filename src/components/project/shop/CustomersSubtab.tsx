/**
 * Shop → Customers subtab: what's been bought and by whom.
 * Ports website/src/discover.js renderShopCustomers (:1267), renderCustomerYou
 * (:1298), renderCustomerAll (:1330), renderRecentPurchases (:1489), plus the
 * item→owners / address→items drilldowns (openTierHoldersModal /
 * openAddressItemsModal) and item thumbnails (shopItemThumb).
 *
 * "You"  = the connected wallet's owned items (per-item tally, thumbnailed),
 *          plus a Redeem link when the shop is configured for item cash outs.
 * "All"  = distinct customer count + items-sold total + ranked buyers (top 100),
 *          each clickable: address → everything they own, item thumb → its owners.
 * "Recent purchases" = a bordered Item | Owner | When table (latest 25).
 *
 * All three are backed by the same indexed `mintNftEvents` (one row per minted
 * 721) and a shared tierId → {name, media} map, resolved via the media resolver.
 */

import { useEffect, useMemo, useState } from "react";
import { useThemeStore } from "../../../stores";
import { CHAINS } from "../../../constants";
import { ExplainerMessage } from "../../ui/ExplainerMessage";
import Modal from "../../ui/Modal";
import { useGuardedTx } from "../../../hooks/useGuardedTx";
import { truncateAddress } from "../../../utils";
import { formatTimeAgo } from "../../../utils/activityEvents";
import { ipfsGatewayUrls } from "../../../utils/ipfs";
import { get721ItemsCashOutEnabled } from "../../../services/nft";
import {
  fetchNftMints,
  resolveShopItemMedia,
  tallyItems,
  rankCustomers,
  ownersOfTier,
  itemLabelFrom,
  type MintFetchResult,
  type MintRow,
  type ShopItemMeta,
  type ShopItemMedia,
  type ShopChain,
} from "../../../services/shopCustomers";
import { RedeemItemsModal } from "./RedeemItemsModal";

function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = CHAINS[chainId]?.explorer;
  return base ? `${base}/address/${address}` : null;
}

function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = CHAINS[chainId]?.explorerTx;
  return base ? `${base}${txHash}` : null;
}

/** The drilldown a click opens: one item's owners, or one address's items. */
type Drilldown =
  | { kind: "tier"; tierId: number; label: string }
  | { kind: "address"; address: string };

/**
 * Small square item thumbnail. Renders the tier's resolved art (IPFS via the
 * gateway fallback list, or an inlined data: URI) and falls back to a "#<id>"
 * placeholder until/unless the art loads — mirroring website's shopItemThumb.
 */
function ShopItemThumb({
  media,
  tierId,
  isDark,
  size = "sm",
}: {
  media: ShopItemMedia;
  tierId: number;
  isDark: boolean;
  size?: "sm" | "md";
}) {
  const item = media[tierId];
  const candidates = useMemo(() => {
    const uri = item?.imageUri;
    if (!uri) return [];
    // The resolver inlines on-chain SVGs into a data: URI — use those directly
    // (ipfsGatewayUrls only understands ipfs:// and http(s)).
    if (uri.startsWith("data:")) return [uri];
    return ipfsGatewayUrls(uri);
  }, [item?.imageUri]);

  const [idx, setIdx] = useState(0);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setIdx(0);
    setErrored(false);
  }, [item?.imageUri]);

  const url = errored ? null : (candidates[idx] ?? null);
  const isSvg = url?.startsWith("data:image/svg") || url?.endsWith(".svg");
  const box = size === "md" ? "w-10 h-10" : "w-8 h-8";

  if (url) {
    return (
      <img
        src={url}
        alt={item?.name || `Item #${tierId}`}
        className={`${box} shrink-0 ${isSvg ? "object-contain bg-white" : "object-cover"}`}
        onError={() => {
          if (idx + 1 < candidates.length) setIdx((i) => i + 1);
          else setErrored(true);
        }}
      />
    );
  }
  return (
    <div
      className={`${box} shrink-0 flex items-center justify-center ${isDark ? "bg-white/10 text-gray-500" : "bg-gray-100 text-gray-400"}`}
    >
      <span className="text-[10px] font-mono">#{tierId}</span>
    </div>
  );
}

export interface CustomersSubtabProps {
  /** Revnets are token-based — item redemption (721 cash out) is custom-only. */
  isRevnet?: boolean;
  /** Home-chain project id (used to resolve item names + the redeem gate). */
  projectId: string;
  /** Home chain id. */
  chainId: number;
  /** The chains this project lives on, with per-chain project ids. */
  chains: ShopChain[];
}

export function CustomersSubtab({
  projectId,
  chainId,
  chains,
  isRevnet,
}: CustomersSubtabProps) {
  const { theme } = useThemeStore();
  const isDark = theme === "dark";
  const { activeAddress } = useGuardedTx();

  const chainKey = chains.map((c) => `${c.chainId}:${c.projectId}`).join(",");

  const [meta, setMeta] = useState<ShopItemMeta>({ names: {}, media: {} });
  const [redeemEnabled, setRedeemEnabled] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const [you, setYou] = useState<MintFetchResult | null>(null);
  const [youLoading, setYouLoading] = useState(false);
  const [youError, setYouError] = useState(false);

  const [all, setAll] = useState<MintFetchResult | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState(false);

  const [reloadNonce, setReloadNonce] = useState(0);

  const names = meta.names;
  const media = meta.media;

  // Shared item name + media map + redeem-eligibility (the shop's cash-out gate).
  useEffect(() => {
    let cancelled = false;
    resolveShopItemMedia(projectId, chainId).then((m) => {
      if (!cancelled) setMeta(m);
    });
    // Authoritative 721 item-cash-out flag — for omnichain projects the bare
    // ruleset useDataHookForCashOut only means "consult the deployer"; the real
    // opt-in is the deployer's per-ruleset tiered721 config. (Revnets → false.)
    get721ItemsCashOutEnabled(projectId, chainId)
      .then((enabled) => {
        if (!cancelled) setRedeemEnabled(!isRevnet && enabled);
      })
      .catch(() => {
        if (!cancelled) setRedeemEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, chainId, isRevnet]);

  // "All" customers — every buyer across the project's chains.
  useEffect(() => {
    let cancelled = false;
    setAllLoading(true);
    setAllError(false);
    fetchNftMints(chains)
      .then((res) => {
        if (!cancelled) setAll(res);
      })
      .catch(() => {
        if (!cancelled) setAllError(true);
      })
      .finally(() => {
        if (!cancelled) setAllLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, reloadNonce]);

  // "You" — the connected wallet's purchases.
  useEffect(() => {
    if (!activeAddress) {
      setYou(null);
      return;
    }
    let cancelled = false;
    setYouLoading(true);
    setYouError(false);
    fetchNftMints(chains, activeAddress)
      .then((res) => {
        if (!cancelled) setYou(res);
      })
      .catch(() => {
        if (!cancelled) setYouError(true);
      })
      .finally(() => {
        if (!cancelled) setYouLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, activeAddress, reloadNonce]);

  // Refresh after a confirmed redemption.
  useEffect(() => {
    const reload = () => setReloadNonce((n) => n + 1);
    window.addEventListener("juice:project-data-invalidated", reload);
    return () =>
      window.removeEventListener("juice:project-data-invalidated", reload);
  }, []);

  const youTally = useMemo(
    () => (you ? tallyItems(you.rows, names) : []),
    [you, names],
  );
  const ranked = useMemo(() => (all ? rankCustomers(all.rows) : []), [all]);

  const cardClass = `border p-4 ${isDark ? "bg-juice-dark-lighter border-gray-600" : "bg-white border-gray-300"}`;
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? "text-gray-500" : "text-gray-400"}`;
  const keyText = isDark ? "text-gray-400" : "text-gray-600";
  const rowClass = `flex items-center justify-between gap-3 py-1 border-t ${isDark ? "border-white/10" : "border-gray-100"}`;
  const linkClass = "text-juice-cyan hover:underline";

  return (
    <div className="space-y-4">
      <ExplainerMessage>
        See who&rsquo;s bought from this shop — the items you own, every
        customer ranked by what they hold, and the most recent purchases. Tap a
        customer to see everything they own, or an item to see its owners.
      </ExplainerMessage>

      {/* You */}
      <div className={cardClass}>
        <div className={cardTitleClass}>You</div>
        {!activeAddress ? (
          <p className={`text-sm ${keyText}`}>
            Connect a wallet to see the items you own.
          </p>
        ) : youLoading && !you ? (
          <p className={`text-sm ${keyText}`}>Loading your items…</p>
        ) : youError ? (
          <p className="text-sm text-red-400" role="alert">
            Could not load your items.
          </p>
        ) : you && !you.rows.length ? (
          <p className={`text-sm ${keyText}`}>
            You don&rsquo;t own any items from this shop yet.
          </p>
        ) : you ? (
          <div>
            <div
              className={`text-sm font-medium mb-2 ${isDark ? "text-white" : "text-gray-900"}`}
            >
              {you.rows.length} item{you.rows.length === 1 ? "" : "s"} owned
            </div>
            <div>
              {youTally.map((t) => (
                <div key={t.tierId} className={rowClass}>
                  <span className="flex items-center gap-2 min-w-0">
                    <ShopItemThumb
                      media={media}
                      tierId={t.tierId}
                      isDark={isDark}
                    />
                    <span
                      className={`truncate ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t.label}
                    </span>
                  </span>
                  <span
                    className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
                  >
                    ×{t.count}
                  </span>
                </div>
              ))}
            </div>
            {redeemEnabled ? (
              <button
                onClick={() => setRedeemOpen(true)}
                className="mt-3 text-sm text-juice-cyan hover:underline"
              >
                Redeem items for surplus →
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* All */}
      <div className={cardClass}>
        <div className={cardTitleClass}>All</div>
        {allLoading && !all ? (
          <p className={`text-sm ${keyText}`}>Loading customers…</p>
        ) : allError ? (
          <p className="text-sm text-red-400" role="alert">
            Could not load customers.
          </p>
        ) : all && !all.rows.length ? (
          <p className={`text-sm ${keyText}`}>No items have been bought yet.</p>
        ) : all ? (
          <div>
            <div
              className={`text-sm font-medium mb-3 ${isDark ? "text-white" : "text-gray-900"}`}
            >
              {ranked.length} customer{ranked.length === 1 ? "" : "s"} |{" "}
              {all.total} item{all.total === 1 ? "" : "s"} sold
              {all.capped ? ` (showing latest ${all.rows.length})` : ""}
            </div>

            {/* Ranked customers — address (→ everything they own) + item thumbs (→ that item's owners). */}
            <div className="overflow-x-auto">
              {ranked.slice(0, 100).map((cust) => (
                <div key={cust.address.toLowerCase()} className={rowClass}>
                  <button
                    type="button"
                    onClick={() =>
                      setDrilldown({ kind: "address", address: cust.address })
                    }
                    className={`${linkClass} font-mono text-sm whitespace-nowrap`}
                    title="See everything they own"
                  >
                    {truncateAddress(cust.address)}
                  </button>
                  <span className="flex items-center gap-1.5 flex-wrap justify-end">
                    {tallyItems(cust.mints, names).map((t) => (
                      <button
                        key={t.tierId}
                        type="button"
                        onClick={() =>
                          setDrilldown({
                            kind: "tier",
                            tierId: t.tierId,
                            label: t.label,
                          })
                        }
                        className="relative shrink-0 hover:opacity-80 transition-opacity"
                        title={`${t.count > 1 ? `${t.count}× ` : ""}${t.label} — see owners`}
                      >
                        <ShopItemThumb
                          media={media}
                          tierId={t.tierId}
                          isDark={isDark}
                          size="md"
                        />
                        {t.count > 1 ? (
                          <span className="absolute -bottom-1 -right-1 px-1 text-[10px] font-mono leading-tight bg-juice-cyan text-black">
                            ×{t.count}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Recent purchases — its own bordered Item | Holder | When table. */}
      {all && all.rows.length ? (
        <div className={cardClass}>
          <div className={cardTitleClass}>Recent purchases</div>
          <div className="overflow-x-auto">
            <div className="min-w-full">
              <div
                className={`flex items-center gap-3 pb-1 text-xs font-medium uppercase tracking-wide ${keyText}`}
              >
                <span className="flex-1">Item</span>
                <span className="w-28">Holder</span>
                {/* Empty "When" header — the time column speaks for itself (website b45304d). */}
                <span className="w-20 text-right" aria-hidden="true"></span>
              </div>
              {all.rows.slice(0, 25).map((m) => {
                const tx = explorerTxUrl(m.chainId, m.txHash);
                const addrUrl = explorerAddressUrl(m.chainId, m.beneficiary);
                return (
                  <div
                    key={`${m.txHash}-${m.tokenId}`}
                    className={`flex items-center gap-3 py-1 border-t text-sm ${isDark ? "border-white/10" : "border-gray-100"}`}
                  >
                    <span className="flex-1 flex items-center gap-2 min-w-0">
                      <ShopItemThumb
                        media={media}
                        tierId={m.tierId}
                        isDark={isDark}
                      />
                      <span
                        className={`truncate ${isDark ? "text-gray-300" : "text-gray-700"}`}
                      >
                        {itemLabelFrom(names, m.tierId)}
                      </span>
                    </span>
                    <span className="w-28 font-mono whitespace-nowrap">
                      {addrUrl ? (
                        <a
                          href={addrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={linkClass}
                        >
                          {truncateAddress(m.beneficiary)}
                        </a>
                      ) : (
                        truncateAddress(m.beneficiary)
                      )}
                    </span>
                    <span
                      className={`w-20 text-right whitespace-nowrap ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {tx ? (
                        <a
                          href={tx}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={linkClass}
                        >
                          {formatTimeAgo(m.timestamp)}
                        </a>
                      ) : (
                        formatTimeAgo(m.timestamp)
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Drilldowns: one item's owners, or one address's items. */}
      <DrilldownModal
        drilldown={drilldown}
        rows={all?.rows ?? []}
        meta={meta}
        isDark={isDark}
        linkClass={linkClass}
        onClose={() => setDrilldown(null)}
        onOpenTier={(tierId, label) =>
          setDrilldown({ kind: "tier", tierId, label })
        }
      />

      <RedeemItemsModal
        isOpen={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        chains={chains}
        defaultChainId={chainId}
        onRedeemed={() => setReloadNonce((n) => n + 1)}
      />
    </div>
  );
}

/**
 * The drilldown modal shared by both directions. `tier` lists an item's holders
 * (address + ×count); `address` lists everything one buyer owns, each item
 * clickable to pivot into that item's holders (mirrors website's two modals).
 */
function DrilldownModal({
  drilldown,
  rows,
  meta,
  isDark,
  linkClass,
  onClose,
  onOpenTier,
}: {
  drilldown: Drilldown | null;
  rows: MintRow[];
  meta: ShopItemMeta;
  isDark: boolean;
  linkClass: string;
  onClose: () => void;
  onOpenTier: (tierId: number, label: string) => void;
}) {
  const rowBorder = isDark ? "border-white/10" : "border-gray-100";

  if (drilldown?.kind === "tier") {
    const owners = ownersOfTier(rows, drilldown.tierId);
    return (
      <Modal
        isOpen
        onClose={onClose}
        title={`${drilldown.label} owners`}
        size="md"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShopItemThumb
            media={meta.media}
            tierId={drilldown.tierId}
            isDark={isDark}
            size="md"
          />
          <span
            className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {drilldown.label} — {owners.length} owner
            {owners.length === 1 ? "" : "s"}
          </span>
        </div>
        <div>
          {owners.map((o) => {
            const url = explorerAddressUrl(o.chainId, o.address);
            return (
              <div
                key={o.address.toLowerCase()}
                className={`flex items-center justify-between gap-3 py-1 border-t text-sm ${rowBorder}`}
              >
                <span className="font-mono whitespace-nowrap">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      {truncateAddress(o.address)}
                    </a>
                  ) : (
                    truncateAddress(o.address)
                  )}
                </span>
                <span
                  className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  ×{o.count}
                </span>
              </div>
            );
          })}
        </div>
      </Modal>
    );
  }

  if (drilldown?.kind === "address") {
    const address = drilldown.address;
    const mints = rows.filter(
      (m) =>
        String(m.beneficiary || "").toLowerCase() === address.toLowerCase(),
    );
    const tally = tallyItems(mints, meta.names);
    const url = explorerAddressUrl(mints[0]?.chainId ?? 0, address);
    return (
      <Modal isOpen onClose={onClose} title="Items owned" size="md">
        <div className="mb-3 font-mono text-sm">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {truncateAddress(address)}
            </a>
          ) : (
            truncateAddress(address)
          )}
        </div>
        <div>
          {tally.map((t) => (
            <button
              key={t.tierId}
              type="button"
              onClick={() => onOpenTier(t.tierId, t.label)}
              className={`w-full flex items-center justify-between gap-3 py-1 border-t text-sm text-left ${rowBorder} hover:opacity-80 transition-opacity`}
              title={`${t.label} — see owners`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <ShopItemThumb
                  media={meta.media}
                  tierId={t.tierId}
                  isDark={isDark}
                />
                <span
                  className={`truncate ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {t.label}
                </span>
              </span>
              <span
                className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
              >
                ×{t.count}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return null;
}
