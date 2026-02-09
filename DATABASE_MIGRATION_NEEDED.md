# Database Migration Required

## Issue
The `appEmbedActivated` and `appEmbedActivatedAt` fields were added to the Prisma schema but haven't been pushed to the production database yet.

## Symptoms
- "Mark as complete" button saves to database but state doesn't persist
- Console logs show the fields as `undefined` (not `false`)
- After refresh, activation card reappears

## Solution

### Option 1: Via Vercel Dashboard (Recommended)
1. Go to Vercel Dashboard → CartUplift project
2. Go to Settings → Environment Variables
3. Copy the `DATABASE_URL` value
4. Run locally:
```bash
# Set the production database URL
export DATABASE_URL="your-production-db-url"

# Push schema changes
npx prisma db push

# Verify
npx prisma studio
```

### Option 2: Via Terminal with Direct Connection
```bash
# Push schema to production database
npx prisma db push

# This will:
# - Add appEmbedActivated column (Boolean, default false)
# - Add appEmbedActivatedAt column (DateTime, nullable)
# - NOT delete any existing data
```

### Option 3: Manual SQL (if needed)
```sql
-- Connect to your Neon/PostgreSQL database
-- Run these commands:

ALTER TABLE "Settings" 
ADD COLUMN IF NOT EXISTS "appEmbedActivated" BOOLEAN DEFAULT false;

ALTER TABLE "Settings" 
ADD COLUMN IF NOT EXISTS "appEmbedActivatedAt" TIMESTAMP;

-- Verify columns exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'Settings' 
AND column_name IN ('appEmbedActivated', 'appEmbedActivatedAt');
```

## Verification

After running the migration, check the server logs when visiting `/app`:

```
[app._index loader] ===============================
[app._index loader] DB Direct Query: {
  "appEmbedActivated": false,  // Should be false or true (not undefined)
  "appEmbedActivatedAt": null
}
```

If you still see `undefined`, the columns don't exist in the database.

## Why This Happened

The project uses `prisma db push` for production (no migration files), but schema changes need to be explicitly pushed when deploying. The fields exist in `schema.prisma` but not in the actual database.

## Prevention

Add this to deployment workflow:
1. Deploy code to Vercel
2. Run `prisma db push` against production DB
3. Restart Vercel deployment to pick up new Prisma client
