import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "@remix-run/node";
// Rate limiting is handled in middleware
import { SecurityHeaders, getClientIP } from "./services/security.server";
import { securityMonitor } from "./services/securityMonitor.server";
import { logger } from "./utils/logger.server";

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext
) {
  // Apply rate limiting
  const ip = getClientIP(request);
  const url = new URL(request.url);
  const storeHash = url.searchParams.get('storeHash') || 'unknown';
  
  try {
    // Rate limiting is handled in middleware, just log for monitoring
    logger.log('Processing request:', { storeHash, ip, path: url.pathname });
  } catch (_error) {
    logger.warn('Error in entry server security check:', { storeHash, ip });
  }

  // Add comprehensive security headers
  Object.entries(SecurityHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  // Log request for monitoring
  const validation = securityMonitor.validateRequest({
    headers: Object.fromEntries(request.headers.entries()),
    url: url.pathname,
    method: request.method
  });

  if (!validation.valid) {
    logger.warn('Security validation issues in entry server:', validation.issues);
  }
  // Additional security headers are provided via SecurityHeaders

  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            logger.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            logger.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}