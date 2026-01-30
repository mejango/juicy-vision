import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';

// ============================================================================
// Types
// ============================================================================

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AnalysisTool = 'semgrep' | 'slither' | 'custom';

export interface SecurityFinding {
  id: string;
  tool: AnalysisTool;
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  file: string;
  line: number;
  endLine?: number;
  column?: number;
  code?: string;
  fix?: string;
  references?: string[];
}

export interface AnalysisSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface SecurityAnalysisResult {
  id: string;
  projectId: string;
  tool: AnalysisTool;
  findings: SecurityFinding[];
  summary: AnalysisSummary;
  createdAt: Date;
}

interface DbSecurityAnalysis {
  id: string;
  project_id: string;
  tool: AnalysisTool;
  findings: SecurityFinding[];
  summary: AnalysisSummary;
  created_at: Date;
}

// ============================================================================
// Juicebox-Specific Security Rules
// ============================================================================

const JUICEBOX_RULES: Array<{
  id: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  message: string;
  fix?: string;
}> = [
  {
    id: 'jb-terminal-validation',
    severity: 'critical',
    title: 'Missing Terminal Validation',
    pattern: /function\s+(afterPayRecordedWith|beforeCashOutRecordedWith|beforePayRecordedWith)\s*\([^)]*\)\s*[^{]*\{(?:(?!require|revert|if\s*\(\s*msg\.sender\s*==)[\s\S])*?}/g,
    message: 'Hook function does not validate that msg.sender is a trusted terminal. This could allow unauthorized calls.',
    fix: 'Add validation: require(directory.isTerminalOf(projectId, IJBTerminal(msg.sender)), "Unauthorized terminal");',
  },
  {
    id: 'jb-reentrancy-hook',
    severity: 'high',
    title: 'Potential Reentrancy in Hook',
    pattern: /(\.(call|transfer|send)\s*\{|\.call\s*\()/g,
    message: 'External call in hook function may be vulnerable to reentrancy. Juicebox hooks are called during state transitions.',
    fix: 'Use ReentrancyGuard or follow checks-effects-interactions pattern. Consider making state changes before external calls.',
  },
  {
    id: 'jb-unchecked-project-id',
    severity: 'high',
    title: 'Unchecked Project ID',
    pattern: /function\s+(afterPayRecordedWith|beforeCashOutRecordedWith)\s*\([^)]*JB(Pay|CashOut)HookPayload[^)]*\)\s*[^{]*\{(?:(?!projectId|_projectId)[\s\S])*?}/g,
    message: 'Hook does not check projectId from payload. This may allow hooks to be triggered for unintended projects.',
    fix: 'Validate projectId: require(payload.projectId == expectedProjectId, "Wrong project");',
  },
  {
    id: 'jb-missing-interface',
    severity: 'medium',
    title: 'Missing Hook Interface Implementation',
    pattern: /contract\s+\w+\s*(?:is\s+[^{]+)?{(?:(?!IJBPayHook|IJBCashOutHook|IJBSplitHook)[\s\S])*?}/g,
    message: 'Contract does not explicitly implement a Juicebox hook interface. This may cause compatibility issues.',
    fix: 'Implement the appropriate interface: IJBPayHook, IJBCashOutHook, or IJBSplitHook',
  },
  {
    id: 'jb-hardcoded-address',
    severity: 'medium',
    title: 'Hardcoded Address',
    pattern: /0x[a-fA-F0-9]{40}/g,
    message: 'Hardcoded address detected. Consider using constructor parameters or immutable variables for chain-agnostic deployment.',
    fix: 'Use constructor parameters: constructor(address _terminal) { terminal = _terminal; }',
  },
  {
    id: 'jb-missing-supportsInterface',
    severity: 'low',
    title: 'Missing supportsInterface',
    pattern: /contract\s+\w+\s*is\s+[^{]*IJB(Pay|CashOut|Split)Hook[^{]*{(?:(?!supportsInterface)[\s\S])*?}/g,
    message: 'Hook contract does not implement supportsInterface. Terminals may not recognize this as a valid hook.',
    fix: 'Implement ERC-165: function supportsInterface(bytes4 interfaceId) public view returns (bool)',
  },
  {
    id: 'jb-unsafe-math',
    severity: 'medium',
    title: 'Potential Integer Overflow/Underflow',
    pattern: /unchecked\s*{[^}]*(\+\+|--|\*|\+|-)[^}]*}/g,
    message: 'Unchecked arithmetic operation. Ensure this is intentional and safe.',
    fix: 'Remove unchecked block unless you are certain overflow/underflow is impossible.',
  },
];

// ============================================================================
// Common Solidity Security Patterns
// ============================================================================

const SOLIDITY_RULES: Array<{
  id: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  message: string;
  fix?: string;
}> = [
  {
    id: 'sol-tx-origin',
    severity: 'high',
    title: 'Use of tx.origin',
    pattern: /tx\.origin/g,
    message: 'tx.origin can be exploited in phishing attacks. Use msg.sender instead.',
    fix: 'Replace tx.origin with msg.sender for authentication.',
  },
  {
    id: 'sol-delegatecall',
    severity: 'critical',
    title: 'Unsafe delegatecall',
    pattern: /\.delegatecall\s*\(/g,
    message: 'delegatecall can be dangerous if the target is user-controlled.',
    fix: 'Ensure delegatecall target is a trusted, immutable contract.',
  },
  {
    id: 'sol-selfdestruct',
    severity: 'critical',
    title: 'Use of selfdestruct',
    pattern: /selfdestruct\s*\(|suicide\s*\(/g,
    message: 'selfdestruct can permanently destroy the contract. Ensure proper access control.',
    fix: 'Consider removing selfdestruct or adding strict access controls.',
  },
  {
    id: 'sol-assembly',
    severity: 'info',
    title: 'Use of inline assembly',
    pattern: /assembly\s*{/g,
    message: 'Inline assembly bypasses Solidity safety checks. Review carefully.',
  },
  {
    id: 'sol-timestamp',
    severity: 'low',
    title: 'Block timestamp dependence',
    pattern: /block\.timestamp|now/g,
    message: 'Block timestamps can be manipulated by miners within a small range.',
  },
  {
    id: 'sol-arbitrary-send',
    severity: 'high',
    title: 'Arbitrary ETH transfer',
    pattern: /\.transfer\s*\([^)]*\)|\.send\s*\([^)]*\)|\.call\{value:\s*[^}]+\}\s*\(""\)/g,
    message: 'Sending ETH to an arbitrary address. Ensure recipient is validated.',
  },
  {
    id: 'sol-storage-pointer',
    severity: 'medium',
    title: 'Uninitialized storage pointer',
    pattern: /\w+\s+storage\s+\w+\s*;/g,
    message: 'Uninitialized storage pointer may point to unexpected storage slots.',
    fix: 'Always initialize storage pointers to a specific storage variable.',
  },
];

// ============================================================================
// Analysis Functions
// ============================================================================

function transformAnalysis(db: DbSecurityAnalysis): SecurityAnalysisResult {
  return {
    id: db.id,
    projectId: db.project_id,
    tool: db.tool,
    findings: db.findings,
    summary: db.summary,
    createdAt: db.created_at,
  };
}

export async function analyzeProject(
  projectId: string,
  files: Array<{ path: string; content: string }>
): Promise<SecurityAnalysisResult> {
  const findings: SecurityFinding[] = [];
  let findingId = 0;

  // Filter to only Solidity files
  const solidityFiles = files.filter((f) => f.path.endsWith('.sol'));

  for (const file of solidityFiles) {
    // Skip test files and libraries
    if (file.path.includes('/test/') || file.path.includes('/lib/')) {
      continue;
    }

    // Run Juicebox-specific rules
    for (const rule of JUICEBOX_RULES) {
      const matches = file.content.matchAll(rule.pattern);
      for (const match of matches) {
        const lineNumber = getLineNumber(file.content, match.index || 0);
        findings.push({
          id: `finding-${++findingId}`,
          tool: 'custom',
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          message: rule.message,
          file: file.path,
          line: lineNumber,
          code: match[0].substring(0, 100),
          fix: rule.fix,
        });
      }
    }

    // Run general Solidity rules
    for (const rule of SOLIDITY_RULES) {
      const matches = file.content.matchAll(rule.pattern);
      for (const match of matches) {
        const lineNumber = getLineNumber(file.content, match.index || 0);
        findings.push({
          id: `finding-${++findingId}`,
          tool: 'custom',
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          message: rule.message,
          file: file.path,
          line: lineNumber,
          code: match[0].substring(0, 100),
          fix: rule.fix,
        });
      }
    }
  }

  // Calculate summary
  const summary = calculateSummary(findings);

  // Store analysis result
  const result = await queryOne<DbSecurityAnalysis>(
    `INSERT INTO security_analyses (project_id, tool, findings, summary)
     VALUES ($1, 'custom', $2, $3)
     RETURNING *`,
    [projectId, JSON.stringify(findings), JSON.stringify(summary)]
  );

  if (!result) {
    throw new Error('Failed to store security analysis');
  }

  return transformAnalysis(result);
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function calculateSummary(findings: SecurityFinding[]): AnalysisSummary {
  const summary: AnalysisSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    summary[finding.severity]++;
  }

  return summary;
}

// ============================================================================
// Semgrep Integration (optional external tool)
// ============================================================================

export async function runSemgrep(
  projectId: string,
  files: Array<{ path: string; content: string }>
): Promise<SecurityAnalysisResult | null> {
  const config = getConfig();

  // Check if Semgrep is available
  if (!config.semgrepEnabled) {
    return null;
  }

  try {
    // Create temporary directory with files
    const tmpDir = await Deno.makeTempDir({ prefix: 'semgrep_' });

    try {
      // Write files
      for (const file of files) {
        const filePath = `${tmpDir}/${file.path}`;
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        await Deno.mkdir(dirPath, { recursive: true });
        await Deno.writeTextFile(filePath, file.content);
      }

      // Run Semgrep with Solidity rules
      const process = new Deno.Command('semgrep', {
        args: [
          '--config', 'p/solidity',
          '--config', 'p/smart-contracts',
          '--json',
          tmpDir,
        ],
        stdout: 'piped',
        stderr: 'piped',
      });

      const output = await process.output();
      const stdout = new TextDecoder().decode(output.stdout);

      // Parse Semgrep output
      const semgrepResult = JSON.parse(stdout);
      const findings: SecurityFinding[] = semgrepResult.results?.map(
        (r: {
          check_id: string;
          extra: { severity: string; message: string };
          path: string;
          start: { line: number; col: number };
          end: { line: number };
          extra_lines?: string;
        }, i: number) => ({
          id: `semgrep-${i}`,
          tool: 'semgrep' as AnalysisTool,
          ruleId: r.check_id,
          severity: mapSemgrepSeverity(r.extra.severity),
          title: r.check_id.split('.').pop() || r.check_id,
          message: r.extra.message,
          file: r.path.replace(tmpDir + '/', ''),
          line: r.start.line,
          endLine: r.end.line,
          column: r.start.col,
          code: r.extra_lines,
        })
      ) || [];

      const summary = calculateSummary(findings);

      // Store result
      const result = await queryOne<DbSecurityAnalysis>(
        `INSERT INTO security_analyses (project_id, tool, findings, summary)
         VALUES ($1, 'semgrep', $2, $3)
         RETURNING *`,
        [projectId, JSON.stringify(findings), JSON.stringify(summary)]
      );

      if (!result) {
        throw new Error('Failed to store Semgrep analysis');
      }

      return transformAnalysis(result);
    } finally {
      // Cleanup
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  } catch (error) {
    console.error('[Security] Semgrep analysis failed:', error);
    return null;
  }
}

function mapSemgrepSeverity(severity: string): Severity {
  switch (severity.toUpperCase()) {
    case 'ERROR':
      return 'critical';
    case 'WARNING':
      return 'high';
    case 'INFO':
      return 'medium';
    default:
      return 'low';
  }
}

// ============================================================================
// Analysis Retrieval
// ============================================================================

export async function getLatestAnalysis(
  projectId: string
): Promise<SecurityAnalysisResult | null> {
  const result = await queryOne<DbSecurityAnalysis>(
    `SELECT * FROM security_analyses
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId]
  );

  return result ? transformAnalysis(result) : null;
}

export async function getAnalysisHistory(
  projectId: string,
  limit: number = 10
): Promise<SecurityAnalysisResult[]> {
  const results = await query<DbSecurityAnalysis>(
    `SELECT * FROM security_analyses
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, limit]
  );

  return results.map(transformAnalysis);
}

// ============================================================================
// Pre-deployment Security Check
// ============================================================================

export interface DeploymentSecurityCheck {
  canDeploy: boolean;
  criticalFindings: SecurityFinding[];
  highFindings: SecurityFinding[];
  warnings: string[];
}

export async function checkDeploymentSecurity(
  projectId: string,
  files: Array<{ path: string; content: string }>
): Promise<DeploymentSecurityCheck> {
  // Run fresh analysis
  const analysis = await analyzeProject(projectId, files);

  // Also run Semgrep if available
  const semgrepAnalysis = await runSemgrep(projectId, files);

  // Combine findings
  const allFindings = [
    ...analysis.findings,
    ...(semgrepAnalysis?.findings || []),
  ];

  const criticalFindings = allFindings.filter((f) => f.severity === 'critical');
  const highFindings = allFindings.filter((f) => f.severity === 'high');
  const warnings: string[] = [];

  // Check for common issues
  const hasTests = files.some((f) => f.path.includes('/test/') && f.path.endsWith('.t.sol'));
  if (!hasTests) {
    warnings.push('No test files found. Consider adding tests before deployment.');
  }

  const hasLicense = files.some(
    (f) => f.content.includes('SPDX-License-Identifier')
  );
  if (!hasLicense) {
    warnings.push('SPDX license identifier not found in some files.');
  }

  // Critical findings block deployment
  const canDeploy = criticalFindings.length === 0;

  return {
    canDeploy,
    criticalFindings,
    highFindings,
    warnings,
  };
}
