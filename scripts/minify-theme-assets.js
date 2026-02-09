#!/usr/bin/env node

/**
 * Minify theme extension assets for production deployment
 *
 * This script minifies cart-uplift.js and cart-bundles.js using esbuild
 * to reduce file size from ~330KB to <100KB for Shopify App Store submission.
 *
 * IMPORTANT: This script preserves all functionality - only removes whitespace,
 * comments, and performs safe optimizations.
 */

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, '../extensions/cart-uplift/assets');

const filesToMinify = [
  'cart-uplift.js',
  'cart-bundles.js',
  'cart-uplift.css',
  'cart-bundles.css'
];

async function minifyAssets() {
  console.log('🔧 Starting theme asset minification...\n');

  for (const filename of filesToMinify) {
    const inputPath = path.join(ASSETS_DIR, filename);
    const isCSS = filename.endsWith('.css');

    try {
      // Check if file exists
      await fs.access(inputPath);

      // Get original size
      const originalStats = await fs.stat(inputPath);
      const originalSizeKB = (originalStats.size / 1024).toFixed(2);

      console.log(`📦 Minifying ${filename} (${originalSizeKB} KB)...`);

      // Create backup
      const backupPath = inputPath + '.backup';
      await fs.copyFile(inputPath, backupPath);

      if (isCSS) {
        // Minify CSS
        await build({
          entryPoints: [inputPath],
          outfile: inputPath,
          minify: true,
          charset: 'utf8',
          loader: { '.css': 'css' },
          logLevel: 'error',
          allowOverwrite: true
        });
      } else {
        // Minify JavaScript - AGGRESSIVE mode for production
        await build({
          entryPoints: [inputPath],
          outfile: inputPath,
          minify: true,
          minifyWhitespace: true,
          minifyIdentifiers: true,
          minifySyntax: true,
          charset: 'utf8',
          format: 'iife', // Immediately Invoked Function Expression - safe for browser
          target: 'es2020', // Compatible with modern browsers
          treeShaking: true, // Remove unused code
          legalComments: 'none', // Remove all comments
          logLevel: 'error',
          allowOverwrite: true
        });
      }

      // Get new size
      const newStats = await fs.stat(inputPath);
      const newSizeKB = (newStats.size / 1024).toFixed(2);
      const reduction = ((1 - newStats.size / originalStats.size) * 100).toFixed(1);

      console.log(`✅ ${filename}: ${originalSizeKB} KB → ${newSizeKB} KB (${reduction}% reduction)`);
      console.log(`   Backup saved: ${filename}.backup\n`);

    } catch (error) {
      console.error(`❌ Error minifying ${filename}:`, error.message);

      // Restore from backup if it exists
      const backupPath = inputPath + '.backup';
      try {
        await fs.access(backupPath);
        await fs.copyFile(backupPath, inputPath);
        console.log(`⚠️  Restored ${filename} from backup\n`);
      } catch (restoreError) {
        console.error(`❌ Could not restore ${filename} from backup\n`);
      }
    }
  }

  console.log('✨ Minification complete!\n');
  console.log('💡 To restore original files, copy .backup files back:');
  console.log('   cp extensions/cart-uplift/assets/*.backup extensions/cart-uplift/assets/\n');
}

// Run minification
minifyAssets().catch(error => {
  console.error('❌ Minification failed:', error);
  process.exit(1);
});
