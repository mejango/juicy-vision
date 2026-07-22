import { assertEquals } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import {
  COST_BODY_MAX_BYTES,
  costBodyLimit,
  GLOBAL_BODY_MAX_BYTES,
  globalBodyLimit,
  JSON_BODY_MAX_BYTES,
  jsonBodyLimit,
  PIN_FILE_REQUEST_MAX_BYTES,
  pinFileBodyLimit,
  requireBoundedMultipart,
  validatePinFileRequest,
} from './bodyLimit.ts';

function declaredBodyRequest(
  path: string,
  contentType: string,
  contentLength: number,
): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'content-length': String(contentLength),
    },
    body: 'x',
  });
}

Deno.test('JSON body limit rejects an oversized authenticated request before parsing', async () => {
  let parsed = false;
  const app = new Hono();
  app.use('*', jsonBodyLimit);
  app.use('*', globalBodyLimit);
  app.post('/json', async (c) => {
    parsed = true;
    await c.req.json();
    return c.json({ success: true });
  });

  const request = declaredBodyRequest('/json', 'application/json', JSON_BODY_MAX_BYTES + 1);
  request.headers.set('authorization', 'Bearer authenticated-test-user');
  const response = await app.fetch(request);

  assertEquals(response.status, 413);
  assertEquals(parsed, false);
  assertEquals(await response.json(), {
    success: false,
    error: 'Request body is too large',
  });
});

Deno.test('cost-bearing body limit rejects control payloads above 64 KiB', async () => {
  let invoked = false;
  const app = new Hono();
  app.post('/cost', costBodyLimit, () => {
    invoked = true;
    return new Response('ok');
  });

  const response = await app.fetch(
    declaredBodyRequest('/cost', 'application/json', COST_BODY_MAX_BYTES + 1),
  );

  assertEquals(response.status, 413);
  assertEquals(invoked, false);
});

Deno.test('global body limit rejects a declared request above the absolute ceiling', async () => {
  let invoked = false;
  const app = new Hono();
  app.use('*', globalBodyLimit);
  app.post('/body', () => {
    invoked = true;
    return new Response('ok');
  });

  const response = await app.fetch(
    declaredBodyRequest('/body', 'application/octet-stream', GLOBAL_BODY_MAX_BYTES + 1),
  );

  assertEquals(response.status, 413);
  assertEquals(invoked, false);
});

Deno.test('multipart without fixed-length framing is rejected before route parsing', async () => {
  let parsed = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
    body,
  });
  const app = new Hono();
  app.use('*', requireBoundedMultipart);
  app.use('*', globalBodyLimit);
  app.post('/upload', () => {
    parsed = true;
    return new Response('unexpected');
  });

  const response = await app.fetch(request);

  assertEquals(response.status, 411);
  assertEquals(parsed, false);
});

Deno.test('pin-file framing rejects oversized multipart before parseBody', async () => {
  let parsed = false;
  const app = new Hono();
  app.post(
    '/upload',
    requireBoundedMultipart,
    validatePinFileRequest,
    pinFileBodyLimit,
    async (c) => {
      parsed = true;
      await c.req.parseBody();
      return new Response('ok');
    },
  );

  const response = await app.fetch(
    declaredBodyRequest(
      '/upload',
      'multipart/form-data; boundary=test',
      PIN_FILE_REQUEST_MAX_BYTES + 1,
    ),
  );

  assertEquals(response.status, 413);
  assertEquals(parsed, false);
});
