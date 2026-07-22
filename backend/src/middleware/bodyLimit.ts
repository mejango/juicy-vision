import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

const KIB = 1024;
const MIB = 1024 * KIB;

/** Absolute ceiling for any API request body. */
export const GLOBAL_BODY_MAX_BYTES = 26 * MIB;
/** JSON requests are never expected to approach the binary upload ceiling. */
export const JSON_BODY_MAX_BYTES = 1 * MIB;
/** Small, cost-bearing operations should only carry bounded control data. */
export const COST_BODY_MAX_BYTES = 64 * KIB;
/** The user-visible file limit enforced again after multipart parsing. */
export const PIN_FILE_MAX_BYTES = 25 * MIB;
/** Allow bounded multipart headers and the required file name around a 25 MiB file. */
export const PIN_FILE_REQUEST_MAX_BYTES = PIN_FILE_MAX_BYTES + 256 * KIB;

function isJsonContentType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'));
}

function isMultipartContentType(contentType: string | undefined): boolean {
  return contentType?.split(';', 1)[0].trim().toLowerCase() === 'multipart/form-data';
}

export function createBodyLimit(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      c.json(
        {
          success: false,
          error: 'Request body is too large',
        },
        413,
      ),
  });
}

export const globalBodyLimit = createBodyLimit(GLOBAL_BODY_MAX_BYTES);
export const costBodyLimit = createBodyLimit(COST_BODY_MAX_BYTES);
export const pinFileBodyLimit = createBodyLimit(PIN_FILE_REQUEST_MAX_BYTES);

const jsonLimit = createBodyLimit(JSON_BODY_MAX_BYTES);

/**
 * Apply the smaller JSON ceiling before Hono validators or `c.req.json()` can
 * materialize an attacker-controlled object in memory.
 */
export const jsonBodyLimit: MiddlewareHandler = async (c, next) => {
  if (isJsonContentType(c.req.header('content-type'))) {
    return await jsonLimit(c, next);
  }
  await next();
};

/**
 * Hono must buffer a body to measure it when neither a trustworthy
 * Content-Length nor fixed framing is available. Multipart is the only large
 * request type accepted by this API, so require fixed-length framing before
 * any body-limit or parser middleware runs.
 */
export const requireBoundedMultipart: MiddlewareHandler = async (c, next) => {
  if (!isMultipartContentType(c.req.header('content-type'))) {
    await next();
    return;
  }

  const transferEncoding = c.req.header('transfer-encoding');
  const rawContentLength = c.req.header('content-length');
  if (transferEncoding || !rawContentLength || !/^\d+$/.test(rawContentLength)) {
    return c.json(
      {
        success: false,
        error: 'Multipart requests require a valid Content-Length',
      },
      411,
    );
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > GLOBAL_BODY_MAX_BYTES) {
    return c.json(
      {
        success: false,
        error: 'Request body is too large',
      },
      413,
    );
  }

  await next();
};

/** Require multipart framing and enforce the upload-route request ceiling. */
export const validatePinFileRequest: MiddlewareHandler = async (c, next) => {
  if (!isMultipartContentType(c.req.header('content-type'))) {
    return c.json(
      {
        success: false,
        error: 'Content-Type must be multipart/form-data',
      },
      415,
    );
  }

  const rawContentLength = c.req.header('content-length');
  const contentLength = rawContentLength ? Number(rawContentLength) : Number.NaN;
  if (!Number.isSafeInteger(contentLength) || contentLength > PIN_FILE_REQUEST_MAX_BYTES) {
    return c.json(
      {
        success: false,
        error: 'File request is too large (max 25 MiB plus multipart framing)',
      },
      413,
    );
  }

  await next();
};
