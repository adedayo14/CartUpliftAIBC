/**
 * Email Service using Resend
 * Handles all transactional emails for Cart Uplift
 */

import { Resend } from 'resend';
import { logger } from '~/utils/logger.server';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = 'Cart Uplift <support@cartuplift.com>';
const REPLY_TO = 'support@cartuplift.com';

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email via Resend
 */
async function sendEmail({ to, subject, html, text }: EmailParams) {
  if (!process.env.RESEND_API_KEY) {
    logger.warn('⚠️  RESEND_API_KEY not set - email not sent:', subject);
    return { success: false, error: 'API key not configured' };
  }

  try {
    const data = await resend!.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text: text || stripHtml(html),
      replyTo: REPLY_TO,
    });

    logger.log('✅ Email sent:', subject, 'to', to);
    return { success: true, data };
  } catch (error) {
    logger.error('❌ Email send failed:', error);
    return { success: false, error };
  }
}

/**
 * Strip HTML tags for text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Welcome email when merchant installs the app
 */
export async function sendWelcomeEmail(merchantEmail: string, _shopDomain: string) {
  const subject = "Welcome to Cart Uplift! 🚀 Let's boost your AOV";
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb;">Welcome to Cart Uplift!</h1>
      
      <p>Thanks for installing Cart Uplift! We're excited to help you increase your average order value with AI-powered recommendations and smart bundles.</p>
      
      <h2 style="color: #1e40af; font-size: 18px;">Quick Start (5 minutes):</h2>
      
      <ol style="line-height: 1.8;">
        <li><strong>Enable the App</strong> → Go to your BigCommerce control panel → Enable the "Cart Uplift" script</li>
        <li><strong>Customize Your Cart</strong> → Visit the <a href="https://cartuplift.com/app/settings">Settings page</a> to match your brand colors</li>
        <li><strong>Create Your First Bundle</strong> → Head to the <a href="https://cartuplift.com/admin/bundles">Bundles page</a> to create manual product bundles</li>
        <li><strong>Watch It Work</strong> → The AI starts learning from your orders immediately!</li>
      </ol>
      
      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1e40af;">Need Help Getting Started?</h3>
        <p style="margin-bottom: 0;">We can help with setup and best practices for your catalog. Just reply to this email!</p>
      </div>
      
      <h3 style="color: #1e40af; font-size: 16px;">Helpful Resources:</h3>
      <ul style="line-height: 1.8;">
        <li><a href="https://cartuplift.com/app/dashboard">Dashboard</a></li>
        <li><a href="https://cartuplift.com/app/settings">Settings</a></li>
        <li><a href="https://cartuplift.com/admin/bundles">Bundles</a></li>
        <li><a href="https://cartuplift.com/admin/billing">Pricing</a></li>
      </ul>
      
      <div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
        <strong>💡 Pro Tip:</strong> The AI recommendations improve over time as you get more orders. For immediate results, create 2-3 manual bundles of your best-selling products!
      </div>
      
      <p>Questions? Just reply to this email - we're here to help!</p>
      
      <p style="margin-top: 30px;">
        Best,<br>
        The Cart Uplift Team<br>
        <a href="mailto:support@cartuplift.com">support@cartuplift.com</a><br>
        <a href="https://cartuplift.com">https://cartuplift.com</a>
      </p>
    </div>
  `;

  return sendEmail({
    to: merchantEmail,
    subject,
    html,
  });
}

/**
 * Order limit approaching warning (at 90%)
 */
export async function sendOrderLimitWarning(
  merchantEmail: string,
  currentCount: number,
  limit: number,
  planTier: string
) {
  const percentage = Math.round((currentCount / limit) * 100);
  const subject = `You're approaching your order limit (${percentage}%) - time to upgrade!`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #f59e0b;">Great news - you're having success! 🎉</h1>
      
      <p>You've used <strong>${currentCount}</strong> of your <strong>${limit}</strong> orders this month on the <strong>${planTier.charAt(0).toUpperCase() + planTier.slice(1)}</strong> plan. You're approaching your limit.</p>
      
      <h2 style="color: #ea580c; font-size: 18px;">What happens next?</h2>
      <ul style="line-height: 1.8;">
        <li>At 90% (you're here): Warning email (this one!)</li>
        <li>At 100%: You get a 10% grace buffer (${Math.floor(limit * 0.1)} extra orders)</li>
        <li>At 110%: App will prompt upgrade to continue</li>
      </ul>
      
      <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <h3 style="margin-top: 0;">Upgrade Now to Avoid Interruption:</h3>
        <a href="https://cartuplift.com/admin/billing" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Pricing Plans</a>
      </div>
      
      <h3 style="color: #1e40af;">Your Options:</h3>
      <ul style="line-height: 1.8;">
        <li><strong>Starter Plan</strong> ($29/mo): 500 orders/month</li>
        <li><strong>Growth Plan</strong> ($79/mo): 2,500 orders/month</li>
        <li><strong>Pro Plan</strong> ($199/mo): Unlimited orders</li>
      </ul>
      
      <p>All plans include ALL features - you never lose functionality, just increase your order capacity.</p>
      
      <p><strong>Questions about upgrading?</strong> Reply to this email!</p>
      
      <p style="margin-top: 30px;">
        Best,<br>
        The Cart Uplift Team<br>
        <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>
      </p>
    </div>
  `;

  return sendEmail({
    to: merchantEmail,
    subject,
    html,
  });
}

/**
 * Trial ending soon (3 days before)
 */
export async function sendTrialEndingEmail(
  merchantEmail: string,
  planTier: string,
  planPrice: number,
  endDate: Date
) {
  const subject = "Your Cart Uplift trial ends in 3 days";
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb;">Your trial ends soon</h1>
      
      <p>Your 14-day free trial of Cart Uplift <strong>${planTier.charAt(0).toUpperCase() + planTier.slice(1)}</strong> ends in 3 days.</p>
      
      <h2 style="color: #1e40af; font-size: 18px;">What happens next?</h2>
      <p>On <strong>${endDate.toLocaleDateString()}</strong>, your subscription will automatically activate at <strong>$${planPrice}/month</strong>. You'll continue with zero interruption.</p>
      
      <h3 style="color: #1e40af;">Want to Change or Cancel?</h3>
      <ul style="line-height: 1.8;">
        <li><strong>Upgrade/downgrade:</strong> Visit <a href="https://cartuplift.com/admin/billing">Billing Settings</a></li>
        <li><strong>Cancel:</strong> Uninstall the app from your BigCommerce control panel (no charges)</li>
      </ul>
      
      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Need more time to decide?</strong> Reply to this email and let's chat about your results!</p>
      </div>
      
      <p style="margin-top: 30px;">
        Best,<br>
        The Cart Uplift Team<br>
        <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>
      </p>
    </div>
  `;

  return sendEmail({
    to: merchantEmail,
    subject,
    html,
  });
}

/**
 * Setup assistance offer (sent 2 days after install if no bundles created)
 */
export async function sendSetupAssistanceEmail(merchantEmail: string, _shopDomain: string) {
  const subject = "Need help with Cart Uplift setup?";
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb;">Need help getting started?</h1>
      
      <p>I noticed you installed Cart Uplift a few days ago. How's everything going?</p>
      
      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1e40af;">We can help with setup and best practices for your catalog:</h3>
        <ul style="line-height: 1.8; margin-bottom: 0;">
          <li>Theme customization to match your brand</li>
          <li>Creating high-converting bundles</li>
          <li>Configuring AI personalization settings</li>
          <li>Understanding your analytics</li>
        </ul>
      </div>
      
      <p>Just reply with your biggest question or challenge, and I'll personally help you get set up!</p>
      
      <div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
        <strong>💡 Quick Win:</strong> If you haven't already, try creating a "Frequently Bought Together" bundle with your top 3 products. Most merchants see immediate results!
      </div>
      
      <p style="margin-top: 30px;">
        Best,<br>
        The Cart Uplift Support Team<br>
        <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>
      </p>
    </div>
  `;

  return sendEmail({
    to: merchantEmail,
    subject,
    html,
  });
}

/**
 * Subscription confirmed (after successful billing approval)
 */
export async function sendSubscriptionConfirmedEmail(
  merchantEmail: string,
  planTier: string,
  planPrice: number
) {
  const subject = "Your Cart Uplift subscription is active! 🎉";
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #10b981;">Your subscription is active! 🎉</h1>
      
      <p>Thanks for subscribing to Cart Uplift <strong>${planTier.charAt(0).toUpperCase() + planTier.slice(1)}</strong> at <strong>$${planPrice}/month</strong>.</p>
      
      <h2 style="color: #1e40af; font-size: 18px;">What's Next?</h2>
      <ul style="line-height: 1.8;">
        <li>Your app is fully activated with no interruptions</li>
        <li>All features are unlocked and ready to use</li>
        <li>View your usage anytime in the <a href="https://cartuplift.com/admin/billing">Billing Dashboard</a></li>
      </ul>
      
      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Need Help Maximizing Your Results?</h3>
        <p style="margin-bottom: 0;">Reply to this email with questions about:
          <ul style="margin-top: 10px;">
            <li>Optimizing your bundle strategy</li>
            <li>Interpreting your analytics</li>
            <li>Advanced personalization settings</li>
          </ul>
        </p>
      </div>
      
      <p>We're here to help you succeed!</p>
      
      <p style="margin-top: 30px;">
        Best,<br>
        The Cart Uplift Team<br>
        <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>
      </p>
    </div>
  `;

  return sendEmail({
    to: merchantEmail,
    subject,
    html,
  });
}
