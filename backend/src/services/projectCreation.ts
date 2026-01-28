import { query, queryOne, execute } from '../db/index.ts';

// =============================================================================
// Types
// =============================================================================

export type ProjectType = 'project' | 'revnet';
export type CreationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
export type ChainStatus = 'pending' | 'processing' | 'confirmed' | 'failed';
export type SuckerStatus = 'pending' | 'processing' | 'confirmed' | 'failed';

export interface CreatedProject {
  id: string;
  userId: string | null;
  projectName: string;
  projectUri: string | null;
  projectType: ProjectType;
  suckerGroupId: string | null;
  creationBundleId: string | null;
  creationStatus: CreationStatus;
  splitOperator: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedProjectChain {
  id: string;
  createdProjectId: string;
  chainId: number;
  projectId: number | null;
  txHash: string | null;
  status: ChainStatus;
  suckerAddress: string | null;
  suckerStatus: SuckerStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface DbCreatedProject {
  id: string;
  user_id: string | null;
  project_name: string;
  project_uri: string | null;
  project_type: ProjectType;
  sucker_group_id: string | null;
  creation_bundle_id: string | null;
  creation_status: CreationStatus;
  split_operator: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DbCreatedProjectChain {
  id: string;
  created_project_id: string;
  chain_id: number;
  project_id: number | null;
  tx_hash: string | null;
  status: ChainStatus;
  sucker_address: string | null;
  sucker_status: SuckerStatus;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// Helper: Convert DB row to typed object
// =============================================================================

function toCreatedProject(row: DbCreatedProject): CreatedProject {
  return {
    id: row.id,
    userId: row.user_id,
    projectName: row.project_name,
    projectUri: row.project_uri,
    projectType: row.project_type,
    suckerGroupId: row.sucker_group_id,
    creationBundleId: row.creation_bundle_id,
    creationStatus: row.creation_status,
    splitOperator: row.split_operator,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCreatedProjectChain(row: DbCreatedProjectChain): CreatedProjectChain {
  return {
    id: row.id,
    createdProjectId: row.created_project_id,
    chainId: row.chain_id,
    projectId: row.project_id,
    txHash: row.tx_hash,
    status: row.status,
    suckerAddress: row.sucker_address,
    suckerStatus: row.sucker_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// Project CRUD Operations
// =============================================================================

export interface CreateProjectParams {
  userId?: string;
  projectName: string;
  projectUri?: string;
  projectType: ProjectType;
  splitOperator?: string;
  chainIds: number[];
  creationBundleId?: string;
}

export async function createProject(params: CreateProjectParams): Promise<CreatedProject & { chains: CreatedProjectChain[] }> {
  const {
    userId,
    projectName,
    projectUri,
    projectType,
    splitOperator,
    chainIds,
    creationBundleId,
  } = params;

  // Create the main project record
  const projectRow = await queryOne<DbCreatedProject>(
    `INSERT INTO created_projects (
      user_id,
      project_name,
      project_uri,
      project_type,
      split_operator,
      creation_bundle_id,
      creation_status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    RETURNING *`,
    [userId || null, projectName, projectUri || null, projectType, splitOperator || null, creationBundleId || null]
  );

  if (!projectRow) {
    throw new Error('Failed to create project');
  }

  // Create chain records for each chain
  const chains: CreatedProjectChain[] = [];
  for (const chainId of chainIds) {
    const chainRow = await queryOne<DbCreatedProjectChain>(
      `INSERT INTO created_project_chains (
        created_project_id,
        chain_id,
        status,
        sucker_status
      ) VALUES ($1, $2, 'pending', 'pending')
      RETURNING *`,
      [projectRow.id, chainId]
    );

    if (chainRow) {
      chains.push(toCreatedProjectChain(chainRow));
    }
  }

  return {
    ...toCreatedProject(projectRow),
    chains,
  };
}

export interface UpdateProjectParams {
  creationStatus?: CreationStatus;
  suckerGroupId?: string;
}

export async function updateProject(id: string, params: UpdateProjectParams): Promise<CreatedProject> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.creationStatus !== undefined) {
    updates.push(`creation_status = $${paramIndex++}`);
    values.push(params.creationStatus);
  }

  if (params.suckerGroupId !== undefined) {
    updates.push(`sucker_group_id = $${paramIndex++}`);
    values.push(params.suckerGroupId);
  }

  if (updates.length === 0) {
    const existing = await getProjectById(id);
    if (!existing) throw new Error('Project not found');
    return existing;
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const row = await queryOne<DbCreatedProject>(
    `UPDATE created_projects
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (!row) {
    throw new Error('Project not found');
  }

  return toCreatedProject(row);
}

export interface UpdateProjectChainParams {
  projectId?: number;
  txHash?: string;
  status?: ChainStatus;
  suckerAddress?: string;
  suckerStatus?: SuckerStatus;
}

export async function updateProjectChain(
  createdProjectId: string,
  chainId: number,
  params: UpdateProjectChainParams
): Promise<CreatedProjectChain> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.projectId !== undefined) {
    updates.push(`project_id = $${paramIndex++}`);
    values.push(params.projectId);
  }

  if (params.txHash !== undefined) {
    updates.push(`tx_hash = $${paramIndex++}`);
    values.push(params.txHash);
  }

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(params.status);
  }

  if (params.suckerAddress !== undefined) {
    updates.push(`sucker_address = $${paramIndex++}`);
    values.push(params.suckerAddress);
  }

  if (params.suckerStatus !== undefined) {
    updates.push(`sucker_status = $${paramIndex++}`);
    values.push(params.suckerStatus);
  }

  if (updates.length === 0) {
    throw new Error('No updates provided');
  }

  updates.push(`updated_at = NOW()`);
  values.push(createdProjectId, chainId);

  const row = await queryOne<DbCreatedProjectChain>(
    `UPDATE created_project_chains
     SET ${updates.join(', ')}
     WHERE created_project_id = $${paramIndex} AND chain_id = $${paramIndex + 1}
     RETURNING *`,
    values
  );

  if (!row) {
    throw new Error('Project chain not found');
  }

  return toCreatedProjectChain(row);
}

export async function getProjectById(id: string): Promise<CreatedProject | null> {
  const row = await queryOne<DbCreatedProject>(
    `SELECT * FROM created_projects WHERE id = $1`,
    [id]
  );

  return row ? toCreatedProject(row) : null;
}

export async function getProjectChains(createdProjectId: string): Promise<CreatedProjectChain[]> {
  const rows = await query<DbCreatedProjectChain>(
    `SELECT * FROM created_project_chains
     WHERE created_project_id = $1
     ORDER BY chain_id`,
    [createdProjectId]
  );

  return rows.map(toCreatedProjectChain);
}

export interface GetProjectsByUserOptions {
  limit?: number;
  offset?: number;
  projectType?: ProjectType;
}

export async function getProjectsByUser(
  userId: string,
  options: GetProjectsByUserOptions = {}
): Promise<(CreatedProject & { chains: CreatedProjectChain[] })[]> {
  const { limit = 50, offset = 0, projectType } = options;

  let whereClause = 'WHERE user_id = $1';
  const values: unknown[] = [userId];
  let paramIndex = 2;

  if (projectType) {
    whereClause += ` AND project_type = $${paramIndex++}`;
    values.push(projectType);
  }

  values.push(limit, offset);

  const projectRows = await query<DbCreatedProject>(
    `SELECT * FROM created_projects
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  );

  // Fetch chains for each project
  const projects = await Promise.all(
    projectRows.map(async (row) => {
      const chains = await getProjectChains(row.id);
      return {
        ...toCreatedProject(row),
        chains,
      };
    })
  );

  return projects;
}

// =============================================================================
// Revnet Stage Operations (for tracking revnet configurations)
// =============================================================================

export interface RevnetStageConfig {
  createdProjectId: string;
  stageNumber: number;
  startsAtOrAfter: number;
  splitPercent: number;
  initialIssuance: string;
  issuanceDecayFrequency: number;
  issuanceDecayPercent: number;
  cashOutTaxRate: number;
}

export async function saveRevnetStages(
  createdProjectId: string,
  stages: Omit<RevnetStageConfig, 'createdProjectId'>[]
): Promise<void> {
  for (const stage of stages) {
    await execute(
      `INSERT INTO created_revnet_stages (
        created_project_id,
        stage_index,
        starts_at_or_after,
        split_percent,
        initial_issuance,
        issuance_decay_frequency,
        issuance_decay_percent,
        cash_out_tax_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (created_project_id, stage_index)
      DO UPDATE SET
        starts_at_or_after = EXCLUDED.starts_at_or_after,
        split_percent = EXCLUDED.split_percent,
        initial_issuance = EXCLUDED.initial_issuance,
        issuance_decay_frequency = EXCLUDED.issuance_decay_frequency,
        issuance_decay_percent = EXCLUDED.issuance_decay_percent,
        cash_out_tax_rate = EXCLUDED.cash_out_tax_rate`,
      [
        createdProjectId,
        stage.stageNumber,
        stage.startsAtOrAfter,
        stage.splitPercent,
        stage.initialIssuance,
        stage.issuanceDecayFrequency,
        stage.issuanceDecayPercent,
        stage.cashOutTaxRate,
      ]
    );
  }
}

interface DbRevnetStage {
  id: string;
  created_project_id: string;
  stage_index: number;
  starts_at_or_after: number;
  split_percent: number;
  initial_issuance: string;
  issuance_decay_frequency: number;
  issuance_decay_percent: number;
  cash_out_tax_rate: number;
}

export async function getRevnetStages(createdProjectId: string): Promise<RevnetStageConfig[]> {
  const rows = await query<DbRevnetStage>(
    `SELECT * FROM created_revnet_stages
     WHERE created_project_id = $1
     ORDER BY stage_index`,
    [createdProjectId]
  );

  return rows.map(row => ({
    createdProjectId: row.created_project_id,
    stageNumber: row.stage_index,
    startsAtOrAfter: row.starts_at_or_after,
    splitPercent: row.split_percent,
    initialIssuance: row.initial_issuance,
    issuanceDecayFrequency: row.issuance_decay_frequency,
    issuanceDecayPercent: row.issuance_decay_percent,
    cashOutTaxRate: row.cash_out_tax_rate,
  }));
}
