import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { withAuth } from "../utils/auth.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

/**
 * GDPR Data Export Endpoint
 * Allows users to export all their data collected by the ML system
 * SECURITY: Requires authentication and strict rate limiting
 */
export const action = withAuth(async ({ request, shop }: ActionFunctionArgs & { shop: string }) => {
  try {
    // SECURITY: Strict rate limiting - 5 exports per hour for GDPR compliance
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
      burstMax: 2,
      burstWindowMs: 60 * 1000, // 1 minute
    });

    if (!rateLimitResult.allowed) {
      return json(
        {
          error: "Rate limit exceeded. Maximum 5 exports per hour allowed.",
          retryAfter: rateLimitResult.retryAfter
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter || 3600),
          },
        }
      );
    }

    const data = await request.json();
    const { privacy_level, user_id } = data;
    
    // Generate comprehensive data export
    const exportData = await generateDataExport(user_id, privacy_level);
    
    // Create downloadable JSON file
    const jsonData = JSON.stringify(exportData, null, 2);
    
    return new Response(jsonData, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="cartuplift-data-export-${Date.now()}.json"`
      }
    });
    
  } catch (error) {
    console.error('Data export error:', error);
    return json({ error: 'Failed to export data' }, { status: 500 });
  }
});

async function generateDataExport(userId: string, privacyLevel: string) {
  const exportData = {
    export_info: {
      generated_at: new Date().toISOString(),
      user_id: userId,
      privacy_level: privacyLevel,
      data_retention_policy: 'Data is retained according to your privacy settings',
      contact_info: 'For questions about this data, contact support@cartuplift.com'
    },
    privacy_settings: await getUserPrivacySettings(userId),
    profile_data: await getUserProfileData(userId, privacyLevel),
    behavior_data: await getUserBehaviorData(userId, privacyLevel),
    recommendations_data: await getUserRecommendationsData(userId, privacyLevel),
    analytics_data: await getUserAnalyticsData(userId, privacyLevel)
  };
  
  return exportData;
}

async function getUserPrivacySettings(_userId: string) {
  // Mock privacy settings - would be real database query
  return {
    consent_level: 'enhanced',
    consent_timestamp: '2024-01-15T10:30:00Z',
    data_retention_days: 90,
    features_enabled: {
      personalized_recommendations: true,
      behavior_tracking: true,
      cross_session_data: true,
      predictive_analytics: false,
      collaborative_filtering: false,
      advanced_profiling: false
    },
    last_updated: '2024-01-15T10:30:00Z'
  };
}

async function getUserProfileData(userId: string, privacyLevel: string) {
  if (privacyLevel === 'basic') {
    return {
      note: 'No profile data collected in basic privacy mode'
    };
  }
  
  // Mock profile data - would be real database query
  return {
    user_id: userId,
    profile_type: 'customer',
    created_at: '2024-01-10T14:20:00Z',
    last_updated: '2024-01-20T09:15:00Z',
    session_count: 15,
    purchase_count: 3,
    total_spent: 245.75,
    average_order_value: 81.92,
    last_purchase_date: '2024-01-18T16:45:00Z',
    customer_segment: 'loyal_customer',
    preferences: {
      favorite_categories: ['Electronics', 'Sports'],
      price_sensitivity: 'medium',
      brand_preferences: ['TechBrand', 'SportsCo'],
      shopping_times: ['evening', 'weekend']
    },
    computed_features: privacyLevel === 'full_ml' ? {
      recency_score: 4,
      frequency_score: 3,
      monetary_score: 3,
      churn_risk: 0.15,
      predicted_ltv: 380.50,
      next_purchase_probability: 0.72
    } : null
  };
}

async function getUserBehaviorData(userId: string, privacyLevel: string) {
  if (privacyLevel === 'basic') {
    return {
      note: 'No behavior data collected in basic privacy mode'
    };
  }
  
  // Mock behavior data - would be real database query
  const events = [
    {
      event: 'product_viewed',
      timestamp: '2024-01-20T14:30:00Z',
      product_id: 'product_123',
      view_duration: 45000,
      session_id: 'session_abc123'
    },
    {
      event: 'item_added',
      timestamp: '2024-01-20T14:32:00Z',
      product_id: 'product_123',
      quantity: 1,
      session_id: 'session_abc123'
    },
    {
      event: 'checkout_started',
      timestamp: '2024-01-20T14:35:00Z',
      cart_value: 99.99,
      session_id: 'session_abc123'
    }
  ];
  
  return {
    total_events: events.length,
    date_range: {
      first_event: '2024-01-10T14:20:00Z',
      last_event: '2024-01-20T14:35:00Z'
    },
    events: privacyLevel === 'full_ml' ? events : events.slice(0, 10), // Limit for enhanced mode
    aggregated_stats: {
      total_page_views: 156,
      total_product_views: 89,
      total_cart_additions: 23,
      total_purchases: 3,
      average_session_duration: 420000 // milliseconds
    }
  };
}

async function getUserRecommendationsData(userId: string, privacyLevel: string) {
  if (privacyLevel === 'basic') {
    return {
      note: 'Only anonymous recommendation data in basic privacy mode',
      recommendations_shown: 45,
      recommendations_clicked: 8
    };
  }
  
  // Mock recommendations data
  return {
    total_recommendations_shown: 156,
    total_recommendations_clicked: 23,
    total_recommendations_purchased: 5,
    click_through_rate: 0.147,
    conversion_rate: 0.032,
    recent_recommendations: [
      {
        timestamp: '2024-01-20T14:30:00Z',
        product_id: 'product_456',
        strategy: 'collaborative_filtering',
        score: 0.87,
        clicked: true,
        purchased: false
      },
      {
        timestamp: '2024-01-20T14:30:00Z',
        product_id: 'product_789',
        strategy: 'content_based',
        score: 0.72,
        clicked: false,
        purchased: false
      }
    ]
  };
}

async function getUserAnalyticsData(userId: string, privacyLevel: string) {
  return {
    note: 'Anonymous analytics data aggregated across all users',
    your_contribution: privacyLevel === 'basic' ? 'Anonymous only' : 'Identified data with consent',
    data_usage: [
      'Improving recommendation algorithms',
      'Understanding shopping patterns',
      'Optimizing cart performance',
      'A/B testing new features'
    ],
    data_sharing: 'Your data is never shared with third parties',
    retention_policy: `Data is retained for the period specified in your privacy settings`,
    your_rights: [
      'Right to access your data (this export)',
      'Right to rectify incorrect data',
      'Right to delete your data',
      'Right to data portability',
      'Right to withdraw consent'
    ]
  };
}
