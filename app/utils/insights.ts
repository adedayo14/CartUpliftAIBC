/**
 * Insight Generation Engine
 * Analyzes dashboard metrics and generates actionable insights
 * Prioritizes the most critical 4 cards to show merchants
 */

import type { InsightCardProps } from "../components/InsightCard";

interface DashboardMetrics {
  // App status
  cartEnabled: boolean;
  recommendationsVisible: boolean;
  appInstalledDays: number;
  
  // Core metrics
  totalOrders: number;
  totalRevenue: number;
  attributedRevenue: number;
  attributedOrders: number;
  
  // Bundle metrics
  activeBundleCount: number;
  
  // Engagement metrics
  recImpressions: number;
  recClicks: number;
  recCTR: number;
  conversionRate: number;
  
  // Settings
  aiRecommendationsEnabled: boolean;
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
  ordersReachingFreeShipping: number;
  
  // Performance
  roi: number;
  lastMLUpdate: Date | null;
  mlPerformanceChange: number;
}

interface ScoredInsight extends InsightCardProps {
  score: number;
}

export function generateInsights(metrics: DashboardMetrics): InsightCardProps[] {
  const insights: ScoredInsight[] = [];
  
  // *** CRITICAL INSIGHTS (Priority 1) ***
  
  // 1. No Recommendations Visible
  if (!metrics.recommendationsVisible && metrics.appInstalledDays > 3) {
    insights.push({
      id: "no-visibility",
      type: "critical",
      priority: 1,
      title: "No one is seeing your recommendations",
      message: "Check your theme settings and make sure the app embed is turned on. Customers can't buy what they can't see.",
      action: {
        label: "Setup guide",
        url: "/admin/settings",
      },
      score: 100,
    });
  }
  
  // 2. Cart Drawer Disabled
  if (!metrics.cartEnabled && metrics.totalOrders > 10) {
    insights.push({
      id: "cart-disabled",
      type: "critical",
      priority: 1,
      title: "Cart drawer is turned off",
      message: "Enable the cart drawer to show upsells and free shipping progress. You're missing opportunities on every order.",
      action: {
        label: "Enable now",
        url: "/admin/settings",
      },
      score: 95,
    });
  }
  
  // 3. No Bundles Created
  if (metrics.activeBundleCount === 0 && metrics.appInstalledDays > 7) {
    insights.push({
      id: "no-bundles",
      type: "critical",
      priority: 1,
      title: "Create your first FBT offer",
      message: "Start with 2-3 products that customers often buy together. Most merchants see results within 3 days.",
      action: {
        label: "Create FBT",
        url: "/admin/bundles/new",
      },
      score: 97,
    });
  }
  
  // *** HIGH PRIORITY (Priority 2) ***
  
  // 4. Bundles Seen But Never Clicked
  if (metrics.recImpressions > 50 && metrics.recClicks === 0) {
    insights.push({
      id: "no-clicks",
      type: "warning",
      priority: 2,
      title: "Customers see FBT but don't click",
      message: "Try pairing products that actually go together or offer a bigger discount to make the deal more appealing.",
      action: {
        label: "View FBT offers",
        url: "/admin/bundles",
      },
      score: 85,
    });
  }
  
  // 5. Low Click-Through Rate
  if (metrics.recCTR < 2 && metrics.recImpressions > 100) {
    insights.push({
      id: "low-ctr",
      type: "warning",
      priority: 2,
      title: "Low click rate on recommendations",
      message: `Only ${metrics.recCTR.toFixed(1)}% of people click. Try showing fewer, more relevant products or add images to make offers stand out.`,
      action: {
        label: "Improve FBT",
        url: "/admin/bundles",
      },
      score: 82,
    });
  }
  
  // 6. Good Clicks, Low Conversions
  if (metrics.recCTR > 3 && metrics.conversionRate < 1 && metrics.recClicks > 20) {
    insights.push({
      id: "low-conversion",
      type: "warning",
      priority: 2,
      title: "Good clicks, but few sales",
      message: `${metrics.recCTR.toFixed(1)}% click rate is great, but only ${metrics.conversionRate.toFixed(1)}% buy. Your pricing might be too high.`,
      action: {
        label: "Review pricing",
        url: "/admin/bundles",
      },
      score: 80,
    });
  }
  
  // 7. Free Shipping Not Reaching Many
  if (metrics.freeShippingEnabled && metrics.freeShippingThreshold > 0) {
    const reachingRate = metrics.totalOrders > 0 ? (metrics.ordersReachingFreeShipping / metrics.totalOrders) * 100 : 0;
    if (reachingRate < 15 && reachingRate > 0) {
      insights.push({
        id: "shipping-low",
        type: "warning",
        priority: 2,
        title: "Very few reach free shipping",
        message: `Only ${reachingRate.toFixed(0)}% of shoppers reach your threshold. Try lowering it to boost order value.`,
        action: {
          label: "Adjust threshold",
          url: "/admin/settings",
        },
        score: 78,
      });
    }
  }
  
  // 8. AI Disabled Despite Orders
  if (!metrics.aiRecommendationsEnabled && metrics.totalOrders > 20 && metrics.activeBundleCount > 0) {
    insights.push({
      id: "ai-disabled",
      type: "warning",
      priority: 2,
      title: "You have enough data for AI recommendations",
      message: `With ${metrics.totalOrders} orders, AI can find winning product combinations automatically. Turn it on to save time.`,
      action: {
        label: "Enable AI",
        url: "/admin/settings",
      },
      score: 77,
    });
  }
  
  // *** POSITIVE INSIGHTS (Priority 4) ***
  
  // 9. First Sale Milestone
  if (metrics.attributedOrders === 1 && metrics.appInstalledDays < 30) {
    insights.push({
      id: "first-sale",
      type: "success",
      priority: 4,
      title: "First sale! 🎉",
      message: "Your FBT offers just made their first sale. Keep testing different products and discounts to see what works best.",
      score: 70,
    });
  }
  
  // 10. Strong ROI
  if (metrics.roi > 10 && metrics.attributedRevenue > 100) {
    insights.push({
      id: "strong-roi",
      type: "success",
      priority: 4,
      title: `${metrics.roi.toFixed(0)}x return on investment`,
      message: `For every dollar spent on Cart Uplift, you're making $${metrics.roi.toFixed(0)}. This is working really well.`,
      score: 65,
    });
  }
  
  // 11. High Click-Through Rate
  if (metrics.recCTR > 5 && metrics.recImpressions > 50) {
    insights.push({
      id: "high-ctr",
      type: "success",
      priority: 4,
      title: "Excellent click rate!",
      message: `${metrics.recCTR.toFixed(1)}% click rate is well above average. Your product pairings are resonating with customers.`,
      action: {
        label: "See top offers",
        url: "/admin/bundles",
      },
      score: 68,
    });
  }
  
  // 12. Strong Conversion Rate
  if (metrics.conversionRate > 5 && metrics.recClicks > 20) {
    insights.push({
      id: "high-conversion",
      type: "success",
      priority: 4,
      title: "Great conversion rate",
      message: `${metrics.conversionRate.toFixed(1)}% of clicks turn into sales. Whatever you're doing, keep it up!`,
      score: 66,
    });
  }
  
  // *** EDUCATIONAL INSIGHTS (Priority 5) ***
  
  // 13. Getting Started
  if (metrics.appInstalledDays < 7 && metrics.recImpressions < 10) {
    insights.push({
      id: "getting-started",
      type: "info",
      priority: 5,
      title: "Getting started with Cart Uplift",
      message: "Add the FBT block to your product pages and cart. Most stores see their first sale within 3 days.",
      action: {
        label: "Setup guide",
        url: "/admin/settings",
      },
      score: 60,
    });
  }
  
  // 14. ML Performance Improving
  if (metrics.lastMLUpdate && metrics.mlPerformanceChange > 10) {
    const daysSinceUpdate = Math.floor((Date.now() - new Date(metrics.lastMLUpdate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate < 7) {
      insights.push({
        id: "ml-improving",
        type: "info",
        priority: 5,
        title: "AI is learning and improving",
        message: `Your click rate improved by ${metrics.mlPerformanceChange.toFixed(0)}% this week as the AI learns what customers want.`,
        score: 55,
      });
    }
  }
  
  // Sort by score (highest first) and return top 4
  return insights
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ score: _score, ...rest }) => rest);
}
