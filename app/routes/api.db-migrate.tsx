import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// WARNING: This is a utility endpoint to push schema changes
// Only use in development or controlled production deployments
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Only allow in development or with secret key
  const secret = request.headers.get("x-migration-secret");
  const isDev = process.env.NODE_ENV === "development";
  const isAuthorized = secret === process.env.MIGRATION_SECRET;

  if (!isDev && !isAuthorized) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[db-migrate] Running prisma db push...");
    const { stdout, stderr } = await execAsync("npx prisma db push --skip-generate");
    
    console.log("[db-migrate] ✅ Success");
    console.log("STDOUT:", stdout);
    if (stderr) console.log("STDERR:", stderr);

    return json({ 
      success: true, 
      message: "Database schema pushed successfully",
      output: stdout
    });
  } catch (error: unknown) {
    console.error("[db-migrate] ❌ Error:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      output: (error as { stdout?: string; stderr?: string }).stdout || (error as { stdout?: string; stderr?: string }).stderr 
    }, { status: 500 });
  }
};

export const loader = async () => {
  return json({ 
    message: "Use POST to run database migrations",
    warning: "This endpoint pushes schema changes to production database"
  });
};
