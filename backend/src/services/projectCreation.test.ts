/**
 * Project Creation Service Tests
 *
 * Tests CRUD operations for created projects and revnets,
 * chain tracking, and sucker management.
 */

import { assertEquals, assertExists, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  createProject,
  updateProject,
  updateProjectChain,
  getProjectById,
  getProjectsByUser,
  getProjectChains,
  saveRevnetStages,
  getRevnetStages,
  type CreateProjectParams,
} from './projectCreation.ts';

// Test user ID
const TEST_USER_ID = 'usr_test_project_creation_001';

// Track created project IDs for cleanup
const createdProjectIds: string[] = [];

// ============================================================================
// Helper Functions
// ============================================================================

async function createTestProject(
  overrides: Partial<CreateProjectParams> = {}
): Promise<ReturnType<typeof createProject>> {
  const project = await createProject({
    userId: TEST_USER_ID,
    projectName: `Test Project ${Date.now()}`,
    projectUri: 'QmTestUri123',
    projectType: 'project',
    chainIds: [1, 10, 8453],
    ...overrides,
  });
  createdProjectIds.push(project.id);
  return project;
}

// ============================================================================
// Create Project Tests
// ============================================================================

Deno.test({
  name: 'createProject: creates project with all chain records',
  async fn() {
    const project = await createTestProject({
      projectName: 'Test Multi-Chain Project',
      chainIds: [1, 10, 8453, 42161],
    });

    assertExists(project.id);
    assertEquals(project.projectName, 'Test Multi-Chain Project');
    assertEquals(project.projectType, 'project');
    assertEquals(project.creationStatus, 'pending');
    assertEquals(project.chains.length, 4);

    // Check all chains are present
    const chainIds = project.chains.map(c => c.chainId);
    assertEquals(chainIds.includes(1), true);
    assertEquals(chainIds.includes(10), true);
    assertEquals(chainIds.includes(8453), true);
    assertEquals(chainIds.includes(42161), true);

    // All chains should be pending
    project.chains.forEach(chain => {
      assertEquals(chain.status, 'pending');
      assertEquals(chain.suckerStatus, 'pending');
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'createProject: creates revnet with split operator',
  async fn() {
    const splitOperator = '0x1234567890123456789012345678901234567890';
    const project = await createTestProject({
      projectName: 'Test Revnet',
      projectType: 'revnet',
      splitOperator,
      chainIds: [1, 10],
    });

    assertEquals(project.projectType, 'revnet');
    assertEquals(project.splitOperator, splitOperator);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'createProject: handles single chain',
  async fn() {
    const project = await createTestProject({
      projectName: 'Single Chain Project',
      chainIds: [1],
    });

    assertEquals(project.chains.length, 1);
    assertEquals(project.chains[0].chainId, 1);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'createProject: creates without user ID',
  async fn() {
    const project = await createProject({
      projectName: 'Anonymous Project',
      projectType: 'project',
      chainIds: [1],
    });
    createdProjectIds.push(project.id);

    assertExists(project.id);
    assertEquals(project.userId, null);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Update Project Tests
// ============================================================================

Deno.test({
  name: 'updateProject: updates creation status',
  async fn() {
    const project = await createTestProject();

    const updated = await updateProject(project.id, {
      creationStatus: 'processing',
    });

    assertEquals(updated.creationStatus, 'processing');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'updateProject: updates sucker group ID',
  async fn() {
    const project = await createTestProject();
    const suckerGroupId = '0xabcd1234';

    const updated = await updateProject(project.id, {
      suckerGroupId,
    });

    assertEquals(updated.suckerGroupId, suckerGroupId);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'updateProject: handles no updates',
  async fn() {
    const project = await createTestProject();

    const updated = await updateProject(project.id, {});

    assertEquals(updated.id, project.id);
    assertEquals(updated.projectName, project.projectName);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Update Project Chain Tests
// ============================================================================

Deno.test({
  name: 'updateProjectChain: updates chain project ID and tx hash',
  async fn() {
    const project = await createTestProject({ chainIds: [1, 10] });
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const updated = await updateProjectChain(project.id, 1, {
      projectId: 123,
      txHash,
      status: 'confirmed',
    });

    assertEquals(updated.projectId, 123);
    assertEquals(updated.txHash, txHash);
    assertEquals(updated.status, 'confirmed');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'updateProjectChain: updates sucker address and status',
  async fn() {
    const project = await createTestProject({ chainIds: [1] });
    const suckerAddress = '0x9876543210987654321098765432109876543210';

    const updated = await updateProjectChain(project.id, 1, {
      suckerAddress,
      suckerStatus: 'confirmed',
    });

    assertEquals(updated.suckerAddress, suckerAddress);
    assertEquals(updated.suckerStatus, 'confirmed');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'updateProjectChain: throws on missing chain',
  async fn() {
    const project = await createTestProject({ chainIds: [1] });

    await assertRejects(
      async () => {
        await updateProjectChain(project.id, 99999, {
          status: 'confirmed',
        });
      },
      Error,
      'not found'
    );
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Get Project Tests
// ============================================================================

Deno.test({
  name: 'getProjectById: returns project',
  async fn() {
    const created = await createTestProject({
      projectName: 'Get By ID Test',
    });

    const fetched = await getProjectById(created.id);

    assertExists(fetched);
    assertEquals(fetched.id, created.id);
    assertEquals(fetched.projectName, 'Get By ID Test');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'getProjectById: returns null for non-existent',
  async fn() {
    const fetched = await getProjectById('00000000-0000-0000-0000-000000000000');

    assertEquals(fetched, null);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'getProjectChains: returns all chain records',
  async fn() {
    const project = await createTestProject({
      chainIds: [1, 10, 8453],
    });

    const chains = await getProjectChains(project.id);

    assertEquals(chains.length, 3);
    // Should be ordered by chain ID
    assertEquals(chains[0].chainId, 1);
    assertEquals(chains[1].chainId, 10);
    assertEquals(chains[2].chainId, 8453);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Get Projects By User Tests
// ============================================================================

Deno.test({
  name: 'getProjectsByUser: returns user projects with chains',
  async fn() {
    // Create a few projects for the test user
    await createTestProject({ projectName: 'User Project 1' });
    await createTestProject({ projectName: 'User Project 2' });

    const projects = await getProjectsByUser(TEST_USER_ID);

    assertEquals(projects.length >= 2, true);
    // Each project should have chains
    projects.forEach(project => {
      assertExists(project.chains);
      assertEquals(project.chains.length > 0, true);
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'getProjectsByUser: filters by project type',
  async fn() {
    await createTestProject({ projectType: 'project' });
    await createTestProject({ projectType: 'revnet' });

    const projects = await getProjectsByUser(TEST_USER_ID, {
      projectType: 'revnet',
    });

    projects.forEach(project => {
      assertEquals(project.projectType, 'revnet');
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'getProjectsByUser: respects limit and offset',
  async fn() {
    const projects = await getProjectsByUser(TEST_USER_ID, {
      limit: 2,
      offset: 0,
    });

    assertEquals(projects.length <= 2, true);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Revnet Stages Tests
// ============================================================================

Deno.test({
  name: 'saveRevnetStages: saves stage configurations',
  async fn() {
    const project = await createTestProject({ projectType: 'revnet' });

    await saveRevnetStages(project.id, [
      {
        stageNumber: 1,
        startsAtOrAfter: 0,
        splitPercent: 200000000,
        initialIssuance: '1000000000000000000000000',
        issuanceDecayFrequency: 604800,
        issuanceDecayPercent: 50000000,
        cashOutTaxRate: 1000,
      },
      {
        stageNumber: 2,
        startsAtOrAfter: 2592000,
        splitPercent: 100000000,
        initialIssuance: '500000000000000000000000',
        issuanceDecayFrequency: 604800,
        issuanceDecayPercent: 30000000,
        cashOutTaxRate: 500,
      },
    ]);

    const stages = await getRevnetStages(project.id);

    assertEquals(stages.length, 2);
    assertEquals(stages[0].stageNumber, 1);
    assertEquals(stages[0].splitPercent, 200000000);
    assertEquals(stages[1].stageNumber, 2);
    assertEquals(stages[1].splitPercent, 100000000);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'saveRevnetStages: upserts on duplicate stage number',
  async fn() {
    const project = await createTestProject({ projectType: 'revnet' });

    // Save initial stage
    await saveRevnetStages(project.id, [
      {
        stageNumber: 1,
        startsAtOrAfter: 0,
        splitPercent: 200000000,
        initialIssuance: '1000000000000000000000000',
        issuanceDecayFrequency: 604800,
        issuanceDecayPercent: 50000000,
        cashOutTaxRate: 1000,
      },
    ]);

    // Update same stage
    await saveRevnetStages(project.id, [
      {
        stageNumber: 1,
        startsAtOrAfter: 0,
        splitPercent: 300000000, // Changed
        initialIssuance: '2000000000000000000000000', // Changed
        issuanceDecayFrequency: 604800,
        issuanceDecayPercent: 50000000,
        cashOutTaxRate: 1000,
      },
    ]);

    const stages = await getRevnetStages(project.id);

    assertEquals(stages.length, 1);
    assertEquals(stages[0].splitPercent, 300000000);
    assertEquals(stages[0].initialIssuance, '2000000000000000000000000');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'getRevnetStages: returns empty for project without stages',
  async fn() {
    const project = await createTestProject({ projectType: 'revnet' });

    const stages = await getRevnetStages(project.id);

    assertEquals(stages.length, 0);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test({
  name: 'Integration: full project creation workflow',
  async fn() {
    // 1. Create project
    const project = await createTestProject({
      projectName: 'Full Workflow Test',
      projectType: 'project',
      chainIds: [1, 10, 8453],
    });

    assertEquals(project.creationStatus, 'pending');

    // 2. Update to processing
    await updateProject(project.id, { creationStatus: 'processing' });

    // 3. Confirm chains one by one
    await updateProjectChain(project.id, 1, {
      projectId: 100,
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      status: 'confirmed',
    });

    await updateProjectChain(project.id, 10, {
      projectId: 200,
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      status: 'confirmed',
    });

    await updateProjectChain(project.id, 8453, {
      projectId: 300,
      txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      status: 'confirmed',
    });

    // 4. Update to completed
    await updateProject(project.id, { creationStatus: 'completed' });

    // 5. Verify final state
    const final = await getProjectById(project.id);
    assertExists(final);
    assertEquals(final.creationStatus, 'completed');

    const chains = await getProjectChains(project.id);
    assertEquals(chains.every(c => c.status === 'confirmed'), true);
    assertEquals(chains.find(c => c.chainId === 1)?.projectId, 100);
    assertEquals(chains.find(c => c.chainId === 10)?.projectId, 200);
    assertEquals(chains.find(c => c.chainId === 8453)?.projectId, 300);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Integration: revnet with stages and suckers',
  async fn() {
    // 1. Create revnet
    const project = await createTestProject({
      projectName: 'Revnet Workflow Test',
      projectType: 'revnet',
      splitOperator: '0xabcdef1234567890abcdef1234567890abcdef12',
      chainIds: [1, 10],
    });

    // 2. Save stages
    await saveRevnetStages(project.id, [
      {
        stageNumber: 1,
        startsAtOrAfter: Math.floor(Date.now() / 1000),
        splitPercent: 200000000,
        initialIssuance: '1000000000000000000000000',
        issuanceDecayFrequency: 604800,
        issuanceDecayPercent: 50000000,
        cashOutTaxRate: 1000,
      },
    ]);

    // 3. Confirm chains
    await updateProjectChain(project.id, 1, {
      projectId: 50,
      status: 'confirmed',
    });

    await updateProjectChain(project.id, 10, {
      projectId: 51,
      status: 'confirmed',
    });

    // 4. Add sucker deployment
    await updateProject(project.id, {
      suckerGroupId: '0xsuckergroup123',
    });

    await updateProjectChain(project.id, 1, {
      suckerAddress: '0xsucker111111111111111111111111111111111',
      suckerStatus: 'confirmed',
    });

    await updateProjectChain(project.id, 10, {
      suckerAddress: '0xsucker222222222222222222222222222222222',
      suckerStatus: 'confirmed',
    });

    // 5. Verify
    const final = await getProjectById(project.id);
    assertExists(final);
    assertEquals(final.suckerGroupId, '0xsuckergroup123');

    const chains = await getProjectChains(project.id);
    assertEquals(chains.every(c => c.suckerStatus === 'confirmed'), true);

    const stages = await getRevnetStages(project.id);
    assertEquals(stages.length, 1);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Integration: partial failure handling',
  async fn() {
    const project = await createTestProject({
      projectName: 'Partial Failure Test',
      chainIds: [1, 10, 8453],
    });

    // Chain 1 succeeds
    await updateProjectChain(project.id, 1, {
      projectId: 100,
      status: 'confirmed',
    });

    // Chain 10 fails
    await updateProjectChain(project.id, 10, {
      status: 'failed',
    });

    // Chain 8453 succeeds
    await updateProjectChain(project.id, 8453, {
      projectId: 300,
      status: 'confirmed',
    });

    // Update to partial
    await updateProject(project.id, { creationStatus: 'partial' });

    const final = await getProjectById(project.id);
    assertEquals(final?.creationStatus, 'partial');

    const chains = await getProjectChains(project.id);
    assertEquals(chains.filter(c => c.status === 'confirmed').length, 2);
    assertEquals(chains.filter(c => c.status === 'failed').length, 1);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
