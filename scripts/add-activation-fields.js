// Script to add app activation tracking fields to production database
// Run with: node scripts/add-activation-fields.js

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addActivationFields() {
  console.log('🔧 Adding activation tracking fields to Settings table...');
  
  try {
    // Check if we can query the settings table
    const settingsCount = await prisma.settings.count();
    console.log(`📊 Found ${settingsCount} shop settings in database`);
    
    // Try to query the new fields - if this fails, columns don't exist
    try {
      const test = await prisma.settings.findFirst({
        select: { appEmbedActivated: true, appEmbedActivatedAt: true }
      });
      console.log('✅ Activation fields already exist!');
      console.log('   Sample data:', test);
    } catch (error) {
      console.log('❌ Activation fields do not exist in database');
      console.log('   Error:', error.message);
      console.log('\n📝 You need to run: prisma db push');
      console.log('   This will add the missing columns to production database');
    }
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addActivationFields();
