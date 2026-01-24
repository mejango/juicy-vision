/**
 * Projects API Routes Tests
 *
 * Tests the /api/projects endpoints for project creation,
 * updates, and status queries.
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const BASE_URL = 'http://localhost:3001/api';
const SESSION_ID = 'ses_test_projects_api_12345678';

// Track created project IDs for cleanup
const createdProjectIds: string[] = [];

// ============================================================================
// Helper Functions
// ============================================================================

async function createProjectViaAPI(data: {
  projectName: string;
  projectUri?: string;
  projectType: 'project' | 'revnet';
  chainIds: number[];
  splitOperator?: string;
}) {
  const res = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (json.success && json.data?.id) {
    createdProjectIds.push(json.data.id);
  }
  return { res, json };
}

async function getProjectViaAPI(id: string) {
  const res = await fetch(`${BASE_URL}/projects/${id}`, {
    headers: { 'X-Session-ID': SESSION_ID },
  });
  return { res, json: await res.json() };
}

async function updateProjectViaAPI(id: string, data: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/projects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify(data),
  });
  return { res, json: await res.json() };
}

async function updateProjectChainViaAPI(
  id: string,
  chainId: number,
  data: Record<string, unknown>
) {
  const res = await fetch(`${BASE_URL}/projects/${id}/chains/${chainId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify(data),
  });
  return { res, json: await res.json() };
}

async function getProjectStatusViaAPI(id: string) {
  const res = await fetch(`${BASE_URL}/projects/${id}/status`, {
    headers: { 'X-Session-ID': SESSION_ID },
  });
  return { res, json: await res.json() };
}

// ============================================================================
// POST /projects Tests
// ============================================================================

Deno.test({
  name: 'POST /projects: creates project successfully',
  async fn() {
    const { res, json } = await createProjectViaAPI({
      projectName: 'API Test Project',
      projectUri: 'QmTestUri',
      projectType: 'project',
      chainIds: [1, 10, 8453],
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertExists(json.data.id);
    assertEquals(json.data.projectName, 'API Test Project');
    assertEquals(json.data.projectType, 'project');
    assertEquals(json.data.creationStatus, 'pending');
    assertEquals(json.data.chains.length, 3);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'POST /projects: creates revnet with split operator',
  async fn() {
    const splitOperator = '0x1234567890123456789012345678901234567890';

    const { res, json } = await createProjectViaAPI({
      projectName: 'API Test Revnet',
      projectType: 'revnet',
      chainIds: [1, 10],
      splitOperator,
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.projectType, 'revnet');
    assertEquals(json.data.splitOperator, splitOperator);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'POST /projects: validates required fields',
  async fn() {
    const res = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
      body: JSON.stringify({
        projectType: 'project',
        chainIds: [1],
        // Missing projectName
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'POST /projects: validates project type enum',
  async fn() {
    const res = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
      body: JSON.stringify({
        projectName: 'Test',
        projectType: 'invalid',
        chainIds: [1],
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'POST /projects: validates split operator address format',
  async fn() {
    const res = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
      body: JSON.stringify({
        projectName: 'Test',
        projectType: 'revnet',
        chainIds: [1],
        splitOperator: 'invalid-address',
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// GET /projects/:id Tests
// ============================================================================

Deno.test({
  name: 'GET /projects/:id: returns project with chains',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Get Test Project',
      projectType: 'project',
      chainIds: [1, 10],
    });

    const { res, json } = await getProjectViaAPI(created.data.id);

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.id, created.data.id);
    assertEquals(json.data.projectName, 'Get Test Project');
    assertExists(json.data.chains);
    assertEquals(json.data.chains.length, 2);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'GET /projects/:id: returns 404 for non-existent',
  async fn() {
    const { res, json } = await getProjectViaAPI('00000000-0000-0000-0000-000000000000');

    assertEquals(res.status, 404);
    assertEquals(json.success, false);
    assertStringIncludes(json.error, 'not found');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// PATCH /projects/:id Tests
// ============================================================================

Deno.test({
  name: 'PATCH /projects/:id: updates creation status',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Update Status Test',
      projectType: 'project',
      chainIds: [1],
    });

    const { res, json } = await updateProjectViaAPI(created.data.id, {
      creationStatus: 'processing',
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.creationStatus, 'processing');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'PATCH /projects/:id: updates sucker group ID',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Update Sucker Test',
      projectType: 'project',
      chainIds: [1, 10],
    });

    const suckerGroupId = '0xsuckergroup123abc';
    const { res, json } = await updateProjectViaAPI(created.data.id, {
      suckerGroupId,
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.suckerGroupId, suckerGroupId);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'PATCH /projects/:id: returns 404 for non-existent',
  async fn() {
    const { res, json } = await updateProjectViaAPI(
      '00000000-0000-0000-0000-000000000000',
      { creationStatus: 'completed' }
    );

    assertEquals(res.status, 404);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'PATCH /projects/:id: validates status enum',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Invalid Status Test',
      projectType: 'project',
      chainIds: [1],
    });

    const res = await fetch(`${BASE_URL}/projects/${created.data.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
      body: JSON.stringify({
        creationStatus: 'invalid_status',
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// PATCH /projects/:id/chains/:chainId Tests
// ============================================================================

Deno.test({
  name: 'PATCH /projects/:id/chains/:chainId: updates chain status',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Chain Update Test',
      projectType: 'project',
      chainIds: [1, 10],
    });

    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const { res, json } = await updateProjectChainViaAPI(created.data.id, 1, {
      projectId: 123,
      txHash,
      status: 'confirmed',
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.projectId, 123);
    assertEquals(json.data.txHash, txHash);
    assertEquals(json.data.status, 'confirmed');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'PATCH /projects/:id/chains/:chainId: updates sucker info',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Sucker Update Test',
      projectType: 'project',
      chainIds: [1],
    });

    const suckerAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
    const { res, json } = await updateProjectChainViaAPI(created.data.id, 1, {
      suckerAddress,
      suckerStatus: 'confirmed',
    });

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.suckerAddress, suckerAddress);
    assertEquals(json.data.suckerStatus, 'confirmed');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'PATCH /projects/:id/chains/:chainId: validates tx hash format',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Invalid Hash Test',
      projectType: 'project',
      chainIds: [1],
    });

    const res = await fetch(`${BASE_URL}/projects/${created.data.id}/chains/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': SESSION_ID,
      },
      body: JSON.stringify({
        txHash: 'invalid-hash',
      }),
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// GET /projects/:id/status Tests
// ============================================================================

Deno.test({
  name: 'GET /projects/:id/status: returns computed status',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Status Test',
      projectType: 'project',
      chainIds: [1, 10],
    });

    // Update one chain to confirmed
    await updateProjectChainViaAPI(created.data.id, 1, {
      projectId: 100,
      status: 'confirmed',
    });

    const { res, json } = await getProjectStatusViaAPI(created.data.id);

    assertEquals(res.status, 200);
    assertEquals(json.success, true);
    assertEquals(json.data.id, created.data.id);
    assertEquals(json.data.projectName, 'Status Test');
    assertExists(json.data.chains);
    assertEquals(json.data.chains.length, 2);

    // Should have one confirmed, one pending
    const confirmedChain = json.data.chains.find((c: { chainId: number }) => c.chainId === 1);
    const pendingChain = json.data.chains.find((c: { chainId: number }) => c.chainId === 10);
    assertEquals(confirmedChain.status, 'confirmed');
    assertEquals(pendingChain.status, 'pending');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'GET /projects/:id/status: computes completed status',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Complete Status Test',
      projectType: 'project',
      chainIds: [1, 10],
    });

    // Confirm all chains
    await updateProjectChainViaAPI(created.data.id, 1, {
      projectId: 100,
      status: 'confirmed',
    });
    await updateProjectChainViaAPI(created.data.id, 10, {
      projectId: 200,
      status: 'confirmed',
    });

    const { res, json } = await getProjectStatusViaAPI(created.data.id);

    assertEquals(res.status, 200);
    assertEquals(json.data.creationStatus, 'completed');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'GET /projects/:id/status: computes partial status',
  async fn() {
    const { json: created } = await createProjectViaAPI({
      projectName: 'Partial Status Test',
      projectType: 'project',
      chainIds: [1, 10],
    });

    // One confirmed, one failed
    await updateProjectChainViaAPI(created.data.id, 1, {
      projectId: 100,
      status: 'confirmed',
    });
    await updateProjectChainViaAPI(created.data.id, 10, {
      status: 'failed',
    });

    const { res, json } = await getProjectStatusViaAPI(created.data.id);

    assertEquals(res.status, 200);
    assertEquals(json.data.creationStatus, 'partial');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'GET /projects/:id/status: returns 404 for non-existent',
  async fn() {
    const { res, json } = await getProjectStatusViaAPI('00000000-0000-0000-0000-000000000000');

    assertEquals(res.status, 404);
    assertEquals(json.success, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test({
  name: 'Integration: full project creation workflow via API',
  async fn() {
    // 1. Create project
    const { json: created } = await createProjectViaAPI({
      projectName: 'API Workflow Test',
      projectType: 'project',
      chainIds: [1, 10, 8453],
    });

    assertExists(created.data.id);
    const projectId = created.data.id;

    // 2. Update to processing
    await updateProjectViaAPI(projectId, { creationStatus: 'processing' });

    // 3. Confirm all chains
    const txHashes = [
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333333333333333333333333333',
    ];

    await updateProjectChainViaAPI(projectId, 1, {
      projectId: 100,
      txHash: txHashes[0],
      status: 'confirmed',
    });
    await updateProjectChainViaAPI(projectId, 10, {
      projectId: 200,
      txHash: txHashes[1],
      status: 'confirmed',
    });
    await updateProjectChainViaAPI(projectId, 8453, {
      projectId: 300,
      txHash: txHashes[2],
      status: 'confirmed',
    });

    // 4. Check status - should be completed
    const { json: status } = await getProjectStatusViaAPI(projectId);
    assertEquals(status.data.creationStatus, 'completed');
    assertEquals(status.data.chains.every((c: { status: string }) => c.status === 'confirmed'), true);

    // 5. Verify project IDs
    assertEquals(status.data.chains.find((c: { chainId: number }) => c.chainId === 1).projectId, 100);
    assertEquals(status.data.chains.find((c: { chainId: number }) => c.chainId === 10).projectId, 200);
    assertEquals(status.data.chains.find((c: { chainId: number }) => c.chainId === 8453).projectId, 300);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
