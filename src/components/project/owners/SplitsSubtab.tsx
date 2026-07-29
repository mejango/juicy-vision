/**
 * Splits (revnet) / Reserved (custom) subtab — the reserved-token split
 * recipients per stage, per-chain pending balances, and permissionless
 * per-chain Distribute. Ports website/src/discover.js renderOwnersSplits
 * (:15651) + appendChainSplitBlock (:16937) + makeChainDistribute (:16977).
 *
 * Variants:
 *   'splits'   — revnets: a per-stage stepper over every stage, an operator
 *                "Edit splits" CTA, and the latest-distributions feed.
 *   'reserved' — custom projects: only the current ruleset's recipients (no
 *                stage framing); splits are edited from the ruleset flow, so
 *                no CTA here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, zeroAddress } from "viem";
import { jbControllerAbi } from "@bananapus/nana-sdk-core";
import { useThemeStore } from "../../../stores";
import { CHAINS } from "../../../constants";
import ChainLogo from "../../ui/ChainLogo";
import { ExplainerMessage } from "../../ui/ExplainerMessage";
import { ProjectSplitRoute } from "../../dynamic/ProjectSplitRoute";
import { useGuardedTx } from "../../../hooks/useGuardedTx";
import type { GuardedTxPhase } from "../../../services/projectTx";
import type { Project } from "../../../services/bendystraw";
import {
  fetchAllRulesets,
  getContractsForProject,
  type SimpleRuleset,
} from "../../../services/bendystraw";
import {
  activeStageIndexAt,
  formatTokenCount18,
  percentFromBasisPoints,
} from "../../../services/revnetStages";
import { formatTimeAgo } from "../../../utils";
import {
  fetchPendingReservedPerChain,
  fetchReservedDistributions,
  fetchStageReservedSplits,
  formatIssuancePercent,
  formatOfLimitPercent,
  isBurnBeneficiary,
  pendingShareOf,
  readPendingReserved,
  type ChainStageSplits,
  type PendingReservedRow,
  type ReservedDistributionRow,
  type ReservedSplit,
  type ChainProject,
} from "../../../services/reservedSplits";

export interface SplitsSubtabProps {
  project: Project;
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[];
  /** Per-chain project ids (V6 ids differ per chain). Falls back to the home id. */
  chainProjects?: ChainProject[];
  /** 'splits' = revnet per-stage view; 'reserved' = custom current-ruleset view. */
  variant: "splits" | "reserved";
  /**
   * Revnet-only "Edit splits" CTA — the dashboard opens the SetSplitsForm modal
   * for the BROWSED stage (its start-order index), not whatever stage is current.
   */
  onEditSplits?: (stageIndex: number) => void;
}

type DistributeStatus =
  | { kind: "idle" }
  | { kind: "running"; phase: GuardedTxPhase }
  | { kind: "done" }
  | { kind: "error"; message: string };

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: "Re-checking pending reserved tokens…",
  switching: "Switching network…",
  approving: "Approving…",
  simulating: "Simulating…",
  signing: "Confirm in your wallet…",
  pending: "Transaction pending…",
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function SplitsSubtab({
  project,
  chainIds,
  chainProjects,
  variant,
  onEditSplits,
}: SplitsSubtabProps) {
  const { theme } = useThemeStore();
  const isDark = theme === "dark";
  const { activeAddress, run } = useGuardedTx();

  const symbol = project.tokenSymbol || "tokens";
  const reserved = variant === "reserved";

  const [stages, setStages] = useState<SimpleRuleset[] | null>(null);
  const [stagesError, setStagesError] = useState(false);
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  // Splits cache keyed by stage index, then chain id. Splits are per-chain state
  // under a per-chain ruleset id, so every chain is read on its own: a missing
  // entry is still loading, and `splits: null` is that one chain failing.
  const [splitsByStage, setSplitsByStage] = useState<
    Record<number, Record<number, ChainStageSplits>>
  >({});
  const splitsInFlight = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pendingRows, setPendingRows] = useState<PendingReservedRow[] | null>(
    null,
  );
  const [distributions, setDistributions] = useState<
    ReservedDistributionRow[] | null
  >(null);
  const [statuses, setStatuses] = useState<Record<number, DistributeStatus>>(
    {},
  );
  const [pendingNonce, setPendingNonce] = useState(0);

  // V6 project ids are independent per chain — resolve each chain's own id for
  // per-chain reads/txs; never use the home id off-home.
  const pidFor = useCallback(
    (cid: number): number | string =>
      chainProjects?.find((cp) => cp.chainId === cid)?.projectId ??
      project.projectId,
    [chainProjects, project.projectId],
  );
  const chainProjectList = useMemo<ChainProject[]>(
    () => chainIds.map((cid) => ({ chainId: cid, projectId: pidFor(cid) })),
    [chainIds, pidFor],
  );

  // Stages (rulesets, start-ascending) from the home chain.
  useEffect(() => {
    let cancelled = false;
    setStagesError(false);
    fetchAllRulesets(String(project.projectId), project.chainId)
      .then((loaded) => {
        if (cancelled) return;
        setStages(loaded);
        setStageIndex(
          activeStageIndexAt(loaded, Math.floor(Date.now() / 1000)),
        );
      })
      .catch(() => {
        if (!cancelled) setStagesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId, project.chainId]);

  const currentIndex = stages
    ? activeStageIndexAt(stages, Math.floor(Date.now() / 1000))
    : null;
  // The Reserved variant shows only the current ruleset — no stage stepper.
  const shownIndex = reserved ? currentIndex : stageIndex;
  const shownStage = stages && shownIndex != null ? stages[shownIndex] : null;
  const isCurrent = shownIndex != null && shownIndex === currentIndex;

  // Splits for the shown stage, read once per (stage, chain) — each chain
  // resolves its own ruleset id for that stage and renders as soon as it lands,
  // so one slow or failing chain never blocks the others.
  useEffect(() => {
    if (shownIndex == null) return;
    const stageIndex = shownIndex;
    const loaded = splitsByStage[stageIndex] ?? {};
    for (const chainProject of chainProjectList) {
      if (loaded[chainProject.chainId] !== undefined) continue;
      // Reads outlive this effect run (browsing stages re-runs it), so requests
      // are de-duped by a live-request key rather than cancelled per run.
      const key = `${stageIndex}:${chainProject.chainId}`;
      if (splitsInFlight.current.has(key)) continue;
      splitsInFlight.current.add(key);
      fetchStageReservedSplits(chainProject, stageIndex)
        .then((row) => {
          if (!mounted.current) return;
          setSplitsByStage((previous) => ({
            ...previous,
            [stageIndex]: {
              ...(previous[stageIndex] ?? {}),
              [row.chainId]: row,
            },
          }));
        })
        .finally(() => splitsInFlight.current.delete(key));
    }
  }, [shownIndex, chainProjectList, splitsByStage]);

  // Per-chain pending reserved (null-tolerant); refreshed after a distribute.
  useEffect(() => {
    let cancelled = false;
    fetchPendingReservedPerChain(chainProjectList)
      .then((rows) => {
        if (!cancelled) setPendingRows(rows);
      })
      .catch(() => {
        if (!cancelled) setPendingRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chainProjectList, pendingNonce]);

  // Latest distributions (revnet Splits view only), best-effort from Bendystraw.
  useEffect(() => {
    if (reserved) return;
    let cancelled = false;
    fetchReservedDistributions(chainProjectList)
      .then((rows) => {
        if (!cancelled) setDistributions(rows);
      })
      .catch(() => {
        if (!cancelled) setDistributions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chainProjectList, reserved, pendingNonce]);

  const setStatus = useCallback(
    (chainId: number, status: DistributeStatus) =>
      setStatuses((previous) => ({ ...previous, [chainId]: status })),
    [],
  );

  const distribute = async (chainId: number) => {
    if (!activeAddress) {
      setStatus(chainId, { kind: "error", message: "Connect a wallet first." });
      return;
    }
    const chainName = CHAINS[chainId]?.name ?? `chain ${chainId}`;
    try {
      // Resolve (and verify) the project's controller on that chain, exactly
      // like the website's controllerAddressFor before the send.
      const pid = pidFor(chainId);
      const { JBController } = await getContractsForProject(
        String(pid),
        chainId,
      );
      const data = encodeFunctionData({
        abi: jbControllerAbi,
        functionName: "sendReservedTokensToSplitsOf",
        args: [BigInt(pid)],
      });
      await run({
        chainId,
        to: JBController,
        data,
        review: {
          title: "Review reserved token distribution",
          label: `Send project #${String(pid)} reserved tokens to its configured splits`,
          contractName: "JBController",
          abi: jbControllerAbi,
          functionName: "sendReservedTokensToSplitsOf",
          args: [BigInt(pid)],
        },
        // Abort when the pending balance dropped to zero since review —
        // someone else may have distributed while this sat open.
        reverify: async () => {
          const fresh = await readPendingReserved(pid, chainId);
          if (fresh === 0n) {
            throw new Error(
              `Nothing left to distribute on ${chainName} — someone already distributed.`,
            );
          }
        },
        onPhase: (phase) => setStatus(chainId, { kind: "running", phase }),
      });
      setStatus(chainId, { kind: "done" });
      setPendingNonce((nonce) => nonce + 1);
    } catch (error) {
      setStatus(chainId, {
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The distribute transaction failed.",
      });
    }
  };

  const cardClass = `border p-4 ${isDark ? "bg-juice-dark-lighter border-gray-600" : "bg-white border-gray-300"}`;
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? "text-gray-500" : "text-gray-400"}`;
  const mutedText = isDark ? "text-gray-500" : "text-gray-400";
  const bodyText = isDark ? "text-gray-400" : "text-gray-600";

  const splitAccount = (split: ReservedSplit) => {
    if (split.projectId > 0) {
      return (
        <ProjectSplitRoute
          projectId={split.projectId}
          chainId={project.chainId}
          beneficiary={split.beneficiary}
          kind="reserved"
          preferAddToBalance={split.preferAddToBalance}
          hook={split.hook !== zeroAddress ? split.hook : undefined}
          isDark={isDark}
        />
      );
    }
    if (split.hook !== zeroAddress) {
      return (
        <div className="min-w-0">
          <span className="font-mono text-xs" title={split.hook}>
            {shortAddress(split.hook)}
          </span>
          <div className={`text-[10px] ${mutedText}`}>split hook</div>
        </div>
      );
    }
    if (isBurnBeneficiary(split.beneficiary)) {
      // The 0xdead beneficiary is the burn sentinel — this slice of reserved
      // tokens is destroyed, not sent to an account.
      return (
        <span
          title={split.beneficiary}
          className={isDark ? "text-gray-300" : "text-gray-700"}
        >
          Burn
        </span>
      );
    }
    return (
      <span className="font-mono text-xs" title={split.beneficiary}>
        {shortAddress(split.beneficiary)}
      </span>
    );
  };

  const renderChainBlock = (chainProject: ChainProject) => {
    const chainId = chainProject.chainId;
    const chainName = CHAINS[chainId]?.name ?? `Chain ${chainId}`;
    const row =
      shownIndex != null ? splitsByStage[shownIndex]?.[chainId] : undefined;
    const pending =
      pendingRows?.find((pendingRow) => pendingRow.chainId === chainId)
        ?.pending ?? null;
    const hasPending = isCurrent && pending != null && pending > 0n;
    const status = statuses[chainId] ?? { kind: "idle" };
    const reservedPercent = shownStage?.reservedPercent ?? 0;
    return (
      <div
        key={chainId}
        data-testid={`splits-chain-${chainId}`}
        className={`border-t pt-2 ${isDark ? "border-white/10" : "border-gray-100"}`}
      >
        <div
          className={`text-xs font-medium mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <ChainLogo chainId={chainId} size={14} />
            {chainName}
          </span>
        </div>
        {row === undefined ? (
          <p className={`text-sm ${mutedText}`}>Reading splits…</p>
        ) : row.splits === null ? (
          <p className="text-sm text-red-400" role="alert">
            Could not read splits on {chainName}.
          </p>
        ) : !row.splits.length ? (
          <p className={`text-sm ${bodyText}`}>
            {reserved
              ? `No reserved recipients set — reserved ${symbol} goes to the project owner.`
              : "No splits configured for this stage — reserved tokens go to REVOwner."}
          </p>
        ) : (
          <table
            className={`w-full text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}
          >
            <tbody>
              {row.splits.map((split, index) => (
                <tr key={index}>
                  <td className="py-1.5 pr-3 w-[46%]">{splitAccount(split)}</td>
                  <td className="py-1.5 pr-3">
                    <strong>
                      {formatIssuancePercent(split.percent, reservedPercent)}
                    </strong>{" "}
                    <span className={`text-xs ${mutedText}`}>
                      ({formatOfLimitPercent(split.percent)})
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {hasPending
                      ? `${formatTokenCount18(pendingShareOf(pending as bigint, split.percent))} ${symbol}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Per-chain permissionless Distribute — idle unless this chain has pending. */}
        <div className="flex items-center justify-end gap-3 mt-1">
          {status.kind === "running" ? (
            <span
              className={`text-xs ${isDark ? "text-juice-cyan" : "text-cyan-700"}`}
            >
              {PHASE_LABELS[status.phase]}
            </span>
          ) : null}
          {status.kind === "error" ? (
            <span className="text-xs text-red-400" role="alert">
              {status.message}
            </span>
          ) : null}
          {status.kind === "done" ? (
            <span
              className={`text-xs ${isDark ? "text-green-400" : "text-green-600"}`}
            >
              Pending splits distributed on {chainName}.
            </span>
          ) : null}
          <button
            onClick={() => distribute(chainId)}
            disabled={
              !hasPending || status.kind === "running" || status.kind === "done"
            }
            title={
              hasPending
                ? `Send ${chainName}’s pending reserved ${symbol} to the splits (anyone can)`
                : isCurrent
                  ? `Nothing pending to distribute on ${chainName}`
                  : "Only the current stage has pending splits"
            }
            className={`px-3 py-1 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isDark
                ? "border-white/20 text-white hover:bg-white/10"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
          >
            {status.kind === "done"
              ? "Distributed"
              : status.kind === "running"
                ? "Distributing…"
                : "Distribute"}
          </button>
        </div>
      </div>
    );
  };

  // A past stage's ruleset can never be active again, so writing splits to it
  // would be a no-op; the current and future stages are both editable
  // (JBController.setSplitGroupsOf takes any ruleset id).
  const stageEnded =
    shownIndex != null && currentIndex != null && shownIndex < currentIndex;

  return (
    <div className={cardClass}>
      <div className={cardTitleClass}>{reserved ? "Reserved" : "Splits"}</div>
      <div className="mb-3">
        <ExplainerMessage>
          {reserved
            ? `A reserved percentage of newly issued ${symbol} is split between these accounts. The project owner can adjust the recipients at any time, up to the reserved rate set by the ruleset.`
            : `Newly issued and bought back ${symbol} are split between these accounts. The revnet operator can adjust the splits at any time within each stage’s permanent split limit.`}
        </ExplainerMessage>
      </div>

      {stagesError ? (
        <p className="text-sm text-red-400" role="alert">
          Could not read the project’s rulesets.
        </p>
      ) : !stages ? (
        <p className={`text-sm ${mutedText}`}>Reading stages…</p>
      ) : !stages.length ? (
        <p className={`text-sm ${bodyText}`}>No stages found onchain.</p>
      ) : (
        <div className="space-y-3">
          {/* Per-stage stepper — revnet Splits view only. */}
          {!reserved ? (
            <div className="flex flex-wrap gap-1">
              {stages.map((stage, index) => (
                <button
                  key={stage.id}
                  onClick={() => setStageIndex(index)}
                  className={`px-2.5 py-1 text-xs border transition-colors ${
                    index === shownIndex
                      ? isDark
                        ? "border-juice-cyan text-white"
                        : "border-cyan-700 text-gray-900"
                      : isDark
                        ? "border-white/15 text-gray-400 hover:text-gray-200"
                        : "border-gray-200 text-gray-500 hover:text-gray-800"
                  }`}
                >
                  Stage {index + 1}
                  {index === currentIndex ? (
                    <span
                      title="current"
                      className={`inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle ${
                        isDark ? "bg-juice-cyan" : "bg-cyan-700"
                      }`}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {shownStage ? (
            <p className={`text-sm ${bodyText}`}>
              {reserved
                ? `Reserved rate: ${percentFromBasisPoints(shownStage.reservedPercent)} of issuance.`
                : `The split limit for this stage is ${percentFromBasisPoints(shownStage.reservedPercent)} of issuance.`}
            </p>
          ) : null}

          <div className="overflow-x-auto">
            {/* Standalone column header, then each chain as its own block —
                every chain stores its own splits under its own ruleset id. */}
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-xs uppercase tracking-wide ${mutedText}`}>
                  <th className="py-1.5 font-medium text-left w-[46%]">
                    Account
                  </th>
                  <th className="py-1.5 font-medium text-left">Percentage</th>
                  <th className="py-1.5 font-medium text-right">
                    Pending splits
                  </th>
                </tr>
              </thead>
            </table>
            <div className="space-y-3">
              {chainProjectList.map((chainProject) =>
                renderChainBlock(chainProject),
              )}
            </div>
          </div>

          {/* Operator CTA — revnet-only; custom projects edit reserved recipients from the ruleset flow. */}
          {!reserved && onEditSplits ? (
            <div className="pt-2">
              <button
                onClick={() =>
                  shownIndex != null && !stageEnded && onEditSplits(shownIndex)
                }
                disabled={shownIndex == null || stageEnded}
                title={
                  stageEnded
                    ? "This stage has ended — its splits can no longer receive distributions"
                    : `Edit stage ${(shownIndex ?? 0) + 1}’s split recipients (revnet operator only)`
                }
                className={`text-sm underline decoration-dotted underline-offset-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline ${
                  isDark
                    ? "text-juice-cyan hover:text-white"
                    : "text-cyan-700 hover:text-gray-900"
                }`}
              >
                Edit splits
              </button>
            </div>
          ) : null}

          {/* Latest distributions — revnet Splits view only. */}
          {!reserved ? (
            <div
              className={`border-t pt-3 ${isDark ? "border-white/10" : "border-gray-100"}`}
            >
              <div className={cardTitleClass}>Latest distributions</div>
              {!distributions ? (
                <p className={`text-sm ${mutedText}`}>
                  Loading from Bendystraw…
                </p>
              ) : !distributions.length ? (
                <p className={`text-sm ${bodyText}`}>
                  No reserved-token distributions indexed yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {distributions.map((row) => {
                    const chain = CHAINS[row.chainId];
                    return (
                      <div
                        key={`${row.chainId}:${row.txHash}`}
                        className={`flex items-baseline justify-between gap-3 text-sm ${
                          isDark ? "text-gray-200" : "text-gray-800"
                        }`}
                      >
                        <span>
                          {formatTokenCount18(row.tokenCount)} {symbol}
                          <span
                            className={`text-xs ml-2 inline-flex items-center gap-1.5 ${mutedText}`}
                          >
                            <ChainLogo chainId={row.chainId} size={14} />
                            {chain?.name ?? `Chain ${row.chainId}`}
                          </span>
                        </span>
                        {chain ? (
                          <a
                            href={`${chain.explorerTx}${row.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-xs hover:underline ${isDark ? "text-juice-cyan" : "text-cyan-700"}`}
                          >
                            {formatTimeAgo(row.timestamp)}
                          </a>
                        ) : (
                          <span className={`text-xs ${mutedText}`}>
                            {formatTimeAgo(row.timestamp)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
