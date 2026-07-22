import { assertEquals } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { adminRouter } from './admin.ts';
import { imagesRouter } from './images.ts';
import { localeRouter } from './locale.ts';
import { isProjectOwner, projectsRouter } from './projects.ts';
import { requireAdmin } from '../middleware/auth.ts';
import type { User } from '../types/index.ts';

const regularUser: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  privacyMode: 'private',
  isAdmin: false,
};

const adminUser: User = { ...regularUser, isAdmin: true };

Deno.test('admin authorization denies missing and non-admin users before spend processing', async () => {
  const actual = new Hono();
  actual.route('/admin', adminRouter);
  const unauthenticated = await actual.request('/admin/juice/spends/spend-1/process', {
    method: 'POST',
  });
  assertEquals(unauthenticated.status, 401);

  let processed = false;
  const boundary = new Hono();
  boundary.use('/admin/*', async (c, next) => {
    const role = c.req.header('x-test-role');
    if (role === 'user') c.set('user', regularUser);
    if (role === 'admin') c.set('user', adminUser);
    await next();
  });
  boundary.use('/admin/*', requireAdmin);
  boundary.post('/admin/juice/spends/:id/process', (c) => {
    processed = true;
    return c.json({ success: true, id: c.req.param('id') });
  });

  const missing = await boundary.request('/admin/juice/spends/spend-1/process', { method: 'POST' });
  assertEquals(missing.status, 401);
  assertEquals(processed, false);

  const forbidden = await boundary.request('/admin/juice/spends/spend-1/process', {
    method: 'POST',
    headers: { 'x-test-role': 'user' },
  });
  assertEquals(forbidden.status, 403);
  assertEquals(processed, false);

  const allowed = await boundary.request('/admin/juice/spends/spend-1/process', {
    method: 'POST',
    headers: { 'x-test-role': 'admin' },
  });
  assertEquals(allowed.status, 200);
  assertEquals(processed, true);
});

Deno.test('locale statistics require authentication before querying analytics', async () => {
  const app = new Hono();
  app.route('/locale', localeRouter);
  const response = await app.request('/locale/stats');
  assertEquals(response.status, 401);
});

Deno.test('cost-bearing project and image routes reject unauthenticated requests', async () => {
  const app = new Hono();
  app.route('/projects', projectsRouter);
  app.route('/images', imagesRouter);

  const requests = [
    app.request('/projects', { method: 'POST' }),
    app.request('/projects/pin-metadata', { method: 'POST' }),
    app.request('/projects/pin-file', { method: 'POST' }),
    app.request('/projects/11111111-1111-4111-8111-111111111111', { method: 'PATCH' }),
    app.request('/projects/11111111-1111-4111-8111-111111111111/chains/1', {
      method: 'PATCH',
    }),
    app.request('/images/generate', { method: 'POST' }),
  ];

  for (const response of await Promise.all(requests)) {
    assertEquals(response.status, 401);
  }
});

Deno.test('project ownership comparison denies a different authenticated user', () => {
  assertEquals(isProjectOwner({ userId: regularUser.id }, regularUser), true);
  assertEquals(
    isProjectOwner({ userId: '22222222-2222-4222-8222-222222222222' }, regularUser),
    false,
  );
  assertEquals(isProjectOwner({ userId: null }, regularUser), false);
});
