import { createRequestHandler } from "@vercel/remix";
import * as build from "../build/server/index.js";

export const config = {
  // Ensure Node.js runtime (not Edge) for Prisma compatibility
  runtime: "nodejs",
};

export default createRequestHandler({
  build,
  mode: process.env.NODE_ENV || "production",
});
