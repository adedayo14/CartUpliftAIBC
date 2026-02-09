import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Resend } from 'resend';
import { validateShopDomain, sanitizeTextInput, validateEmail, getClientIP } from "../services/security.server";
import { rateLimitByIP } from "../utils/rateLimiter.server";

const resend = new Resend(process.env.RESEND_API_KEY);

interface SupportRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  shop: string;
  plan: string;
  orderCount: number;
  priority: "low" | "normal" | "high" | "urgent";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Rate limit: 10 requests per minute per IP (prevent spam/abuse)
    const clientIP = getClientIP(request);
    try {
      await rateLimitByIP(clientIP, 10);
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        return json({ error: "Too many support requests. Please try again in 1 minute." }, { status: 429 });
      }
      throw error;
    }

    // Parse request body
    const bodyText = await request.text();
    let bodyData;
    
    try {
      bodyData = JSON.parse(bodyText);
    } catch {
      // If JSON parse fails, try form data
      const formData = new URLSearchParams(bodyText);
      bodyData = {
        subject: formData.get("subject"),
        message: formData.get("message"),
        shop: formData.get("shop"),
      };
    }

    const { subject: rawSubject, message: rawMessage, shop: rawShop, email: rawEmail } = bodyData;

    // Phase 3: Input validation and sanitization
    const subject = sanitizeTextInput(rawSubject, 200);
    const message = sanitizeTextInput(rawMessage, 5000);
    const shop = validateShopDomain(rawShop) ? rawShop : null;
    const email = validateEmail(rawEmail);

    if (!subject || !message) {
      console.warn('[Contact Support] Invalid inputs:', { subject: !!subject, message: !!message });
      return json({ error: "Subject and message are required and must be valid" }, { status: 400 });
    }

    // Build basic support request - send email immediately without DB lookup
    const supportRequest: SupportRequest = {
      name: shop || "Unknown Store",
      email: email || "merchant@shopify.com", // Use validated email or placeholder
      subject,
      message,
      shop: shop || "unknown",
      plan: "free",
      orderCount: 0,
      priority: "normal",
    };

    // Send email to support
    const emailResult = await sendSupportRequestEmail(supportRequest);

    if (!emailResult.success) {
      console.error("Failed to send support email:", emailResult.error);
      return json({ error: "Failed to send support request" }, { status: 500 });
    }

    return json({ 
      success: true, 
      message: "Support request sent successfully",
      priority: supportRequest.priority,
      expectedResponse: getExpectedResponseTime(supportRequest.plan)
    });

  } catch (error) {
    console.error("Support request error:", error);
    return json({ error: "Failed to process support request" }, { status: 500 });
  }
};

async function sendSupportRequestEmail(request: SupportRequest) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY not set - support email not sent');
    return { success: false, error: 'API key not configured' };
  }

  const priorityEmoji = {
    low: "📧",
    normal: "📨",
    high: "⚡",
    urgent: "🚨"
  };

  const priorityColor = {
    low: "#64748b",
    normal: "#3b82f6",
    high: "#f59e0b",
    urgent: "#ef4444"
  };

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">New Support Request</h1>
      </div>
      
      <div style="padding: 40px 30px;">
        <div style="background: ${priorityColor[request.priority]}; color: white; padding: 12px 20px; border-radius: 8px; margin-bottom: 30px; display: inline-block;">
          <strong>${priorityEmoji[request.priority]} Priority: ${request.priority.toUpperCase()}</strong>
        </div>

        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
          <h2 style="margin-top: 0; color: #1e293b; font-size: 20px;">Merchant Information</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Store:</td>
              <td style="padding: 8px 0; color: #1e293b;"><strong>${request.name}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Shop:</td>
              <td style="padding: 8px 0; color: #1e293b;">${request.shop}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Email:</td>
              <td style="padding: 8px 0; color: #1e293b;">${request.email}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Plan:</td>
              <td style="padding: 8px 0; color: #1e293b;"><strong>${request.plan.toUpperCase()}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Order Count:</td>
              <td style="padding: 8px 0; color: #1e293b;">${request.orderCount}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 30px;">
          <h2 style="color: #1e293b; font-size: 20px; margin-bottom: 10px;">Subject</h2>
          <p style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 0; color: #1e293b; font-size: 16px; font-weight: 500;">
            ${request.subject}
          </p>
        </div>

        <div>
          <h2 style="color: #1e293b; font-size: 20px; margin-bottom: 10px;">Message</h2>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <p style="color: #1e293b; line-height: 1.6; margin: 0; white-space: pre-wrap;">${request.message}</p>
          </div>
        </div>

        <div style="margin-top: 40px; padding-top: 30px; border-top: 2px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 14px; margin: 0;">
            <strong>Expected Response Time:</strong> ${getExpectedResponseTime(request.plan)}<br/>
            <strong>Reply to merchant at:</strong> <a href="mailto:${request.email}" style="color: #3b82f6;">${request.email}</a>
          </p>
        </div>
      </div>

      <div style="background: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 14px; margin: 0;">
          Cart Uplift Support System • <a href="https://cartuplift.com" style="color: #3b82f6; text-decoration: none;">cartuplift.com</a>
        </p>
      </div>
    </div>
  `;

  try {
    const data = await resend.emails.send({
      from: 'Cart Uplift <support@cartuplift.com>',
      to: "support@cartuplift.com",
      subject: `[${request.priority.toUpperCase()}] ${request.subject} - ${request.shop}`,
      html,
      replyTo: request.email,
    });

    console.log('✅ Support email sent:', request.subject);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Support email failed:', error);
    return { success: false, error };
  }
}

// Confirmation email removed - we don't have merchant email without DB lookup

function getExpectedResponseTime(plan: string): string {
  const times = {
    free: "48 hours",
    starter: "24 hours",
    growth: "12 hours",
    pro: "4 hours"
  };
  return times[plan as keyof typeof times] || "48 hours";
}
