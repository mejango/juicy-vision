import { query, queryOne, execute } from '../db/index.ts';
import { createHash } from 'node:crypto';
import { getConfig } from '../utils/config.ts';
import { computeFilesHash } from './hookProjects.ts';

// ============================================================================
// Types
// ============================================================================

export type ForgeJobType = 'compile' | 'test' | 'script';
export type ForgeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';

interface DbForgeJob {
  id: string;
  project_id: string | null;
  user_address: string;
  job_type: ForgeJobType;
  input_hash: string;
  input_data: ForgeJobInput;
  status: ForgeJobStatus;
  result_data: ForgeJobResult | null;
  output_log: string | null;
  docker_container_id: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date;
}

export interface ForgeJobInput {
  files: Array<{ path: string; content: string }>;
  forkConfig?: {
    chainId: number;
    blockNumber?: number;
  };
  testMatch?: string; // e.g., "test_*" or specific test name
  scriptPath?: string; // For script jobs
  constructorArgs?: unknown[]; // For deployment scripts
}

export interface ForgeJobResult {
  success: boolean;
  errors?: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning';
  }>;
  warnings?: string[];
  artifacts?: Array<{
    contractName: string;
    bytecode: string;
    abi: unknown[];
  }>;
  testResults?: Array<{
    name: string;
    passed: boolean;
    gasUsed?: number;
    duration?: number;
    logs?: string[];
    error?: string;
  }>;
  gasReport?: Record<string, Record<string, number>>;
}

export interface ForgeJob {
  id: string;
  projectId: string | null;
  userAddress: string;
  jobType: ForgeJobType;
  inputHash: string;
  inputData: ForgeJobInput;
  status: ForgeJobStatus;
  resultData: ForgeJobResult | null;
  outputLog: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

const COMPILE_TIMEOUT_MS = 30_000; // 30 seconds
const TEST_TIMEOUT_MS = 120_000; // 2 minutes
const JOB_EXPIRY_MINUTES = 30;
const MAX_FILE_SIZE = 500 * 1024; // 500KB per file
const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB total
const MAX_FILES = 50;

// RPC methods allowed for fork testing
const ALLOWED_RPC_METHODS = new Set([
  'eth_call',
  'eth_getCode',
  'eth_getBalance',
  'eth_getStorageAt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_chainId',
  'eth_blockNumber',
  'net_version',
]);

// Supported chains for fork testing
const SUPPORTED_CHAINS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  10: 'https://optimism.llamarpc.com',
  8453: 'https://base.llamarpc.com',
  42161: 'https://arbitrum.llamarpc.com',
  11155111: 'https://sepolia.llamarpc.com',
  84532: 'https://base-sepolia.llamarpc.com',
};

// ============================================================================
// Transformations
// ============================================================================

function transformJob(db: DbForgeJob): ForgeJob {
  return {
    id: db.id,
    projectId: db.project_id,
    userAddress: db.user_address,
    jobType: db.job_type,
    inputHash: db.input_hash,
    inputData: db.input_data,
    status: db.status,
    resultData: db.result_data,
    outputLog: db.output_log,
    createdAt: db.created_at,
    startedAt: db.started_at,
    completedAt: db.completed_at,
    expiresAt: db.expires_at,
  };
}

// ============================================================================
// Input Validation
// ============================================================================

export function validateJobInput(input: ForgeJobInput): { valid: boolean; error?: string } {
  // Check file count
  if (input.files.length > MAX_FILES) {
    return { valid: false, error: `Too many files: ${input.files.length} > ${MAX_FILES}` };
  }

  // Check individual and total file sizes
  let totalSize = 0;
  for (const file of input.files) {
    const fileSize = new TextEncoder().encode(file.content).length;
    if (fileSize > MAX_FILE_SIZE) {
      return { valid: false, error: `File ${file.path} exceeds ${MAX_FILE_SIZE} bytes` };
    }
    totalSize += fileSize;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    return { valid: false, error: `Total size ${totalSize} exceeds ${MAX_TOTAL_SIZE} bytes` };
  }

  // Validate file paths (no directory traversal)
  for (const file of input.files) {
    if (file.path.includes('..') || file.path.startsWith('/')) {
      return { valid: false, error: `Invalid file path: ${file.path}` };
    }
  }

  // Validate fork config
  if (input.forkConfig) {
    if (!SUPPORTED_CHAINS[input.forkConfig.chainId]) {
      return { valid: false, error: `Unsupported chain ID: ${input.forkConfig.chainId}` };
    }
  }

  return { valid: true };
}

// ============================================================================
// Job Management
// ============================================================================

export async function submitJob(
  userAddress: string,
  jobType: ForgeJobType,
  input: ForgeJobInput,
  projectId?: string
): Promise<ForgeJob> {
  // Validate input
  const validation = validateJobInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Compute input hash for caching
  const inputHash = computeFilesHash(input.files);

  // Check for existing completed job with same hash (cache hit)
  const existingJob = await queryOne<DbForgeJob>(
    `SELECT * FROM forge_jobs
     WHERE input_hash = $1
       AND job_type = $2
       AND status = 'completed'
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [inputHash, jobType]
  );

  if (existingJob) {
    console.log(`[Forge] Cache hit for job ${existingJob.id}`);
    return transformJob(existingJob);
  }

  // Create new job
  const job = await queryOne<DbForgeJob>(
    `INSERT INTO forge_jobs (
       project_id, user_address, job_type, input_hash, input_data, status
     ) VALUES ($1, $2, $3, $4, $5, 'queued')
     RETURNING *`,
    [projectId || null, userAddress, jobType, inputHash, JSON.stringify(input)]
  );

  if (!job) {
    throw new Error('Failed to create forge job');
  }

  // Start job execution asynchronously
  executeJob(job.id).catch((error) => {
    console.error(`[Forge] Job ${job.id} execution error:`, error);
  });

  return transformJob(job);
}

export async function getJob(jobId: string, userAddress?: string): Promise<ForgeJob | null> {
  const whereClause = userAddress
    ? 'WHERE id = $1 AND user_address = $2'
    : 'WHERE id = $1';
  const params = userAddress ? [jobId, userAddress] : [jobId];

  const job = await queryOne<DbForgeJob>(
    `SELECT * FROM forge_jobs ${whereClause}`,
    params
  );

  return job ? transformJob(job) : null;
}

export async function getJobOutput(jobId: string): Promise<string | null> {
  const result = await queryOne<{ output_log: string | null }>(
    `SELECT output_log FROM forge_jobs WHERE id = $1`,
    [jobId]
  );

  return result?.output_log || null;
}

async function updateJobStatus(
  jobId: string,
  status: ForgeJobStatus,
  resultData?: ForgeJobResult,
  containerId?: string
): Promise<void> {
  const updates: string[] = ['status = $1'];
  const values: unknown[] = [status];
  let paramIndex = 2;

  if (status === 'running') {
    updates.push(`started_at = NOW()`);
  }

  if (status === 'completed' || status === 'failed' || status === 'timeout') {
    updates.push(`completed_at = NOW()`);
  }

  if (resultData) {
    updates.push(`result_data = $${paramIndex++}`);
    values.push(JSON.stringify(resultData));
  }

  if (containerId) {
    updates.push(`docker_container_id = $${paramIndex++}`);
    values.push(containerId);
  }

  values.push(jobId);

  await execute(
    `UPDATE forge_jobs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}

async function appendJobOutput(jobId: string, output: string): Promise<void> {
  await execute(
    `UPDATE forge_jobs
     SET output_log = COALESCE(output_log, '') || $1
     WHERE id = $2`,
    [output, jobId]
  );
}

// ============================================================================
// Job Execution (Docker-based)
// ============================================================================

async function executeJob(jobId: string): Promise<void> {
  const job = await queryOne<DbForgeJob>(
    `SELECT * FROM forge_jobs WHERE id = $1`,
    [jobId]
  );

  if (!job) {
    console.error(`[Forge] Job ${jobId} not found`);
    return;
  }

  const config = getConfig();
  const timeout = job.job_type === 'compile' ? COMPILE_TIMEOUT_MS : TEST_TIMEOUT_MS;

  try {
    await updateJobStatus(jobId, 'running');

    // In development without Docker, simulate the execution
    if (config.env === 'development' && !config.forgeDockerEnabled) {
      await simulateForgeExecution(job);
      return;
    }

    // Run in Docker container
    const result = await runInDocker(job, timeout);
    await updateJobStatus(
      jobId,
      result.success ? 'completed' : 'failed',
      result
    );
  } catch (error) {
    console.error(`[Forge] Job ${jobId} failed:`, error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('timeout')) {
      await updateJobStatus(jobId, 'timeout', {
        success: false,
        errors: [{ file: '', line: 0, column: 0, message: 'Execution timed out', severity: 'error' }],
      });
    } else {
      await updateJobStatus(jobId, 'failed', {
        success: false,
        errors: [{ file: '', line: 0, column: 0, message: errorMessage, severity: 'error' }],
      });
    }
  }
}

async function runInDocker(job: DbForgeJob, timeout: number): Promise<ForgeJobResult> {
  const config = getConfig();
  const input = job.input_data;

  // Create temporary directory for project files
  const tmpDir = await Deno.makeTempDir({ prefix: 'forge_' });

  try {
    // Write project files
    for (const file of input.files) {
      const filePath = `${tmpDir}/${file.path}`;
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
      await Deno.mkdir(dirPath, { recursive: true });
      await Deno.writeTextFile(filePath, file.content);
    }

    // Write foundry.toml if not provided
    const hasFoundryConfig = input.files.some((f) => f.path === 'foundry.toml');
    if (!hasFoundryConfig) {
      await Deno.writeTextFile(`${tmpDir}/foundry.toml`, generateFoundryConfig(input));
    }

    // Build Docker command
    const dockerArgs = buildDockerCommand(job, tmpDir, input, timeout, config);

    // Execute Docker command
    const process = new Deno.Command('docker', {
      args: dockerArgs,
      stdout: 'piped',
      stderr: 'piped',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const output = await process.output();
      clearTimeout(timeoutId);

      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);
      const fullOutput = stdout + (stderr ? `\n${stderr}` : '');

      await appendJobOutput(job.id, fullOutput);

      return parseForgeOutput(job.job_type, fullOutput, output.success);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } finally {
    // Cleanup temporary directory
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      console.warn(`[Forge] Failed to cleanup ${tmpDir}`);
    }
  }
}

function buildDockerCommand(
  job: DbForgeJob,
  tmpDir: string,
  input: ForgeJobInput,
  timeout: number,
  config: ReturnType<typeof getConfig>
): string[] {
  const args = [
    'run',
    '--rm',
    '--network', 'none', // No network access by default
    '--memory', '2g',
    '--cpus', '2',
    '--pids-limit', '256',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
    '-v', `${tmpDir}:/app:ro`,
    '-w', '/app',
  ];

  // Enable network for fork tests - call RPCs directly
  // This is safe because the container has no private keys and can't sign transactions
  if (input.forkConfig) {
    const rpcUrl = SUPPORTED_CHAINS[input.forkConfig.chainId];
    if (rpcUrl) {
      args.splice(args.indexOf('--network'), 2); // Remove --network none
      args.push('--network', 'bridge');
      args.push('-e', `ETH_RPC_URL=${rpcUrl}`);
    }
  }

  args.push('ghcr.io/foundry-rs/foundry:latest');

  // Add forge command
  if (job.job_type === 'compile') {
    args.push('forge', 'build', '--json');
  } else if (job.job_type === 'test') {
    args.push('forge', 'test', '-vvv', '--json');
    if (input.testMatch) {
      args.push('--match-test', input.testMatch);
    }
    if (input.forkConfig) {
      const rpcUrl = SUPPORTED_CHAINS[input.forkConfig.chainId];
      if (rpcUrl) {
        args.push('--fork-url', rpcUrl);
        if (input.forkConfig.blockNumber) {
          args.push('--fork-block-number', input.forkConfig.blockNumber.toString());
        }
      }
    }
  } else if (job.job_type === 'script') {
    args.push('forge', 'script', input.scriptPath || 'script/Deploy.s.sol', '--json');
  }

  return args;
}

function generateFoundryConfig(input: ForgeJobInput): string {
  return `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.28"

# Optimizations
optimizer = true
optimizer_runs = 200

# Remappings for common dependencies
remappings = [
  "@openzeppelin/=lib/openzeppelin-contracts/",
  "@jb/=lib/juice-contracts-v5/",
  "forge-std/=lib/forge-std/src/"
]

[fuzz]
runs = 256

[invariant]
runs = 256
`;
}

function parseForgeOutput(
  jobType: ForgeJobType,
  output: string,
  success: boolean
): ForgeJobResult {
  const result: ForgeJobResult = { success };

  try {
    // Try to parse JSON output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (jobType === 'compile') {
        if (parsed.errors) {
          result.success = false;
          result.errors = parsed.errors.map((e: { sourceLocation?: { file: string; start: number; end: number }; message: string; severity: string }) => ({
            file: e.sourceLocation?.file || '',
            line: e.sourceLocation?.start || 0,
            column: 0,
            message: e.message,
            severity: e.severity === 'error' ? 'error' : 'warning',
          }));
        }

        if (parsed.contracts) {
          result.artifacts = Object.entries(parsed.contracts).flatMap(
            ([_file, contracts]) =>
              Object.entries(contracts as Record<string, { evm?: { bytecode?: { object: string } }; abi?: unknown[] }>).map(([name, data]) => ({
                contractName: name,
                bytecode: data.evm?.bytecode?.object || '',
                abi: data.abi || [],
              }))
          );
        }
      } else if (jobType === 'test') {
        if (parsed.testResults || parsed.tests) {
          const tests = parsed.testResults || parsed.tests;
          result.testResults = Object.entries(tests).flatMap(
            ([_suite, suiteTests]) =>
              Object.entries(suiteTests as Record<string, { status: string; gasUsed?: number; duration?: number; logs?: string[]; reason?: string }>).map(([name, test]) => ({
                name,
                passed: test.status === 'passed' || test.status === 'Success',
                gasUsed: test.gasUsed,
                duration: test.duration,
                logs: test.logs,
                error: test.reason,
              }))
          );
          result.success = result.testResults.every((t) => t.passed);
        }

        if (parsed.gasReport) {
          result.gasReport = parsed.gasReport;
        }
      }
    }
  } catch {
    // If JSON parsing fails, try to extract errors from plain text
    const errorMatches = output.matchAll(/Error[:\s]+(.+?)(?:\n|$)/gi);
    result.errors = Array.from(errorMatches).map((m) => ({
      file: '',
      line: 0,
      column: 0,
      message: m[1],
      severity: 'error' as const,
    }));

    if (result.errors.length > 0) {
      result.success = false;
    }
  }

  // Extract warnings
  const warningMatches = output.matchAll(/Warning[:\s]+(.+?)(?:\n|$)/gi);
  result.warnings = Array.from(warningMatches).map((m) => m[1]);

  return result;
}

// ============================================================================
// Development Simulation (when Docker not available)
// ============================================================================

async function simulateForgeExecution(job: DbForgeJob): Promise<void> {
  console.log(`[Forge] Simulating job ${job.id} (Docker disabled)`);

  await appendJobOutput(job.id, 'Compiling contracts...\n');

  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Parse the input files to check for obvious errors
  const hasMainContract = job.input_data.files.some(
    (f) => f.path.endsWith('.sol') && f.path.startsWith('src/')
  );

  if (!hasMainContract) {
    const result: ForgeJobResult = {
      success: false,
      errors: [
        {
          file: '',
          line: 0,
          column: 0,
          message: 'No Solidity files found in src/ directory',
          severity: 'error',
        },
      ],
    };
    await appendJobOutput(job.id, 'Error: No Solidity files found in src/ directory\n');
    await updateJobStatus(job.id, 'failed', result);
    return;
  }

  // Simulate successful compilation
  await appendJobOutput(job.id, 'Compilation successful!\n');

  if (job.job_type === 'test') {
    await appendJobOutput(job.id, '\nRunning tests...\n');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await appendJobOutput(job.id, 'Tests passed!\n');
  }

  const result: ForgeJobResult = {
    success: true,
    artifacts: [
      {
        contractName: 'MyHook',
        bytecode: '0x608060405234801561001057600080fd5b50...',
        abi: [
          { type: 'constructor', inputs: [] },
          { type: 'function', name: 'afterPayRecordedWith', inputs: [], outputs: [] },
        ],
      },
    ],
  };

  if (job.job_type === 'test') {
    result.testResults = [
      { name: 'test_PayHook', passed: true, gasUsed: 45000, duration: 100 },
    ];
  }

  await updateJobStatus(job.id, 'completed', result);
}

// ============================================================================
// Cleanup
// ============================================================================

export async function cleanupExpiredJobs(): Promise<number> {
  const result = await execute(
    `DELETE FROM forge_jobs WHERE expires_at < NOW()`,
    []
  );

  if (result > 0) {
    console.log(`[Forge] Cleaned up ${result} expired jobs`);
  }

  return result;
}

export async function cancelStaleJobs(): Promise<number> {
  // Cancel jobs that have been running for too long (e.g., 10 minutes)
  const result = await execute(
    `UPDATE forge_jobs
     SET status = 'timeout',
         completed_at = NOW(),
         result_data = '{"success": false, "errors": [{"file": "", "line": 0, "column": 0, "message": "Job exceeded maximum runtime", "severity": "error"}]}'::jsonb
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL '10 minutes'`,
    []
  );

  if (result > 0) {
    console.log(`[Forge] Cancelled ${result} stale jobs`);
  }

  return result;
}

/**
 * Recover jobs that were running when the server crashed.
 * Called on startup to clean up orphaned running jobs.
 * Uses a 2-minute grace period to avoid killing jobs from a quick restart.
 */
export async function recoverOrphanedJobs(): Promise<number> {
  const result = await execute(
    `UPDATE forge_jobs
     SET status = 'failed',
         completed_at = NOW(),
         result_data = '{"success": false, "errors": [{"file": "", "line": 0, "column": 0, "message": "Job interrupted by server restart", "severity": "error"}]}'::jsonb
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL '2 minutes'`,
    []
  );

  return result;
}

// ============================================================================
// RPC Proxy (for fork tests)
// ============================================================================

export function isAllowedRpcMethod(method: string): boolean {
  return ALLOWED_RPC_METHODS.has(method);
}

export function getRpcUrl(chainId: number): string | null {
  return SUPPORTED_CHAINS[chainId] || null;
}

export async function proxyRpcRequest(
  chainId: number,
  method: string,
  params: unknown[]
): Promise<unknown> {
  if (!isAllowedRpcMethod(method)) {
    throw new Error(`RPC method not allowed: ${method}`);
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result;
}
