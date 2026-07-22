import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  type CreatedProject,
  createProject,
  getProjectById,
  getProjectChains,
  getProjectsByUser,
  updateProject,
  updateProjectChain,
} from '../services/projectCreation.ts';
import { requireAuth } from '../middleware/auth.ts';
import { getIpfsClient } from '../services/ipfs.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';
import {
  costBodyLimit,
  PIN_FILE_MAX_BYTES,
  pinFileBodyLimit,
  validatePinFileRequest,
} from '../middleware/bodyLimit.ts';

const projectsRouter = new Hono();

// =============================================================================
// Validation Schemas
// =============================================================================

const ChainIdSchema = z.number().int().min(1).max(2_147_483_647);
const ProjectIdParamSchema = z.object({ id: z.string().uuid() });
const ProjectChainParamSchema = z.object({
  id: z.string().uuid(),
  chainId: z.coerce.number().int().min(1).max(2_147_483_647),
});

const CreateProjectSchema = z.object({
  projectName: z.string().min(1).max(255),
  projectUri: z.string().max(255).optional(),
  projectType: z.enum(['project', 'revnet']),
  splitOperator: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  chainIds: z.array(ChainIdSchema).min(1).max(10).refine(
    (chainIds) => new Set(chainIds).size === chainIds.length,
    { message: 'chainIds must be unique' },
  ),
  creationBundleId: z.string().max(66).optional(),
});

const UpdateProjectSchema = z.object({
  creationStatus: z.enum(['pending', 'processing', 'completed', 'failed', 'partial']).optional(),
  suckerGroupId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: 'At least one update is required',
});

const UpdateProjectChainSchema = z.object({
  projectId: z.number().int().positive().optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  status: z.enum(['pending', 'processing', 'confirmed', 'failed']).optional(),
  suckerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  suckerStatus: z.enum(['pending', 'processing', 'confirmed', 'failed']).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: 'At least one update is required',
});

const ListProjectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  type: z.enum(['project', 'revnet']).optional(),
});

const PinMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
  name: z.string().min(1).max(255),
}).refine((value) => JSON.stringify(value.metadata).length <= 50_000, {
  message: 'Metadata is too large',
});

export function isProjectOwner(
  project: Pick<CreatedProject, 'userId'>,
  user: { id: string },
): boolean {
  return project.userId === user.id;
}

// =============================================================================
// Routes
// =============================================================================

// POST /projects/pin-metadata - Pin reviewed project or tier metadata.
projectsRouter.post(
  '/pin-metadata',
  requireAuth,
  rateLimitByUser('toolPinToIpfs'),
  costBodyLimit,
  zValidator('json', PinMetadataSchema),
  async (c) => {
    try {
      const { metadata, name } = c.req.valid('json');
      const result = await getIpfsClient().pinJson(metadata, name);
      return c.json({ success: true, data: { uri: `ipfs://${result.cid}` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pin metadata';
      return c.json({ success: false, error: message }, 502);
    }
  },
);

// POST /projects/pin-file - Pin project/item media (logo, cover image, item media).
const PIN_FILE_ALLOWED_TYPES = /^(image\/|video\/|audio\/|application\/pdf$|text\/plain$)/;
projectsRouter.post(
  '/pin-file',
  requireAuth,
  rateLimitByUser('toolPinToIpfs'),
  validatePinFileRequest,
  pinFileBodyLimit,
  async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.file;
      const name = typeof body.name === 'string' ? body.name.slice(0, 255) : '';
      if (!(file instanceof File) || !name) {
        return c.json({ success: false, error: 'A file and a name are required' }, 400);
      }
      if (file.size > PIN_FILE_MAX_BYTES) {
        return c.json({ success: false, error: 'File is too large (max 25 MB)' }, 413);
      }
      const mimeType = file.type || 'application/octet-stream';
      if (!PIN_FILE_ALLOWED_TYPES.test(mimeType)) {
        return c.json({ success: false, error: 'Unsupported file type' }, 415);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await getIpfsClient().pinFile(bytes, name, mimeType);
      return c.json({ success: true, data: { uri: `ipfs://${result.cid}` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pin file';
      return c.json({ success: false, error: message }, 502);
    }
  },
);

// POST /projects - Create a new project record
projectsRouter.post(
  '/',
  requireAuth,
  zValidator('json', CreateProjectSchema),
  async (c) => {
    const data = c.req.valid('json');
    const user = c.get('user');

    try {
      const project = await createProject({
        userId: user.id,
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
  },
);

// PATCH /projects/:id - Update project record
projectsRouter.patch(
  '/:id',
  requireAuth,
  zValidator('param', ProjectIdParamSchema),
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const user = c.get('user');

    try {
      const existing = await getProjectById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }
      if (!isProjectOwner(existing, user)) {
        return c.json({ success: false, error: 'Project ownership required' }, 403);
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
  },
);

// PATCH /projects/:id/chains/:chainId - Update chain-specific status
projectsRouter.patch(
  '/:id/chains/:chainId',
  requireAuth,
  zValidator('param', ProjectChainParamSchema),
  zValidator('json', UpdateProjectChainSchema),
  async (c) => {
    const { id, chainId } = c.req.valid('param');
    const data = c.req.valid('json');
    const user = c.get('user');

    try {
      const existing = await getProjectById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }
      if (!isProjectOwner(existing, user)) {
        return c.json({ success: false, error: 'Project ownership required' }, 403);
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
  },
);

// GET /projects/:id - Get a specific project with chain details
projectsRouter.get(
  '/:id',
  requireAuth,
  zValidator('param', ProjectIdParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');

    try {
      const project = await getProjectById(id);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }
      if (!isProjectOwner(project, user)) {
        return c.json({ success: false, error: 'Project ownership required' }, 403);
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
  },
);

// GET /projects - Get authenticated user's projects
projectsRouter.get(
  '/',
  requireAuth,
  zValidator('query', ListProjectsQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { limit, offset, type: projectType } = c.req.valid('query');

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
  },
);

// GET /projects/:id/status - Get creation status for a project
projectsRouter.get(
  '/:id/status',
  requireAuth,
  zValidator('param', ProjectIdParamSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');

    try {
      const project = await getProjectById(id);
      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }
      if (!isProjectOwner(project, user)) {
        return c.json({ success: false, error: 'Project ownership required' }, 403);
      }

      const chains = await getProjectChains(id);

      // Compute overall status from chain statuses
      const allConfirmed = chains.every((ch) => ch.status === 'confirmed');
      const anyFailed = chains.some((ch) => ch.status === 'failed');
      const anyProcessing = chains.some((ch) => ch.status === 'processing');

      let computedStatus = project.creationStatus;
      if (allConfirmed && chains.length > 0) {
        computedStatus = 'completed';
      } else if (anyFailed && !anyProcessing) {
        computedStatus = chains.some((ch) => ch.status === 'confirmed') ? 'partial' : 'failed';
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
          chains: chains.map((ch) => ({
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
  },
);

export { projectsRouter };
