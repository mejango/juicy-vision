import { spawnSync } from "node:child_process";

const ALLOWED_ADVISORY = "https://github.com/advisories/GHSA-qwww-vcr4-c8h2";
const ALLOWED_PACKAGES = new Set(["react-router", "react-router-dom"]);

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
