-- Manual migration for bundle enhancements
-- Run this if automatic migration fails

-- Add new fields to Bundle table
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "assignedProducts" TEXT;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "bundleStyle" TEXT NOT NULL DEFAULT 'grid';
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "selectMinQty" INTEGER;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "selectMaxQty" INTEGER;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "tierConfig" TEXT;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "allowDeselect" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "mainProductId" TEXT;
ALTER TABLE "Bundle" ADD COLUMN IF NOT EXISTS "hideIfNoML" BOOLEAN NOT NULL DEFAULT false;

-- Add new fields to BundleProduct table
ALTER TABLE "BundleProduct" ADD COLUMN IF NOT EXISTS "isRemovable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BundleProduct" ADD COLUMN IF NOT EXISTS "isAnchor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BundleProduct" ADD COLUMN IF NOT EXISTS "tierPricing" TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS "Bundle_shop_status_idx" ON "Bundle"("shop", "status");

-- Verify changes
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Bundle' 
AND column_name IN ('assignedProducts', 'bundleStyle', 'selectMinQty', 'selectMaxQty', 'tierConfig', 'allowDeselect', 'mainProductId', 'hideIfNoML')
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'BundleProduct' 
AND column_name IN ('isRemovable', 'isAnchor', 'tierPricing')
ORDER BY ordinal_position;
