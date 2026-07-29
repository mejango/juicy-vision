import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { isAddress, parseEther } from "viem";
import { useThemeStore, useAuthStore } from "../../stores";
import { useManagedWallet } from "../../hooks";
import {
  calculateSynchronizedStartTime,
  type JBRulesetConfig,
  type JBTerminalConfig,
} from "../../services/relayr";
import { LaunchProjectModal } from "../payment";
import { pinMetadata } from "../../services/ipfsPinning";
import {
  ALL_CHAIN_IDS,
  CHAINS,
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL_REGISTRY,
  NATIVE_TOKEN,
  UINT224_MAX,
  ZERO_ADDRESS,
} from "../../constants";
import { DEFAULT_CHAIN_ID, normalizeChainIds } from "./create-flow/state";
import ChainLogo from "../ui/ChainLogo";

interface CreateProjectFormProps {
  defaultChainIds?: number[] | string;
}

// Form state for project configuration
interface ProjectFormState {
  // Metadata
  name: string;
  description: string;
  logoUrl: string;
  /** Notice shown to payers before they pay. Omitted from the pinned JSON when blank. */
  payDisclosure: string;

  // Ruleset settings
  duration: string; // Days (0 = ongoing)
  weight: string; // Tokens per ETH
  weightCutPercent: string; // Decay per cycle

  // Token settings
  reservedPercent: string; // 0-100
  cashOutTaxRate: string; // 0-100

  // Permissions
  pausePay: boolean;
  allowOwnerMinting: boolean;
  ownerMustSendPayouts: boolean;

  // Fund access
  payoutLimitType: "none" | "limited" | "unlimited";
  payoutLimit: string;
  surplusAllowanceType: "none" | "limited" | "unlimited";
  surplusAllowance: string;

  // Terminals
  acceptEth: boolean;

  // Memo
  memo: string;
}

const DEFAULT_FORM_STATE: ProjectFormState = {
  name: "",
  description: "",
  logoUrl: "",
  payDisclosure: "",
  duration: "0",
  weight: "1000000",
  weightCutPercent: "0",
  reservedPercent: "0",
  cashOutTaxRate: "0",
  pausePay: false,
  allowOwnerMinting: true,
  ownerMustSendPayouts: false,
  payoutLimitType: "none",
  payoutLimit: "0",
  surplusAllowanceType: "none",
  surplusAllowance: "0",
  acceptEth: true,
  memo: "",
};

/**
 * Convert form state to JBRulesetConfig for contract call
 */
function formStateToRulesetConfig(
  state: ProjectFormState,
  mustStartAtOrAfter: number,
): JBRulesetConfig {
  // Convert duration from days to seconds
  const durationDays = parseFloat(state.duration) || 0;
  const durationSeconds =
    durationDays > 0 ? Math.floor(durationDays * 24 * 60 * 60) : 0;

  // Convert weight (tokens per ETH) - uses 18 decimals
  const weightBigInt = parseEther(state.weight || "1000000");

  // Convert percent values
  const reservedPercent = Math.floor(
    (parseFloat(state.reservedPercent) || 0) * 100,
  );
  const cashOutTaxRate = Math.floor(
    (parseFloat(state.cashOutTaxRate) || 0) * 100,
  );
  const weightCutPercent = Math.floor(
    (parseFloat(state.weightCutPercent) || 0) * 10000000,
  );

  // Build fund access limit groups
  const fundAccessLimitGroups = [];

  if (
    state.payoutLimitType !== "none" ||
    state.surplusAllowanceType !== "none"
  ) {
    const payoutLimits = [];
    const surplusAllowances = [];

    if (state.payoutLimitType === "limited") {
      payoutLimits.push({
        amount: parseEther(state.payoutLimit || "0").toString(),
        currency: 61166, // Native accounting token ID.
      });
    } else if (state.payoutLimitType === "unlimited") {
      payoutLimits.push({
        amount: UINT224_MAX,
        currency: 61166,
      });
    }

    if (state.surplusAllowanceType === "limited") {
      surplusAllowances.push({
        amount: parseEther(state.surplusAllowance || "0").toString(),
        currency: 61166,
      });
    } else if (state.surplusAllowanceType === "unlimited") {
      surplusAllowances.push({
        amount: UINT224_MAX,
        currency: 61166,
      });
    }

    if (payoutLimits.length > 0 || surplusAllowances.length > 0) {
      fundAccessLimitGroups.push({
        terminal: JB_CONTRACTS.JBMultiTerminal,
        token: NATIVE_TOKEN,
        payoutLimits,
        surplusAllowances,
      });
    }
  }

  return {
    mustStartAtOrAfter,
    duration: durationSeconds,
    weight: weightBigInt.toString(),
    weightCutPercent,
    approvalHook: ZERO_ADDRESS,
    metadata: {
      reservedPercent,
      cashOutTaxRate,
      baseCurrency: 1, // ETH
      pausePay: state.pausePay,
      pauseCreditTransfers: false,
      allowOwnerMinting: state.allowOwnerMinting,
      allowSetCustomToken: true,
      allowTerminalMigration: true,
      allowSetTerminals: true,
      allowSetController: true,
      allowAddAccountingContext: true,
      allowAddPriceFeed: true,
      ownerMustSendPayouts: state.ownerMustSendPayouts,
      holdFees: false,
      scopeCashOutsToLocalBalances: false,
      useDataHookForPay: false,
      useDataHookForCashOut: false,
      dataHook: ZERO_ADDRESS,
      metadata: 0,
    },
    splitGroups: [],
    fundAccessLimitGroups,
  };
}

/**
 * Build terminal configurations based on form state
 */
function buildTerminalConfigurations(
  state: ProjectFormState,
): JBTerminalConfig[] {
  const accountingContexts = [];

  if (state.acceptEth) {
    accountingContexts.push({
      token: NATIVE_TOKEN,
      decimals: 18,
      currency: 61166,
    });
  }

  return [
    {
      terminal: JB_CONTRACTS.JBMultiTerminal,
      accountingContextsToAccept: accountingContexts,
    },
    {
      terminal: JB_ROUTER_TERMINAL_REGISTRY,
      accountingContextsToAccept: [],
    },
  ];
}

export default function CreateProjectForm({
  defaultChainIds,
}: CreateProjectFormProps) {
  const { theme } = useThemeStore();
  const isDark = theme === "dark";
  const { mode, isAuthenticated } = useAuthStore();
  const isManagedMode = mode === "managed" && isAuthenticated();

  const { address, isConnected } = useAccount();
  const { address: managedAddress } = useManagedWallet();

  const [formState, setFormState] =
    useState<ProjectFormState>(DEFAULT_FORM_STATE);
  const [selectedChains, setSelectedChains] = useState<number[]>(
    () => normalizeChainIds(defaultChainIds) ?? [DEFAULT_CHAIN_ID],
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [preparedProjectUri, setPreparedProjectUri] = useState("");
  const [preparingMetadata, setPreparingMetadata] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);

  const ownerAddress = (isManagedMode ? managedAddress : address) || "";

  // Calculate synchronized start time for omnichain deployment
  const synchronizedStartTime = calculateSynchronizedStartTime();
  const startDate = new Date(synchronizedStartTime * 1000);

  // Validation
  const configurationValid =
    formState.name.trim().length > 0 && selectedChains.length > 0;
  const isValid =
    configurationValid && (!isManagedMode || isAddress(ownerAddress));

  const updateFormState = useCallback(
    (key: keyof ProjectFormState, value: string | boolean) => {
      setFormState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleChain = useCallback((chainId: number) => {
    setSelectedChains((prev) =>
      prev.includes(chainId)
        ? prev.filter((id) => id !== chainId)
        : [...prev, chainId],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (!configurationValid) return;

    if (!isConnected && !isManagedMode) {
      window.dispatchEvent(new CustomEvent("juice:open-wallet-panel"));
      return;
    }
    if (!isAddress(ownerAddress)) return;

    setPreparingMetadata(true);
    setPreparationError(null);
    try {
      const uri = await pinMetadata(
        {
          name: formState.name,
          description: formState.description,
          logoUri: formState.logoUrl,
          // Set/clear semantics: a blank notice leaves the key out entirely.
          ...(formState.payDisclosure.trim()
            ? { payDisclosure: formState.payDisclosure.trim() }
            : {}),
        },
        `project-${formState.name}`,
      );
      setPreparedProjectUri(uri);
      setShowModal(true);
    } catch (err) {
      setPreparedProjectUri("");
      setPreparationError(
        err instanceof Error
          ? err.message
          : "Could not prepare project metadata",
      );
    } finally {
      setPreparingMetadata(false);
    }
  }, [
    configurationValid,
    isConnected,
    isManagedMode,
    ownerAddress,
    formState.name,
    formState.description,
    formState.logoUrl,
    formState.payDisclosure,
  ]);

  // Build config for modal
  const rulesetConfig = formStateToRulesetConfig(
    formState,
    synchronizedStartTime,
  );
  const terminalConfigurations = buildTerminalConfigurations(formState);

  return (
    <div className="w-full">
      <div
        className={`max-w-lg border p-4 ${
          isDark
            ? "bg-juice-dark-lighter border-gray-600"
            : "bg-white border-gray-300"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-14 h-14 flex items-center justify-center text-2xl ${
              isDark ? "bg-juice-orange/20" : "bg-orange-100"
            }`}
          >
            +
          </div>
          <div>
            <h3
              className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
            >
              Create New Project
            </h3>
            <p
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              Launch on {selectedChains.length} chain
              {selectedChains.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Chain Selection */}
        <div className={`p-3 mb-4 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
          <div
            className={`text-xs font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-600"}`}
          >
            Deploy on chains:
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_CHAIN_IDS.map((chainId) => {
              const chain = CHAINS[chainId];
              const isSelected = selectedChains.includes(chainId);
              return (
                <button
                  key={chainId}
                  onClick={() => toggleChain(chainId)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? isDark
                        ? "bg-juice-orange/30 text-juice-orange border border-juice-orange/50"
                        : "bg-orange-100 text-orange-700 border border-orange-300"
                      : isDark
                        ? "bg-white/5 text-gray-400 border border-white/10"
                        : "bg-gray-100 text-gray-500 border border-gray-200"
                  }`}
                >
                  <ChainLogo chainId={chainId} size={12} />
                  {chain?.shortName || chainId}
                </button>
              );
            })}
          </div>
        </div>

        {/* Synchronized Start Time */}
        {selectedChains.length > 1 && (
          <div
            className={`p-3 mb-4 ${isDark ? "bg-juice-orange/10" : "bg-orange-50"}`}
          >
            <div
              className={`text-xs font-medium ${isDark ? "text-juice-orange" : "text-orange-700"}`}
            >
              Synchronized Start Time
            </div>
            <div
              className={`text-sm font-mono ${isDark ? "text-white" : "text-gray-900"}`}
            >
              {startDate.toLocaleString()}
            </div>
            <div
              className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              All chains activate at the same time
            </div>
          </div>
        )}

        {/* Project Metadata */}
        <div className={`p-3 mb-3 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
          <div
            className={`text-xs font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-600"}`}
          >
            Project Info
          </div>

          <div className="space-y-3">
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Project Name *
              </label>
              <input
                type="text"
                value={formState.name}
                onChange={(e) => updateFormState("name", e.target.value)}
                placeholder="My Project"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>

            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Description
              </label>
              <textarea
                value={formState.description}
                onChange={(e) => updateFormState("description", e.target.value)}
                placeholder="What is this project about?"
                rows={2}
                className={`w-full px-3 py-2 text-sm outline-none resize-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>

            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Logo URL (optional)
              </label>
              <input
                type="text"
                value={formState.logoUrl}
                onChange={(e) => updateFormState("logoUrl", e.target.value)}
                placeholder="https://... or ipfs://..."
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>

            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Payment notice (optional)
              </label>
              <textarea
                value={formState.payDisclosure}
                onChange={(e) =>
                  updateFormState("payDisclosure", e.target.value)
                }
                placeholder="Shown to payers before they pay."
                rows={2}
                className={`w-full px-3 py-2 text-sm outline-none resize-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>
          </div>
        </div>

        {/* Token Settings */}
        <div className={`p-3 mb-3 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
          <div
            className={`text-xs font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-600"}`}
          >
            Token Settings
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Issuance Rate
              </label>
              <input
                type="number"
                min="0"
                value={formState.weight}
                onChange={(e) => updateFormState("weight", e.target.value)}
                placeholder="1000000"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
              <span
                className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                Tokens per ETH
              </span>
            </div>

            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Reserved Rate (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formState.reservedPercent}
                onChange={(e) =>
                  updateFormState("reservedPercent", e.target.value)
                }
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Cash-out curve rate (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formState.cashOutTaxRate}
                onChange={(e) =>
                  updateFormState("cashOutTaxRate", e.target.value)
                }
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
              <span
                className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                0 = proportional baseline; 100 = disabled
              </span>
            </div>

            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                Cycle Duration (days)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={formState.duration}
                onChange={(e) => updateFormState("duration", e.target.value)}
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                    : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
              <span
                className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                0 = no cycles
              </span>
            </div>
          </div>
        </div>

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`w-full py-2 text-xs font-medium mb-3 transition-colors ${
            isDark
              ? "text-gray-400 hover:text-white"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          {showAdvanced ? "- Hide" : "+ Show"} Advanced Settings
        </button>

        {/* Advanced Settings */}
        {showAdvanced && (
          <>
            {/* Fund Access */}
            <div className={`p-3 mb-3 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
              <div
                className={`text-xs font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                Fund Access
              </div>

              {/* Payout Limit */}
              <div className="mb-3">
                <label
                  className={`block text-xs mb-1.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  Payout Limit
                </label>
                <div className="flex gap-2 mb-2">
                  {(["none", "limited", "unlimited"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => updateFormState("payoutLimitType", type)}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                        formState.payoutLimitType === type
                          ? isDark
                            ? "bg-juice-orange/30 text-juice-orange"
                            : "bg-orange-100 text-orange-700"
                          : isDark
                            ? "bg-white/5 text-gray-400"
                            : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {type === "none"
                        ? "None"
                        : type === "limited"
                          ? "Limited"
                          : "Unlimited"}
                    </button>
                  ))}
                </div>
                {formState.payoutLimitType === "limited" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formState.payoutLimit}
                      onChange={(e) =>
                        updateFormState("payoutLimit", e.target.value)
                      }
                      placeholder="0"
                      className={`flex-1 px-3 py-2 text-sm outline-none ${
                        isDark
                          ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                          : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                      }`}
                    />
                    <span
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      ETH
                    </span>
                  </div>
                )}
              </div>

              {/* Surplus Allowance */}
              <div>
                <label
                  className={`block text-xs mb-1.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  Surplus Allowance
                </label>
                <div className="flex gap-2 mb-2">
                  {(["none", "limited", "unlimited"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() =>
                        updateFormState("surplusAllowanceType", type)
                      }
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                        formState.surplusAllowanceType === type
                          ? isDark
                            ? "bg-juice-orange/30 text-juice-orange"
                            : "bg-orange-100 text-orange-700"
                          : isDark
                            ? "bg-white/5 text-gray-400"
                            : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {type === "none"
                        ? "None"
                        : type === "limited"
                          ? "Limited"
                          : "Unlimited"}
                    </button>
                  ))}
                </div>
                {formState.surplusAllowanceType === "limited" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formState.surplusAllowance}
                      onChange={(e) =>
                        updateFormState("surplusAllowance", e.target.value)
                      }
                      placeholder="0"
                      className={`flex-1 px-3 py-2 text-sm outline-none ${
                        isDark
                          ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                          : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
                      }`}
                    />
                    <span
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      ETH
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Permissions */}
            <div className={`p-3 mb-3 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
              <div
                className={`text-xs font-medium mb-3 ${isDark ? "text-gray-300" : "text-gray-600"}`}
              >
                Permissions
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.pausePay}
                    onChange={(e) =>
                      updateFormState("pausePay", e.target.checked)
                    }
                    className="w-4 h-4"
                  />
                  <span
                    className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    Start with payments paused
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.allowOwnerMinting}
                    onChange={(e) =>
                      updateFormState("allowOwnerMinting", e.target.checked)
                    }
                    className="w-4 h-4"
                  />
                  <span
                    className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    Allow owner minting
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.ownerMustSendPayouts}
                    onChange={(e) =>
                      updateFormState("ownerMustSendPayouts", e.target.checked)
                    }
                    className="w-4 h-4"
                  />
                  <span
                    className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    Only project owner can send payouts
                  </span>
                </label>
              </div>
            </div>
          </>
        )}

        {/* Memo */}
        <div className={`p-3 mb-3 ${isDark ? "bg-white/5" : "bg-gray-50"}`}>
          <label
            className={`block text-xs mb-1.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Creation Memo (optional)
          </label>
          <input
            type="text"
            value={formState.memo}
            onChange={(e) => updateFormState("memo", e.target.value)}
            placeholder="Launching my project..."
            className={`w-full px-3 py-2 text-sm outline-none ${
              isDark
                ? "bg-juice-dark border border-white/10 text-white placeholder-gray-500"
                : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
            }`}
          />
        </div>

        {/* Gas Sponsorship Notice */}
        <div
          className={`p-3 mb-4 ${isDark ? "bg-green-500/10" : "bg-green-50"}`}
        >
          <div
            className={`text-xs font-medium ${isDark ? "text-green-400" : "text-green-700"}`}
          >
            Gas Sponsored
          </div>
          <div
            className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Gas is sponsored. The exact protocol creation fee is shown before
            deployment.
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreate}
          disabled={!isValid || preparingMetadata}
          className={`w-full py-3 text-sm font-bold transition-colors ${
            isValid && !preparingMetadata
              ? "bg-juice-orange hover:bg-juice-orange/90 text-black"
              : "bg-gray-500/50 text-gray-400 cursor-not-allowed"
          }`}
        >
          {preparingMetadata
            ? "Preparing metadata..."
            : !isManagedMode && !isConnected
              ? "Connect wallet to create"
              : `Create Project${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ""}`}
        </button>
        {preparationError && (
          <p
            className={`mt-2 text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
          >
            {preparationError}
          </p>
        )}

        {/* Info */}
        <p
          className={`mt-3 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          Your project will be created with the same configuration on all
          selected chains.
          {selectedChains.length > 1 &&
            " Cross-chain bridges are deployed atomically with the projects."}
        </p>
      </div>

      {/* Launch Modal */}
      <LaunchProjectModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectName={formState.name}
        owner={ownerAddress}
        projectUri={preparedProjectUri}
        chainIds={selectedChains}
        rulesetConfig={rulesetConfig}
        terminalConfigurations={terminalConfigurations}
        synchronizedStartTime={synchronizedStartTime}
        memo={formState.memo}
      />
    </div>
  );
}
