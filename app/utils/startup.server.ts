/**
 * Startup Validation
 *
 * Run all startup checks to ensure the app is properly configured
 * before accepting requests.
 *
 * Import this at the top of your server entry point:
 *   import "~/utils/startup.server";
 */

import { validateEnvOrThrow } from './env.server';

// Validate environment variables
validateEnvOrThrow();

// Future: Add other startup checks here
// - Database connectivity
// - Required tables exist
// - External service health checks
// etc.

export const startupComplete = true;
