import { useEffect, useState } from "react";
import { fetchProject, type Project } from "../../services/bendystraw";
import { resolveEnsName, truncateAddress } from "../../utils/ens";
import { useThemeStore } from "../../stores";
import { CHAINS, ALL_CHAIN_IDS } from "../../constants";
import { resolveProjectChains } from "../../utils/projectChains";
import { ChainMappingWarning } from "./ChainMappingWarning";
import { IpfsImage } from "../ui/IpfsMedia";
import ChainLogo from "../ui/ChainLogo";

interface ProjectChainPickerProps {
  projectId: string;
}

interface ProjectOption {
  chainIds: number[]; // Can be multiple if linked via suckers
  projectIds: number[]; // Corresponding project IDs per chain
  name: string;
  logoUri?: string;
  owner: string;
  primaryChainId: number; // The chain to use when selected
}

// Use environment-aware chain info from constants

// The chains a project option spans, each name carrying its brand mark. Picking
// the wrong option moves money to the wrong chain, and testnet names differ by a
// single word, so the mark rides along with every name.
function ChainNameList({ chainIds }: { chainIds: number[] }) {
  const named = chainIds.filter((id) => CHAINS[id]?.name);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {named.map((id, index) => (
        <span key={id} className="inline-flex items-center gap-1.5">
          {index > 0 && <span>+</span>}
          <ChainLogo chainId={id} size={14} />
          {CHAINS[id].name}
        </span>
      ))}
    </span>
  );
}

export default function ProjectChainPicker({
  projectId,
}: ProjectChainPickerProps) {
  const [options, setOptions] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ensNames, setEnsNames] = useState<Record<string, string>>({});
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true);
  const { theme } = useThemeStore();
  const isDark = theme === "dark";

  // Resolve ENS names for all owners
  useEffect(() => {
    if (options.length === 0) return;

    const owners = [...new Set(options.map((o) => o.owner.toLowerCase()))];

    owners.forEach(async (owner) => {
      const ensName = await resolveEnsName(owner);
      if (ensName) {
        setEnsNames((prev) => ({ ...prev, [owner]: ensName }));
      }
    });
  }, [options]);

  // Helper to get display name for owner
  const getOwnerDisplay = (owner: string) => {
    const ensName = ensNames[owner.toLowerCase()];
    return ensName || truncateAddress(owner);
  };

  useEffect(() => {
    async function loadProjects() {
      setLoading(true);
      setError(null);

      try {
        // Step 1: Fetch project data from all chains in parallel
        const projectPromises = ALL_CHAIN_IDS.map(async (chainId) => {
          try {
            const project = await fetchProject(projectId, chainId);
            return { chainId, project };
          } catch {
            return { chainId, project: null };
          }
        });

        const results = await Promise.all(projectPromises);
        const foundProjects = results.filter((r) => r.project !== null) as {
          chainId: number;
          project: Project;
        }[];

        if (foundProjects.length === 0) {
          setError(`Project ${projectId} not found on any chain`);
          setLoading(false);
          return;
        }

        // Step 2: Keep Bendystraw's actual project ID for every mapped chain.
        // A group fingerprint deduplicates the same sucker group found from
        // multiple seeds, while an unavailable index falls back to that seed.
        const resolved = await Promise.all(
          foundProjects.map(async ({ chainId, project }) => ({
            chainId,
            project,
            resolution: await resolveProjectChains(
              String(project.projectId),
              chainId,
            ),
          })),
        );
        setChainMappingAvailable(
          resolved.every((item) => item.resolution.mappingAvailable),
        );

        const grouped: ProjectOption[] = [];
        const fingerprints = new Set<string>();
        for (const { chainId, project, resolution } of resolved) {
          const mappings = [...resolution.chains].sort(
            (a, b) => a.chainId - b.chainId || a.projectId - b.projectId,
          );
          const fingerprint = mappings
            .map((mapping) => `${mapping.chainId}:${mapping.projectId}`)
            .join("|");
          if (fingerprints.has(fingerprint)) continue;
          fingerprints.add(fingerprint);
          grouped.push({
            chainIds: mappings.map((mapping) => mapping.chainId),
            projectIds: mappings.map((mapping) => mapping.projectId),
            name: project.name,
            logoUri: project.logoUri,
            owner: project.owner,
            primaryChainId: chainId,
          });
        }

        setOptions(grouped);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load projects",
        );
      } finally {
        setLoading(false);
      }
    }

    loadProjects();
  }, [projectId]);

  const handleSubmit = () => {
    const selected = options[selectedIndex];
    if (!selected) return;

    // Send message with the selection
    const chainNames = selected.chainIds
      .map((id) => CHAINS[id]?.name)
      .filter(Boolean)
      .join(" + ");
    const primaryIndex = selected.chainIds.indexOf(selected.primaryChainId);
    const selectedProjectId = selected.projectIds[primaryIndex];
    const message = `Show me ${selected.name} on ${chainNames} (projectId: ${selectedProjectId}, chainId: ${selected.primaryChainId})`;

    window.dispatchEvent(
      new CustomEvent("juice:send-message", { detail: { message } }),
    );
  };

  if (loading) {
    return (
      <div
        className={`inline-block border p-4 ${
          isDark
            ? "bg-juice-dark-lighter border-white/10"
            : "bg-white border-gray-200"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <span
              className="w-2 h-2 bg-juice-orange rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-2 h-2 bg-juice-orange rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="w-2 h-2 bg-juice-orange rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
          <span
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Looking up project {projectId} on all chains...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`inline-block border p-4 ${
          isDark
            ? "bg-juice-dark-lighter border-red-500/30"
            : "bg-white border-red-200"
        }`}
      >
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (options.length === 1) {
    // Only one option - auto-select it
    const option = options[0];

    return (
      <div
        className={`inline-block border overflow-hidden ${
          isDark
            ? "bg-juice-dark-lighter border-white/10"
            : "bg-white border-gray-200"
        }`}
      >
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        <div className="p-3">
          <div className="flex items-center gap-3">
            {option.logoUri ? (
              <IpfsImage
                uri={option.logoUri}
                alt={option.name}
                className="w-10 h-10 object-cover"
                fallback={<div className="w-10 h-10 bg-juice-orange/20" />}
              />
            ) : (
              <div className="w-10 h-10 bg-juice-orange/20 flex items-center justify-center">
                <span className="text-juice-orange font-bold">
                  {option.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div
                className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}
              >
                {option.name}
              </div>
              <div
                className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                <ChainNameList chainIds={option.chainIds} />
              </div>
              <div
                className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                Project owner: {getOwnerDisplay(option.owner)}
              </div>
            </div>
          </div>
        </div>
        <div
          className={`px-3 py-2 border-t flex justify-end ${
            isDark ? "border-white/10 bg-white/5" : "border-gray-100 bg-gray-50"
          }`}
        >
          <button
            onClick={handleSubmit}
            className="px-3 py-1 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
          >
            Pay project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inline-block border overflow-hidden ${
        isDark
          ? "bg-juice-dark-lighter border-white/10"
          : "bg-white border-gray-200"
      }`}
    >
      {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
      <div className="p-3">
        <div className="space-y-2">
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;

            return (
              <button
                key={option.primaryChainId}
                onClick={() => setSelectedIndex(index)}
                className={`w-full flex items-center gap-3 p-2 border-l-2 transition-all text-left ${
                  isSelected
                    ? "border-l-green-500"
                    : isDark
                      ? "border-l-transparent hover:border-l-white/30"
                      : "border-l-transparent hover:border-l-gray-400"
                }`}
              >
                {/* Radio indicator */}
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected
                      ? "border-green-500"
                      : isDark
                        ? "border-gray-500"
                        : "border-gray-400"
                  }`}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  )}
                </div>

                {/* Logo */}
                {option.logoUri ? (
                  <IpfsImage
                    uri={option.logoUri}
                    alt={option.name}
                    className="w-10 h-10 object-cover shrink-0"
                    fallback={
                      <div className="w-10 h-10 bg-juice-orange/20 shrink-0" />
                    }
                  />
                ) : (
                  <div className="w-10 h-10 bg-juice-orange/20 flex items-center justify-center shrink-0">
                    <span className="text-juice-orange font-bold text-sm">
                      {option.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}

                {/* Name, chains, owner, and balance */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    {option.name}
                  </div>
                  <div
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    <ChainNameList chainIds={option.chainIds} />
                  </div>
                  <div
                    className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                  >
                    Project owner: {getOwnerDisplay(option.owner)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit row */}
      <div
        className={`px-3 py-2 border-t flex items-center justify-between ${
          isDark ? "border-white/10 bg-white/5" : "border-gray-100 bg-gray-50"
        }`}
      >
        <div
          className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          {options[selectedIndex]?.name}
        </div>
        <button
          onClick={handleSubmit}
          className="px-3 py-1 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
        >
          Pay project
        </button>
      </div>
    </div>
  );
}
