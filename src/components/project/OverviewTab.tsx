import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "../../stores";
import {
  CHAINS,
  MAINNET_CHAINS,
  JB_CONTRACTS,
  ZERO_ADDRESS,
} from "../../constants";
import { projectPathFor } from "../../utils/projectLink";
import {
  fetchRevnetOperator,
  type Project,
  type ConnectedChain,
} from "../../services/bendystraw";
import { getSafetyPublicClient } from "../../utils/transactionSafety";
import { truncateAddress } from "../../utils/ens";
import ChainLogo from "../ui/ChainLogo";
import { IpfsImage } from "../ui/IpfsMedia";
import { ExplainerMessage } from "../ui/ExplainerMessage";
import { RichContent } from "../ui/RichContent";

// Overview tab — 1:1 port of website/src/discover.js renderAboutSection (:6825):
// About card (logo, tagline, description, links, Edit) + Other info panel
// (per-chain project IDs, token facts, per-chain owner/operator with a
// "differs by chain" breakdown). Revnets show the price chart FIRST — the
// dashboard passes juicy's existing PriceChart through the `priceChart` slot.

interface OverviewTabProps {
  project: Project;
  chainId: number;
  projectId: number;
  connectedChains: ConnectedChain[];
  isRevnet: boolean;
  /** Revnet operator on the current chain (already resolved by the dashboard). */
  revnetOperator?: string | null;
  /** Render the Edit button (dashboard wires it to the SetUriForm modal). */
  canEdit: boolean;
  onEditMetadata: () => void;
  /** Revnets render this first — pass juicy's PriceChart, do not rebuild it. */
  priceChart?: ReactNode;
  /** Optional ProjectSummary block, composed like the previous About tab did. */
  summary?: ReactNode;
}

interface AuthorityRow {
  chainId: number;
  name: string;
  owner: string | null;
}

const JB_PROJECTS_OWNER_OF_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

function chainNameOf(chainId: number): string {
  return (
    CHAINS[chainId]?.name || MAINNET_CHAINS[chainId]?.name || `Chain ${chainId}`
  );
}

function explorerAddressUrl(chainId: number, address: string): string | null {
  const explorer =
    CHAINS[chainId]?.explorer || MAINNET_CHAINS[chainId]?.explorer;
  return explorer ? `${explorer}/address/${address}` : null;
}

/** True when the per-chain owner/operator reads disagree (website authorityRowsDiverged :7018). */
export function authorityRowsDiverged(rows: readonly AuthorityRow[]): boolean {
  const known = rows.filter((row) => row.owner);
  if (known.length === 0) return false;
  const first = known[0].owner!.toLowerCase();
  return known.some((row) => row.owner!.toLowerCase() !== first);
}

// --- Project links (website renderProjectLinks :6873) ----------------------

function projectLinkEntries(project: Project): Array<[string, string]> {
  const meta = project.metadata;
  const entries: Array<[string, string]> = [];
  const infoUri = meta?.infoUri;
  if (infoUri)
    entries.push([
      "Website",
      infoUri.startsWith("http") ? infoUri : `https://${infoUri}`,
    ]);
  if (meta?.twitter) {
    const handle = String(meta.twitter).replace(/^@/, "");
    entries.push([
      "X",
      /^https?:/.test(handle) ? handle : `https://x.com/${handle}`,
    ]);
  }
  if (meta?.discord) {
    const discord = String(meta.discord);
    entries.push([
      "Discord",
      /^https?:/.test(discord)
        ? discord
        : `https://${discord.replace(/^\/+/, "")}`,
    ]);
  }
  if (meta?.telegram) {
    const tg = String(meta.telegram);
    entries.push([
      "Telegram",
      /^https?:/.test(tg)
        ? tg
        : tg.startsWith("t.me")
          ? `https://${tg}`
          : `https://t.me/${tg.replace(/^@/, "")}`,
    ]);
  }
  return entries;
}

export default function OverviewTab({
  project,
  chainId,
  projectId,
  connectedChains,
  isRevnet,
  revnetOperator,
  canEdit,
  onEditMetadata,
  priceChart,
  summary,
}: OverviewTabProps) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const isDark = theme === "dark";

  const chains = useMemo<ConnectedChain[]>(
    () =>
      connectedChains.length > 0 ? connectedChains : [{ chainId, projectId }],
    [connectedChains, chainId, projectId],
  );

  // Per-chain owner/operator — only fetched when the project spans chains,
  // to detect (and break down) divergent control.
  const [authorityRows, setAuthorityRows] = useState<AuthorityRow[] | null>(
    null,
  );

  useEffect(() => {
    if (chains.length <= 1) {
      setAuthorityRows(null);
      return;
    }
    let cancelled = false;
    async function loadAuthorityRows() {
      const rows = await Promise.all(
        chains.map(async (chain): Promise<AuthorityRow> => {
          const name = chainNameOf(chain.chainId);
          try {
            if (isRevnet) {
              const operator = await fetchRevnetOperator(
                String(chain.projectId),
                chain.chainId,
              );
              return { chainId: chain.chainId, name, owner: operator };
            }
            const owner = await getSafetyPublicClient(
              chain.chainId,
            ).readContract({
              address: JB_CONTRACTS.JBProjects,
              abi: JB_PROJECTS_OWNER_OF_ABI,
              functionName: "ownerOf",
              args: [BigInt(chain.projectId)],
            });
            return { chainId: chain.chainId, name, owner };
          } catch {
            return { chainId: chain.chainId, name, owner: null };
          }
        }),
      );
      if (!cancelled) setAuthorityRows(rows);
    }
    loadAuthorityRows();
    return () => {
      cancelled = true;
    };
  }, [chains, isRevnet]);

  const authorityLabel = isRevnet ? "Revnet operator" : "Project owner";
  const authorityAddress = isRevnet
    ? (revnetOperator ?? null)
    : project.owner || null;
  const diverged = authorityRows ? authorityRowsDiverged(authorityRows) : false;

  const tagline = project.metadata?.projectTagline || project.metadata?.tagline;
  const description = project.description || project.metadata?.description;
  const links = projectLinkEntries(project);

  const hasErc20 = Boolean(
    project.token &&
    project.token.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
    project.tokenSymbol,
  );

  const cardClass = `p-4 border ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`;
  const cardTitleClass = `text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-gray-500" : "text-gray-400"}`;
  const infoLabelClass = `text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`;
  const infoValueClass = `text-sm ${isDark ? "text-gray-200" : "text-gray-700"}`;

  return (
    <div className="space-y-6">
      {/* Revnets lead with the price chart (website renderPriceChart slot :13205). */}
      {isRevnet && priceChart}

      <ExplainerMessage>
        {isRevnet
          ? "This is an autonomous revnet — its terms are locked in stages that nobody can change. Here's what it's about, and where it lives onchain."
          : "Here's what this project is about — its story, links, and where it lives onchain."}
      </ExplainerMessage>

      {/* About card (website renderAboutCard :6833) */}
      <div className={cardClass}>
        <div className={cardTitleClass}>About</div>

        {project.logoUri && (
          <IpfsImage
            uri={project.logoUri}
            alt={project.name || ""}
            className="w-20 h-20 object-cover mb-3"
            fallback={null}
          />
        )}

        {tagline && (
          <div
            className={`text-sm font-medium mb-2 ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {tagline}
          </div>
        )}

        {description ? (
          <RichContent
            html={description}
            className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
          />
        ) : (
          <p
            className={`text-sm italic ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            No description yet.
          </p>
        )}

        {links.length > 0 && (
          <div className="mt-4 space-y-1">
            {links.map(([label, url]) => (
              <div key={label} className="flex items-baseline gap-1.5 text-xs">
                <span className={infoLabelClass}>{label}:</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:underline break-all ${isDark ? "text-gray-300" : "text-gray-600"}`}
                >
                  {url}
                </a>
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div
            className={`mt-4 pt-3 border-t ${isDark ? "border-white/10" : "border-gray-200"}`}
          >
            <button
              onClick={onEditMetadata}
              className="text-xs font-medium text-juice-orange hover:underline"
              title="Edit the project — logo, tagline, description, links"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {summary}

      {/* Other info panel (website renderOtherInfoPanel :7055) */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Other info</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {/* Per-chain project IDs */}
          <div>
            <div className={`${infoLabelClass} mb-1`}>
              {chains.length > 1 ? "Project IDs" : "Project ID"}
            </div>
            <div className="space-y-1">
              {chains.map((chain) => {
                const path = projectPathFor(chain.chainId, chain.projectId);
                const row = (
                  <span className="flex items-center gap-1.5">
                    <ChainLogo chainId={chain.chainId} size={14} />
                    <span className={infoValueClass}>
                      {chainNameOf(chain.chainId)}
                    </span>
                    <span
                      className={`text-sm font-mono ${isDark ? "text-white" : "text-gray-900"}`}
                    >
                      #{chain.projectId}
                    </span>
                  </span>
                );
                return path ? (
                  <button
                    key={chain.chainId}
                    onClick={() => navigate(path)}
                    className="block text-left hover:underline"
                    title={`Open #${chain.projectId} on ${chainNameOf(chain.chainId)}`}
                  >
                    {row}
                  </button>
                ) : (
                  <div key={chain.chainId}>{row}</div>
                );
              })}
            </div>
          </div>

          {/* Token facts */}
          <div className="space-y-2">
            {hasErc20 ? (
              <>
                <div>
                  <div className={infoLabelClass}>Token symbol</div>
                  <div className={infoValueClass}>{project.tokenSymbol}</div>
                </div>
                <div>
                  <div className={infoLabelClass}>Token address</div>
                  <div
                    className={`text-xs font-mono break-all ${isDark ? "text-gray-200" : "text-gray-700"}`}
                  >
                    {project.token}
                  </div>
                </div>
                <div>
                  <div className={infoLabelClass}>Token type</div>
                  <div className={infoValueClass}>ERC-20</div>
                </div>
                {chains.length > 1 && (
                  <div>
                    {/* JB omnichain ERC-20s share one deterministic address on every chain. */}
                    <div className={infoLabelClass}>Token on</div>
                    <div className={infoValueClass}>
                      {chains
                        .map((chain) => chainNameOf(chain.chainId))
                        .join(", ")}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <div className={infoLabelClass}>Token type</div>
                <div className={infoValueClass}>Credits</div>
              </div>
            )}
          </div>

          {/* Owner / operator — with a per-chain breakdown when control diverges */}
          <div className="sm:col-span-2">
            <div className={`${infoLabelClass} mb-1`}>{authorityLabel}</div>
            {diverged && authorityRows ? (
              <div className="space-y-1">
                <div
                  className={`text-xs font-medium ${isDark ? "text-amber-300" : "text-amber-700"}`}
                >
                  {authorityLabel} differs by chain
                </div>
                {authorityRows.map((row) => (
                  <div
                    key={row.chainId}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <ChainLogo chainId={row.chainId} size={14} />
                    <span className={infoLabelClass}>{row.name}</span>
                    {row.owner ? (
                      <a
                        href={explorerAddressUrl(row.chainId, row.owner) ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`font-mono hover:underline ${isDark ? "text-gray-200" : "text-gray-700"}`}
                      >
                        {truncateAddress(row.owner)}
                      </a>
                    ) : (
                      <span className={infoLabelClass}>—</span>
                    )}
                  </div>
                ))}
              </div>
            ) : authorityAddress ? (
              <a
                href={explorerAddressUrl(chainId, authorityAddress) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs font-mono break-all hover:underline ${isDark ? "text-gray-200" : "text-gray-700"}`}
              >
                {authorityAddress}
              </a>
            ) : (
              <span className={infoLabelClass}>—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
