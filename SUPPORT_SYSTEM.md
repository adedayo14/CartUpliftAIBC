# Support System Implementation

## ✅ What's Been Implemented

### 1. Support Contact Modal (`app/components/SupportModal.tsx`)
- **Full-featured form** with subject and message fields
- **Plan-based response times** displayed prominently
- **Live chat option** for Growth and Pro plans (shows button with link)
- **Real-time validation** and error handling
- **Success confirmation** banner with auto-close
- **Mobile responsive** using Shopify Polaris components

### 2. Support API Endpoint (`app/routes/api.contact-support.tsx`)
- **Accepts support requests** from the modal form
- **Fetches merchant info** from Shopify GraphQL (name, email, shop)
- **Gets plan details** from billing system
- **Priority assignment** based on plan tier:
  - Free: Low priority
  - Starter: Normal priority
  - Growth: High priority
  - Pro: Urgent priority
- **Sends two emails**:
  1. To support@cartuplift.com with full request details
  2. Confirmation to merchant with expected response time

### 3. Integration with App Home Page
- **"Contact support" button** now opens the modal
- **Live chat button** appears for Growth/Pro plans
- **Plan tier** passed from loader to modal
- **Seamless UX** with loading states and success feedback

## 📧 Email Features

### Support Team Email (to support@cartuplift.com)
- **Priority badge** with color coding
- **Merchant information table**: store name, shop URL, email, plan, order count
- **Full subject and message** with formatting
- **Expected response time** reminder
- **Reply-to** set to merchant's email
- **Professional HTML design** with Cart Uplift branding

### Merchant Confirmation Email
- **Friendly greeting** with store name
- **Request summary** with subject
- **Response time expectation** based on plan
- **Quick tip** with link to help docs
- **Professional branding** consistent with other emails

## 🎯 Plan-Based Features

| Plan | Response Time | Priority | Live Chat |
|------|--------------|----------|-----------|
| Free | 48 hours | Low | ❌ |
| Starter | 24 hours | Normal | ❌ |
| Growth | 12 hours | High | ✅ |
| Pro | 4 hours | Urgent | ✅ |

## 💬 Live Chat Integration (Ready to Implement)

The modal shows a "Live chat" button for Growth/Pro plans. Currently it opens `https://cartuplift.com/chat`.

### To integrate with a chat provider:

#### Option 1: Intercom
```tsx
// In the modal's chat button onClick:
if (window.Intercom) {
  window.Intercom('show');
}
```

Add Intercom script to `app/root.tsx`:
```tsx
<script>
  window.intercomSettings = {
    app_id: "YOUR_APP_ID"
  };
</script>
<script src="https://widget.intercom.io/widget/YOUR_APP_ID"></script>
```

#### Option 2: Crisp
```tsx
// In the modal's chat button onClick:
if (window.$crisp) {
  window.$crisp.push(['do', 'chat:open']);
}
```

Add Crisp script to `app/root.tsx`:
```tsx
<script type="text/javascript">
  window.$crisp=[];window.CRISP_WEBSITE_ID="YOUR_WEBSITE_ID";
  (function(){d=document;s=d.createElement("script");
  s.src="https://client.crisp.chat/l.js";
  s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();
</script>
```

#### Option 3: Tawk.to (Free)
```tsx
// In the modal's chat button onClick:
if (window.Tawk_API) {
  window.Tawk_API.maximize();
}
```

## 🔧 How It Works

### User Flow:
1. User clicks "Contact support" on app home page
2. Modal opens with form fields
3. User enters subject and message
4. User clicks "Send message"
5. API endpoint processes request:
   - Gets merchant info from Shopify
   - Gets plan details from database
   - Determines priority level
   - Sends email to support team
   - Sends confirmation to merchant
6. Success banner shows with response time
7. Modal auto-closes after 2 seconds

### Support Team Flow:
1. Receives prioritized email at support@cartuplift.com
2. Email contains all context: merchant, plan, order count
3. Can reply directly to merchant's email
4. Priority and response time expectations are clear

## 📝 Testing Checklist

- [ ] Click "Contact support" button - modal opens
- [ ] Try to submit empty form - validation prevents it
- [ ] Fill in subject and message
- [ ] Submit form - loading state shows
- [ ] Success banner appears
- [ ] Modal auto-closes after 2 seconds
- [ ] Check support@cartuplift.com for support email
- [ ] Check merchant email for confirmation
- [ ] Test with Growth/Pro plan - "Live chat" button shows
- [ ] Test with Free/Starter plan - no chat button

## 🚀 Next Steps

### Immediate:
1. **Add RESEND_API_KEY** to Vercel environment (if not already)
2. **Test on dev store** with all plan tiers
3. **Set up email forwarding** for support@cartuplift.com

### Optional Enhancements:
1. **Add categories** to the modal (technical, billing, feature request)
2. **File upload** for screenshots
3. **Chat widget integration** for Growth/Pro plans
4. **Support ticket system** (like Zendesk, Help Scout)
5. **Auto-responses** for common questions
6. **Knowledge base** search in modal before submitting

## 💡 Pro Tips

1. **Response Time SLA**: Stick to the promised times to build trust
2. **Canned Responses**: Create templates for common questions
3. **Priority Triage**: Check urgent/high priority emails first
4. **Follow-up**: Ask for feedback after resolving issues
5. **Track Metrics**: Response time, resolution time, satisfaction scores

## 🔗 Related Files

- `/app/components/SupportModal.tsx` - Modal component
- `/app/routes/api.contact-support.tsx` - API endpoint
- `/app/routes/app._index.tsx` - Integration on home page
- `/app/services/billing.server.ts` - Plan tier logic
- `EMAIL_TEMPLATES.md` - Manual email templates for reference

---

**Status**: ✅ Complete and ready for production
**Build**: ✅ Passing
**Tests**: Ready to test on dev store
