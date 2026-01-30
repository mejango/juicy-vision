import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  getProjectFiles,
  getProjectWithFiles,
  upsertFile,
  deleteFile,
  bulkUpdateFiles,
  markAsDeployed,
  type HookProjectType,
} from '../services/hookProjects.ts';
import {
  submitJob,
  getJob,
  getJobOutput,
  validateJobInput,
  type ForgeJobInput,
} from '../services/forge.ts';
import {
  analyzeProject,
  checkDeploymentSecurity,
  getLatestAnalysis,
} from '../services/securityAnalysis.ts';

export const hooksRouter = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const HookProjectTypeSchema = z.enum(['pay-hook', 'cash-out-hook', 'split-hook']);

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  projectType: HookProjectTypeSchema,
  description: z.string().max(2000).optional(),
  files: z.array(z.object({
    path: z.string().max(255),
    content: z.string().max(500 * 1024), // 500KB max per file
  })).max(50).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

const FileSchema = z.object({
  path: z.string().max(255),
  content: z.string().max(500 * 1024),
});

const BulkFilesSchema = z.object({
  files: z.array(FileSchema).max(50),
});

const SubmitJobSchema = z.object({
  jobType: z.enum(['compile', 'test', 'script']),
  projectId: z.string().uuid().optional(),
  files: z.array(FileSchema).optional(),
  forkConfig: z.object({
    chainId: z.number().int().positive(),
    blockNumber: z.number().int().positive().optional(),
  }).optional(),
  testMatch: z.string().max(255).optional(),
  scriptPath: z.string().max(255).optional(),
});

const DeploySchema = z.object({
  chainIds: z.array(z.number().int().positive()).min(1).max(10),
  constructorArgs: z.array(z.unknown()).optional(),
});

// ============================================================================
// Helper to get user address from auth context
// ============================================================================

function getUserAddress(c: { get: (key: string) => unknown }): string | null {
  const user = c.get('user') as { id?: string; address?: string } | undefined;
  const wallet = c.get('wallet') as { address?: string } | undefined;
  return wallet?.address || user?.address || null;
}

// ============================================================================
// Project CRUD Routes
// ============================================================================

// POST /hooks/projects - Create a new hook project
hooksRouter.post(
  '/projects',
  requireAuth,
  zValidator('json', CreateProjectSchema),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const data = c.req.valid('json');

    try {
      const project = await createProject({
        userAddress,
        name: data.name,
        projectType: data.projectType as HookProjectType,
        description: data.description,
        files: data.files,
      });

      return c.json({ success: true, data: project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create project';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /hooks/projects - List user's hook projects
hooksRouter.get(
  '/projects',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    try {
      const projects = await listProjects(userAddress);
      return c.json({ success: true, data: projects });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list projects';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /hooks/projects/:id - Get a specific project with files
hooksRouter.get(
  '/projects/:id',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');

    try {
      const project = await getProjectWithFiles(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      return c.json({ success: true, data: project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get project';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// PATCH /hooks/projects/:id - Update a project
hooksRouter.patch(
  '/projects/:id',
  requireAuth,
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');
    const data = c.req.valid('json');

    try {
      const project = await updateProject(projectId, userAddress, data);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      return c.json({ success: true, data: project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update project';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /hooks/projects/:id - Delete a project
hooksRouter.delete(
  '/projects/:id',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');

    try {
      const deleted = await deleteProject(projectId, userAddress);
      if (!deleted) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      return c.json({ success: true, data: { deleted: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete project';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// File Management Routes
// ============================================================================

// PUT /hooks/projects/:id/files - Bulk update files
hooksRouter.put(
  '/projects/:id/files',
  requireAuth,
  zValidator('json', BulkFilesSchema),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');
    const { files } = c.req.valid('json');

    try {
      // Verify project ownership
      const project = await getProject(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      await bulkUpdateFiles(projectId, files);
      const updatedFiles = await getProjectFiles(projectId);

      return c.json({ success: true, data: updatedFiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update files';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PUT /hooks/projects/:id/files/:path - Update a single file
hooksRouter.put(
  '/projects/:id/files/*',
  requireAuth,
  zValidator('json', z.object({ content: z.string().max(500 * 1024) })),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');
    // Get the file path from the wildcard
    const url = new URL(c.req.url);
    const pathMatch = url.pathname.match(/\/projects\/[^/]+\/files\/(.+)/);
    const filePath = pathMatch?.[1] || '';

    if (!filePath) {
      return c.json({ success: false, error: 'File path required' }, 400);
    }

    const { content } = c.req.valid('json');

    try {
      // Verify project ownership
      const project = await getProject(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const file = await upsertFile(projectId, filePath, content);
      return c.json({ success: true, data: file });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update file';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /hooks/projects/:id/files/:path - Delete a file
hooksRouter.delete(
  '/projects/:id/files/*',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');
    const url = new URL(c.req.url);
    const pathMatch = url.pathname.match(/\/projects\/[^/]+\/files\/(.+)/);
    const filePath = pathMatch?.[1] || '';

    if (!filePath) {
      return c.json({ success: false, error: 'File path required' }, 400);
    }

    try {
      // Verify project ownership
      const project = await getProject(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const deleted = await deleteFile(projectId, filePath);
      if (!deleted) {
        return c.json({ success: false, error: 'File not found' }, 404);
      }

      return c.json({ success: true, data: { deleted: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete file';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// Forge Job Routes
// ============================================================================

// POST /hooks/forge/submit - Submit a compile/test job
hooksRouter.post(
  '/forge/submit',
  requireAuth,
  zValidator('json', SubmitJobSchema),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const data = c.req.valid('json');

    try {
      let files: Array<{ path: string; content: string }>;

      // Get files from project or use provided files
      if (data.projectId) {
        const project = await getProjectWithFiles(data.projectId, userAddress);
        if (!project) {
          return c.json({ success: false, error: 'Project not found' }, 404);
        }
        files = project.files.map((f) => ({ path: f.path, content: f.content }));
      } else if (data.files) {
        files = data.files;
      } else {
        return c.json({ success: false, error: 'Either projectId or files required' }, 400);
      }

      const input: ForgeJobInput = {
        files,
        forkConfig: data.forkConfig,
        testMatch: data.testMatch,
        scriptPath: data.scriptPath,
      };

      // Validate input
      const validation = validateJobInput(input);
      if (!validation.valid) {
        return c.json({ success: false, error: validation.error }, 400);
      }

      const job = await submitJob(userAddress, data.jobType, input, data.projectId);

      return c.json({ success: true, data: job });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit job';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /hooks/forge/status/:id - Get job status
hooksRouter.get(
  '/forge/status/:id',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const jobId = c.req.param('id');

    try {
      const job = await getJob(jobId, userAddress);
      if (!job) {
        return c.json({ success: false, error: 'Job not found' }, 404);
      }

      return c.json({ success: true, data: job });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get job status';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /hooks/forge/stream/:id - Stream job output via SSE
hooksRouter.get(
  '/forge/stream/:id',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const jobId = c.req.param('id');

    // Verify job exists and belongs to user
    const job = await getJob(jobId, userAddress);
    if (!job) {
      return c.json({ success: false, error: 'Job not found' }, 404);
    }

    return streamSSE(c, async (stream) => {
      let lastLength = 0;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes with 1s interval

      while (attempts < maxAttempts) {
        const currentJob = await getJob(jobId);
        if (!currentJob) break;

        // Get output log
        const output = await getJobOutput(jobId);
        if (output && output.length > lastLength) {
          const newContent = output.substring(lastLength);
          await stream.writeSSE({
            event: 'output',
            data: newContent,
          });
          lastLength = output.length;
        }

        // Send status updates
        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify({
            status: currentJob.status,
            resultData: currentJob.resultData,
          }),
        });

        // Stop if job is complete
        if (['completed', 'failed', 'timeout'].includes(currentJob.status)) {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify(currentJob),
          });
          break;
        }

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });
  }
);

// ============================================================================
// Security Analysis Routes
// ============================================================================

// POST /hooks/projects/:id/analyze - Run security analysis
hooksRouter.post(
  '/projects/:id/analyze',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');

    try {
      const project = await getProjectWithFiles(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const files = project.files.map((f) => ({ path: f.path, content: f.content }));
      const analysis = await analyzeProject(projectId, files);

      return c.json({ success: true, data: analysis });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze project';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /hooks/projects/:id/security - Get latest security analysis
hooksRouter.get(
  '/projects/:id/security',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');

    try {
      // Verify project ownership
      const project = await getProject(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const analysis = await getLatestAnalysis(projectId);
      return c.json({ success: true, data: analysis });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get security analysis';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// Deployment Routes
// ============================================================================

// POST /hooks/projects/:id/check-deploy - Pre-deployment security check
hooksRouter.post(
  '/projects/:id/check-deploy',
  requireAuth,
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');

    try {
      const project = await getProjectWithFiles(projectId, userAddress);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const files = project.files.map((f) => ({ path: f.path, content: f.content }));
      const check = await checkDeploymentSecurity(projectId, files);

      return c.json({ success: true, data: check });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check deployment security';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// POST /hooks/projects/:id/deploy - Mark project as deployed
hooksRouter.post(
  '/projects/:id/deploy',
  requireAuth,
  zValidator('json', z.object({
    deployedAddresses: z.record(z.string().regex(/^\d+$/), z.string().regex(/^0x[a-fA-F0-9]{40}$/)),
  })),
  async (c) => {
    const userAddress = getUserAddress(c);
    if (!userAddress) {
      return c.json({ success: false, error: 'User address required' }, 400);
    }

    const projectId = c.req.param('id');
    const { deployedAddresses } = c.req.valid('json');

    try {
      // Convert string keys to numbers
      const addresses: Record<number, string> = {};
      for (const [key, value] of Object.entries(deployedAddresses)) {
        addresses[parseInt(key, 10)] = value;
      }

      const project = await markAsDeployed(projectId, userAddress, addresses);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      return c.json({ success: true, data: project });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark as deployed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);
