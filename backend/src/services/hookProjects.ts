import { query, queryOne, execute, transaction } from '../db/index.ts';
import { createHash } from 'node:crypto';
import { getHookTemplate, customizeTemplate, type HookType } from '../templates/hooks/index.ts';

// ============================================================================
// Types
// ============================================================================

export type HookProjectType = 'pay-hook' | 'cash-out-hook' | 'split-hook';

interface DbHookProject {
  id: string;
  user_address: string;
  name: string;
  project_type: HookProjectType;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  is_deployed: boolean;
  deployed_addresses: Record<number, string>;
}

interface DbHookProjectFile {
  id: string;
  project_id: string;
  path: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface HookProject {
  id: string;
  userAddress: string;
  name: string;
  projectType: HookProjectType;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDeployed: boolean;
  deployedAddresses: Record<number, string>;
}

export interface HookProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  userAddress: string;
  name: string;
  projectType: HookProjectType;
  description?: string;
  files?: Array<{ path: string; content: string }>;
  useTemplate?: boolean; // If true and no files provided, use default template
  contractName?: string; // Custom contract name for template
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

// ============================================================================
// Transformations
// ============================================================================

function transformProject(db: DbHookProject): HookProject {
  return {
    id: db.id,
    userAddress: db.user_address,
    name: db.name,
    projectType: db.project_type,
    description: db.description,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    isDeployed: db.is_deployed,
    deployedAddresses: db.deployed_addresses || {},
  };
}

function transformFile(db: DbHookProjectFile): HookProjectFile {
  return {
    id: db.id,
    projectId: db.project_id,
    path: db.path,
    content: db.content,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ============================================================================
// Project CRUD
// ============================================================================

export async function createProject(input: CreateProjectInput): Promise<HookProject> {
  return transaction(async (client) => {
    // Create the project
    const result = await client.queryObject<DbHookProject>(
      `INSERT INTO hook_projects (user_address, name, project_type, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.userAddress, input.name, input.projectType, input.description || null]
    );

    const project = result.rows[0];
    if (!project) {
      throw new Error('Failed to create project');
    }

    // Determine which files to use
    let files = input.files;

    // If no files provided and useTemplate is true (or not specified), use template
    if ((!files || files.length === 0) && input.useTemplate !== false) {
      const template = getHookTemplate(input.projectType as HookType);
      const customized = customizeTemplate(template, {
        contractName: input.contractName || toPascalCase(input.name),
      });
      files = customized.files;
    }

    // Add initial files if any
    if (files && files.length > 0) {
      for (const file of files) {
        await client.queryObject(
          `INSERT INTO hook_project_files (project_id, path, content)
           VALUES ($1, $2, $3)`,
          [project.id, file.path, file.content]
        );
      }
    }

    return transformProject(project);
  });
}

/**
 * Convert a string to PascalCase for contract names.
 */
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
    + 'Hook';
}

export async function getProject(
  projectId: string,
  userAddress?: string
): Promise<HookProject | null> {
  const whereClause = userAddress
    ? 'WHERE id = $1 AND user_address = $2'
    : 'WHERE id = $1';
  const params = userAddress ? [projectId, userAddress] : [projectId];

  const project = await queryOne<DbHookProject>(
    `SELECT * FROM hook_projects ${whereClause}`,
    params
  );

  return project ? transformProject(project) : null;
}

export async function listProjects(userAddress: string): Promise<HookProject[]> {
  const projects = await query<DbHookProject>(
    `SELECT * FROM hook_projects
     WHERE user_address = $1
     ORDER BY created_at DESC`,
    [userAddress]
  );

  return projects.map(transformProject);
}

export async function updateProject(
  projectId: string,
  userAddress: string,
  input: UpdateProjectInput
): Promise<HookProject | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }

  if (updates.length === 0) {
    return getProject(projectId, userAddress);
  }

  values.push(projectId, userAddress);

  const project = await queryOne<DbHookProject>(
    `UPDATE hook_projects
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex++} AND user_address = $${paramIndex}
     RETURNING *`,
    values
  );

  return project ? transformProject(project) : null;
}

export async function deleteProject(
  projectId: string,
  userAddress: string
): Promise<boolean> {
  const rowsAffected = await execute(
    `DELETE FROM hook_projects
     WHERE id = $1 AND user_address = $2`,
    [projectId, userAddress]
  );

  return rowsAffected > 0;
}

export async function markAsDeployed(
  projectId: string,
  userAddress: string,
  deployedAddresses: Record<number, string>
): Promise<HookProject | null> {
  const project = await queryOne<DbHookProject>(
    `UPDATE hook_projects
     SET is_deployed = TRUE,
         deployed_addresses = deployed_addresses || $1::jsonb
     WHERE id = $2 AND user_address = $3
     RETURNING *`,
    [JSON.stringify(deployedAddresses), projectId, userAddress]
  );

  return project ? transformProject(project) : null;
}

// ============================================================================
// File CRUD
// ============================================================================

export async function getProjectFiles(projectId: string): Promise<HookProjectFile[]> {
  const files = await query<DbHookProjectFile>(
    `SELECT * FROM hook_project_files
     WHERE project_id = $1
     ORDER BY path`,
    [projectId]
  );

  return files.map(transformFile);
}

export async function getFile(
  projectId: string,
  path: string
): Promise<HookProjectFile | null> {
  const file = await queryOne<DbHookProjectFile>(
    `SELECT * FROM hook_project_files
     WHERE project_id = $1 AND path = $2`,
    [projectId, path]
  );

  return file ? transformFile(file) : null;
}

export async function addFile(
  projectId: string,
  path: string,
  content: string
): Promise<HookProjectFile> {
  const file = await queryOne<DbHookProjectFile>(
    `INSERT INTO hook_project_files (project_id, path, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [projectId, path, content]
  );

  if (!file) {
    throw new Error('Failed to add file');
  }

  return transformFile(file);
}

export async function updateFile(
  projectId: string,
  path: string,
  content: string
): Promise<HookProjectFile | null> {
  const file = await queryOne<DbHookProjectFile>(
    `UPDATE hook_project_files
     SET content = $1
     WHERE project_id = $2 AND path = $3
     RETURNING *`,
    [content, projectId, path]
  );

  return file ? transformFile(file) : null;
}

export async function upsertFile(
  projectId: string,
  path: string,
  content: string
): Promise<HookProjectFile> {
  const file = await queryOne<DbHookProjectFile>(
    `INSERT INTO hook_project_files (project_id, path, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, path)
     DO UPDATE SET content = $3
     RETURNING *`,
    [projectId, path, content]
  );

  if (!file) {
    throw new Error('Failed to upsert file');
  }

  return transformFile(file);
}

export async function deleteFile(
  projectId: string,
  path: string
): Promise<boolean> {
  const rowsAffected = await execute(
    `DELETE FROM hook_project_files
     WHERE project_id = $1 AND path = $2`,
    [projectId, path]
  );

  return rowsAffected > 0;
}

export async function bulkUpdateFiles(
  projectId: string,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  await transaction(async (client) => {
    for (const file of files) {
      await client.queryObject(
        `INSERT INTO hook_project_files (project_id, path, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id, path)
         DO UPDATE SET content = $3`,
        [projectId, file.path, file.content]
      );
    }
  });
}

// ============================================================================
// Project with Files (combined fetch)
// ============================================================================

export interface HookProjectWithFiles extends HookProject {
  files: HookProjectFile[];
}

export async function getProjectWithFiles(
  projectId: string,
  userAddress?: string
): Promise<HookProjectWithFiles | null> {
  const project = await getProject(projectId, userAddress);
  if (!project) {
    return null;
  }

  const files = await getProjectFiles(projectId);

  return {
    ...project,
    files,
  };
}

// ============================================================================
// Utilities
// ============================================================================

export function computeFilesHash(files: Array<{ path: string; content: string }>): string {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const combined = sortedFiles.map((f) => `${f.path}:${f.content}`).join('\n');
  return createHash('sha256').update(combined).digest('hex');
}

export async function getProjectStats(userAddress: string): Promise<{
  totalProjects: number;
  deployedProjects: number;
  byType: Record<HookProjectType, number>;
}> {
  interface StatsRow {
    project_type: HookProjectType;
    total: string;
    deployed: string;
  }

  const stats = await query<StatsRow>(
    `SELECT project_type,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE is_deployed) as deployed
     FROM hook_projects
     WHERE user_address = $1
     GROUP BY project_type`,
    [userAddress]
  );

  const byType: Record<HookProjectType, number> = {
    'pay-hook': 0,
    'cash-out-hook': 0,
    'split-hook': 0,
  };

  let totalProjects = 0;
  let deployedProjects = 0;

  for (const row of stats) {
    byType[row.project_type] = parseInt(row.total, 10);
    totalProjects += parseInt(row.total, 10);
    deployedProjects += parseInt(row.deployed, 10);
  }

  return {
    totalProjects,
    deployedProjects,
    byType,
  };
}
