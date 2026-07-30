import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ALLOWED_ADVISORY = "https://github.com/advisories/GHSA-qwww-vcr4-c8h2";
const ALLOWED_PACKAGES = new Set(["react-router", "react-router-dom"]);
const ROUTER_VERSION = "7.18.2";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (packageJson.dependencies?.["react-router-dom"] !== ROUTER_VERSION) {
  throw new Error(`react-router-dom must remain pinned to ${ROUTER_VERSION}.`);
}
if (
  packageJson.dependencies?.["@vitejs/plugin-rsc"] ||
  packageJson.devDependencies?.["@vitejs/plugin-rsc"]
) {
  throw new Error(
    "The scoped React Router advisory exception is invalid when the RSC plugin is installed.",
  );
}

const sourceFiles = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) sourceFiles.push(path);
  }
};
visit("src");

for (const path of sourceFiles) {
  const source = readFileSync(path, "utf8");
  if (/unstable_\w*RSC|@vitejs\/plugin-rsc|react-server/.test(source)) {
    throw new Error(
      `${path} introduces an RSC code path. Remove the React Router advisory exception before releasing.`,
    );
  }
}

const appSource = readFileSync("src/App.tsx", "utf8");
if (
  !appSource.includes("BrowserRouter") ||
  !appSource.includes("from 'react-router-dom'")
) {
  throw new Error(
    "Juicy must remain in React Router declarative BrowserRouter mode while the RSC-only advisory exception exists.",
  );
}

if (process.argv.includes("--source-only")) {
  console.log("React Router version and non-RSC usage invariants verified.");
  process.exit(0);
}

const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  env: process.env,
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(
    result.stderr || result.stdout || "npm audit returned no JSON.\n",
  );
  process.exit(1);
}

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
if (vulnerabilities.length === 0) {
  console.log("Production dependency audit passed.");
  process.exit(0);
}

const unexpected = vulnerabilities.filter(([name, vulnerability]) => {
  if (!ALLOWED_PACKAGES.has(name)) return true;

  if (name === "react-router-dom") {
    return (
      vulnerability.via.length !== 1 || vulnerability.via[0] !== "react-router"
    );
  }

  return (
    vulnerability.via.length !== 1 ||
    typeof vulnerability.via[0] !== "object" ||
    vulnerability.via[0].url !== ALLOWED_ADVISORY
  );
});

if (unexpected.length > 0) {
  console.error("Unexpected production vulnerabilities:");
  for (const [name, vulnerability] of unexpected) {
    console.error(`- ${name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}

console.warn(
  "Production audit has one scoped exception: React Router GHSA-qwww-vcr4-c8h2 only affects RSC mode; this Vite SPA does not use React Server Components. Remove this exception when upstream publishes a non-regressive fix.",
);
