import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createProject,
  updateProject,
  updateProjectChain,
  getProjectById,
  getProjectsByUser,
  getProjectChains,
} from '../services/projectCreation.ts';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';

const projectsRouter = new Hono();

// =============================================================================
// Validation Schemas
// =============================================================================

const CreateProjectSchema = z.object({
  projectName: z.string().min(1).max(255),
  projectUri: z.string().max(255).optional(),
  projectType: z.enum(['project', 'revnet']),
  splitOperator: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  chainIds: z.array(z.number().int().positive()),
  creationBundleId: z.string().max(66).optional(),
});

const UpdateProjectSchema = z.object({
  creationStatus: z.enum(['pending', 'processing', 'completed', 'failed', 'partial']).optional(),
  suckerGroupId: z.string().max(66).optional(),
});

const UpdateProjectChainSchema = z.object({
  projectId: z.number().int().positive().optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  status: z.enum(['pending', 'processing', 'confirmed', 'failed']).optional(),
  suckerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  suckerStatus: z.enum(['pending', 'processing', 'confirmed', 'failed']).optional(),
});

// =============================================================================
// Routes
// =============================================================================

// POST /projects - Create a new project record
projectsRouter.post(
  '/',
  optionalAuth,
  zValidator('json', CreateProjectSchema),
  async (c) => {
    const data = c.req.valid('json');
    const user = c.get('user');

    try {
      const project = await createProject({
        userId: user?.id,
        projectName: data.projectName,
        projectUri: data.projectUri,
        projectType: data.projectType,
        splitOperator: data.splitOperator,
        chainIds: data.chainIds,
        creationBundleId: data.creationBundleId,
      });

      return c.json({
        success: true,
        data: project,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create project';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /projects/:id - Update project record
projectsRouter.patch(
  '/:id',
  optionalAuth,
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');

    try {
      const existing = await getProjectById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const project = await updateProject(id, {
        creationStatus: data.creationStatus,
        suckerGroupId: data.suckerGroupId,
      });

      return c.json({
        success: true,
        data: project,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update project';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /projects/:id/chains/:chainId - Update chain-specific status
projectsRouter.patch(
  '/:id/chains/:chainId',
  optionalAuth,
  zValidator('json', UpdateProjectChainSchema),
  async (c) => {
    const id = c.req.param('id');
    const chainId = parseInt(c.req.param('chainId'), 10);
    const data = c.req.valid('json');

    try {
      const existing = await getProjectById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const chain = await updateProjectChain(id, chainId, {
        projectId: data.projectId,
        txHash: data.txHash,
        status: data.status,
        suckerAddress: data.suckerAddress,
        suckerStatus: data.suckerStatus,
      });

      return c.json({
        success: true,
        data: chain,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update project chain';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /projects/:id - Get a specific project with chain details
projectsRouter.get(
  '/:id',
  optionalAuth,
  async (c) => {
    const id = c.req.param('id');

    try {
      const project = await getProjectById(id);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const chains = await getProjectChains(id);

      return c.json({
        success: true,
        data: {
          ...project,
          chains,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get project';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /projects - Get authenticated user's projects
projectsRouter.get(
  '/',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const projectType = c.req.query('type') as 'project' | 'revnet' | undefined;

    try {
      const projects = await getProjectsByUser(user.id, {
        limit,
        offset,
        projectType,
      });

      return c.json({
        success: true,
        data: projects,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get projects';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /projects/:id/status - Get creation status for a project
projectsRouter.get(
  '/:id/status',
  optionalAuth,
  async (c) => {
    const id = c.req.param('id');

    try {
      const project = await getProjectById(id);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }

      const chains = await getProjectChains(id);

      // Compute overall status from chain statuses
      const allConfirmed = chains.every(ch => ch.status === 'confirmed');
      const anyFailed = chains.some(ch => ch.status === 'failed');
      const anyProcessing = chains.some(ch => ch.status === 'processing');

      let computedStatus = project.creationStatus;
      if (allConfirmed && chains.length > 0) {
        computedStatus = 'completed';
      } else if (anyFailed && !anyProcessing) {
        computedStatus = chains.some(ch => ch.status === 'confirmed') ? 'partial' : 'failed';
      } else if (anyProcessing) {
        computedStatus = 'processing';
      }

      return c.json({
        success: true,
        data: {
          id: project.id,
          projectName: project.projectName,
          projectType: project.projectType,
          creationStatus: computedStatus,
          chains: chains.map(ch => ({
            chainId: ch.chainId,
            projectId: ch.projectId,
            status: ch.status,
            txHash: ch.txHash,
            suckerAddress: ch.suckerAddress,
            suckerStatus: ch.suckerStatus,
          })),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get project status';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

export { projectsRouter };
