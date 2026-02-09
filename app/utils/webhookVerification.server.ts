import crypto from 'crypto';
import { logger } from '~/utils/logger.server';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  return hash === signature;
}

export async function handleWebhookWithRetry(
  handler: () => Promise<void>,
  maxRetries = 3
) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await handler();
      return;
    } catch (error) {
      lastError = error;
      logger.error(`Webhook processing attempt ${attempt} failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastError;
}
