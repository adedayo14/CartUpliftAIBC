/**
 * ML Data Retention Service
 * Handles data cleanup and retention based on privacy settings
 */

import prismaClient from "~/db.server";
import { logger } from "~/utils/logger.server";

const prisma = prismaClient;

export interface DataRetentionJob {
  shop: string;
  jobType: 'cleanup' | 'anonymize' | 'delete';
  dataType: 'profiles' | 'tracking' | 'all';
  retentionDays: number;
}

/**
 * Schedule a data retention job
 */
export async function scheduleDataRetention(job: DataRetentionJob) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - job.retentionDays);

    const retentionJob = await prisma.mLDataRetentionJob.create({
      data: {
        shop: job.shop,
        jobType: job.jobType,
        dataType: job.dataType,
        retentionDays: job.retentionDays,
        cutoffDate,
        status: 'pending',
        scheduledAt: new Date(),
      }
    });

    return { success: true, jobId: retentionJob.id };
  } catch (error) {
    logger.error('Error scheduling data retention job:', error);
    return { success: false, error };
  }
}

/**
 * Execute data retention cleanup
 */
export async function executeDataRetention(jobId: string) {
  try {
    // Get job details
    const job = await prisma.mLDataRetentionJob.findUnique({
      where: { id: jobId }
    });

    if (!job || job.status !== 'pending') {
      return { success: false, error: 'Job not found or already processed' };
    }

    // Update job status
    await prisma.mLDataRetentionJob.update({
      where: { id: jobId },
      data: {
        status: 'running',
        startedAt: new Date()
      }
    });

    let recordsDeleted = 0;

    // Execute cleanup based on job type
    if (job.dataType === 'profiles' || job.dataType === 'all') {
      const deletedProfiles = await prisma.mLUserProfile.updateMany({
        where: {
          shop: job.shop,
          lastActivity: {
            lt: job.cutoffDate
          },
          deletedAt: null
        },
        data: {
          deletedAt: new Date()
        }
      });
      recordsDeleted += deletedProfiles.count;
    }

    if (job.dataType === 'tracking' || job.dataType === 'all') {
      const deletedTracking = await prisma.trackingEvent.deleteMany({
        where: {
          shop: job.shop,
          createdAt: {
            lt: job.cutoffDate
          }
        }
      });
      recordsDeleted += deletedTracking.count;
    }

    // Update job status
    await prisma.mLDataRetentionJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        recordsDeleted,
        completedAt: new Date()
      }
    });

    return { success: true, recordsDeleted };
  } catch (error) {
    logger.error('Error executing data retention:', error);

    // Mark job as failed
    try {
      await prisma.mLDataRetentionJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date()
        }
      });
    } catch (updateError) {
      logger.error('Error updating failed job status:', updateError);
    }

    return { success: false, error };
  }
}

/**
 * Auto-cleanup based on shop settings
 */
export async function autoCleanupByShop(shop: string, retentionDays: number) {
  try {
    const job = await scheduleDataRetention({
      shop,
      jobType: 'cleanup',
      dataType: 'all',
      retentionDays
    });

    if (job.success && job.jobId) {
      // Execute immediately (or queue for background processing)
      return await executeDataRetention(job.jobId);
    }

    return { success: false, error: 'Failed to schedule cleanup' };
  } catch (error) {
    logger.error('Error in auto-cleanup:', error);
    return { success: false, error };
  }
}

/**
 * Anonymize user data (for GDPR compliance)
 */
export async function anonymizeUserData(shop: string, customerId: string) {
  try {
    // Remove customer ID and replace with anonymous ID
    const updated = await prisma.mLUserProfile.updateMany({
      where: {
        shop,
        customerId,
        deletedAt: null
      },
      data: {
        customerId: null,
        anonymousId: `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        privacyLevel: 'basic'
      }
    });

    return { success: true, recordsAnonymized: updated.count };
  } catch (error) {
    logger.error('Error anonymizing user data:', error);
    return { success: false, error };
  }
}

/**
 * Delete all user data (for GDPR right to be forgotten)
 */
export async function deleteUserData(shop: string, customerId: string) {
  try {
    // Hard delete ML profiles
    const deletedProfiles = await prisma.mLUserProfile.deleteMany({
      where: {
        shop,
        customerId
      }
    });

    // Delete tracking events
    const deletedTracking = await prisma.trackingEvent.deleteMany({
      where: {
        shop,
        customerId
      }
    });

    return {
      success: true,
      recordsDeleted: deletedProfiles.count + deletedTracking.count
    };
  } catch (error) {
    logger.error('Error deleting user data:', error);
    return { success: false, error };
  }
}

/**
 * Get retention statistics for a shop
 */
export async function getRetentionStats(shop: string) {
  try {
    const [profileCount, trackingCount, oldestProfile, newestProfile] = await Promise.all([
      prisma.mLUserProfile.count({
        where: { shop, deletedAt: null }
      }),
      prisma.trackingEvent.count({
        where: { shop }
      }),
      prisma.mLUserProfile.findFirst({
        where: { shop, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
      }),
      prisma.mLUserProfile.findFirst({
        where: { shop, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      })
    ]);

    return {
      totalProfiles: profileCount,
      totalTrackingEvents: trackingCount,
      oldestDataDate: oldestProfile?.createdAt,
      newestDataDate: newestProfile?.createdAt,
      dataAgeInDays: oldestProfile ? Math.floor((Date.now() - new Date(oldestProfile.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0
    };
  } catch (error) {
    logger.error('Error getting retention stats:', error);
    return null;
  }
}
