# 2Captcha Integration - Quick Start Guide

## Setup Steps

### 1. Database Migration

Run Prisma migrations to create the new tables:

```bash
cd packages/db
npm run db:push
npm run db:generate
```

This creates:
- `captcha_configs` - stores 2Captcha API keys per user
- `captcha_queue` - tracks CAPTCHA detection and solving

### 2. Install Dependencies

No new dependencies needed! The integration uses existing packages:
- `axios` - HTTP requests to 2Captcha API
- `@3d-suite/db` - Prisma client

### 3. Add to Dashboard

In your Inquiry settings section (likely in `apps/web/src/app/dashboard/page.tsx` or similar):

```tsx
import { CaptchaSettings } from '@/components/captcha-settings';
import { CaptchaQueue } from '@/components/captcha-queue';

// Add to your inquiry/settings section:
<div className="space-y-6 border-t pt-6 mt-6">
  <h2 className="text-2xl font-bold text-gray-900">CAPTCHA Solving</h2>
  <CaptchaSettings />
  <CaptchaQueue />
</div>
```

### 4. Integrate with Inquiry Worker

In `apps/api/src/lib/inquiry-backend-worker.ts` (your form processing logic):

```typescript
import { InquiryCaptchaHandler } from './inquiry-captcha-handler';
import { CaptchaStore } from './captcha-store';

// When starting inquiry run processing:
const captchaConfig = await CaptchaStore.getCaptchaConfig(userId);
const captchaHandler = new InquiryCaptchaHandler(
  userId,
  runId,
  captchaConfig?.apiKey // Will be undefined if not configured
);

// During form discovery/filling:
const captchaResult = await captchaHandler.handleCaptcha(page);
if (!captchaResult.handled) {
  if (captchaResult.status === 'failed') {
    // Captcha solving failed - mark for review
    target.status = 'review';
    target.reason = 'CAPTCHA: ' + captchaResult.error;
  } else {
    // No solver configured - mark for review
    target.status = 'review';
    target.reason = 'CAPTCHA detected but no solver configured';
  }
  continue; // Move to next target
}

// Continue with form submission
await page.click('button[type="submit"]');

// Check if CAPTCHA appears after submission
const postCaptcha = await captchaHandler.checkPostSubmitCaptcha(page);
if (postCaptcha.detected) {
  const handleResult = await captchaHandler.handleCaptcha(page);
  if (!handleResult.handled) {
    target.status = 'review';
    target.reason = 'Post-submit CAPTCHA failed';
  }
}
```

## API Endpoints Summary

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/captcha/config` | GET | Get current config | Required |
| `/api/captcha/config` | POST | Save/test API key | Required |
| `/api/captcha/queue` | GET | List all captchas | Required |
| `/api/captcha/queue` | DELETE | Remove from queue | Required |
| `/api/captcha/clear` | POST | Clear all captchas | Required |
| `/api/captcha/status` | GET | Check task status | Required |

**Auth Header:** `x-user-id` (your user identification)

## Features Breakdown

### Dashboard Components

**CaptchaSettings**
- Password input for 2Captcha API key
- Automatic connection test
- Status display (Active/Inactive/Error)
- Last test timestamp
- Instructions and documentation link

**CaptchaQueue**
- Real-time stats (total, pending, solving, solved, failed)
- Sortable table of captchas
- Status badges with colors
- Remove/Clear actions
- Auto-refresh every 5 seconds
- Clickable links to target websites

### Backend Services

**TwoCaptchaSolver**
- Detects captcha type and fetches sitekey
- Sends requests to 2Captcha API
- Polls for solution with exponential backoff
- Handles errors gracefully
- Tests API connectivity
- Reports incorrect solutions

**CaptchaStore**
- Manages database operations
- Stores API keys per user
- Tracks solve attempts and status
- Isolates data by user (license)
- Auto-cleanup of expired entries

**InquiryCaptchaHandler**
- Detects captchas on pages
- Integrates with form processing
- Manages solve/failure workflow
- Injects solutions into forms
- Checks for post-submission captchas

## Supported CAPTCHA Types

✅ **reCAPTCHA v2** (Checkbox & Invisible)
✅ **reCAPTCHA v3** (Invisible, score-based)
✅ **Cloudflare Turnstile**
✅ **hCaptcha**
✅ **Image CAPTCHAs**

## Data Flow

```
1. User enters 2Captcha API key in dashboard
   ↓
2. System tests connection (GET /api/captcha/config)
   ↓
3. Key is saved to database (CaptchaConfig)
   ↓
4. Inquiry run starts
   ↓
5. Worker detects CAPTCHA on target website
   ↓
6. Entry queued in database (CaptchaQueue)
   ↓
7. TwoCaptchaSolver sends to 2Captcha API
   ↓
8. System polls for solution (exponential backoff)
   ↓
9. Solution injected into form
   ↓
10. Form submitted
   ↓
11. Queue entry updated with status (solved/failed)
   ↓
12. Dashboard shows live status in CAPTCHA Queue tab
```

## Per-License Isolation

Each user (license) has:
- Own `CaptchaConfig` record with API key
- Separate `CaptchaQueue` entries
- Independent solving status
- No data sharing between users

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| "Invalid API key" | Wrong/expired key | Update in settings |
| "Connection timeout" | Network issue | Check internet/proxy |
| "No sitekey found" | Detection failed | Manual review queue |
| "Solving timeout" | Service overload | Retry (automatic in queue) |
| "Rate limited" | Too many requests | Wait or upgrade 2Captcha plan |

### CAPTCHA Resolution Flow

```
CAPTCHA Detected
    ↓
Solver Configured?
    ├─ No → Queue for Review
    └─ Yes → Attempt Solve
           ↓
       Solution Success?
           ├─ Yes → Inject & Continue
           └─ No → Queue for Review + Log Error
```

## Cost Tracking

The `CaptchaQueue` includes a `cost` field for each solved CAPTCHA. You can:

1. **Query total costs**:
   ```typescript
   const costs = await prisma.captchaQueue.aggregate({
     where: { userId, status: 'solved' },
     _sum: { cost: true }
   });
   ```

2. **Show in dashboard**:
   ```tsx
   <p>Total CAPTCHA costs: ${costs._sum.cost || 0}</p>
   ```

3. **Bill users** if needed for 2Captcha consumption

## Testing

Test 2Captcha integration:

```bash
# 1. Start app
npm run dev

# 2. Go to dashboard → Inquiry → CAPTCHA Settings

# 3. Enter test API key (from 2captcha.com)

# 4. Click "Save & Test Connection"

# 5. Check CAPTCHA Queue section

# 6. Start an inquiry run

# 7. When a CAPTCHA is encountered, it should:
#    - Appear in the queue
#    - Show "solving" status
#    - Update to "solved" when complete
```

## Troubleshooting

**Queue not updating?**
- Check browser console for errors
- Verify API key is correct
- Check server logs for backend errors
- Ensure database migration completed

**Solver not working in inquiry run?**
- Check captcha config is saved
- Verify API key is active
- Check inquiry run logs
- Ensure CAPTCHA is properly detected

**High failure rates?**
- Check 2Captcha account balance
- Verify API key has API v2 enabled
- Check network connectivity
- Review error messages in queue

## Next Steps

1. ✅ Database schema added
2. ✅ API endpoints created
3. ✅ Dashboard UI components added
4. ✅ Integration handler ready
5. 🔲 Integrate into inquiry worker (your task)
6. 🔲 Test with real campaigns
7. 🔲 Monitor and optimize

## Files Added

```
apps/api/src/lib/
├── captcha-solver.ts          # 2Captcha API client
├── captcha-store.ts           # Database operations
└── inquiry-captcha-handler.ts # Inquiry integration

apps/api/src/app/api/captcha/
├── config/route.ts            # GET/POST config
├── queue/route.ts             # GET/DELETE queue
├── clear/route.ts             # POST clear
└── status/route.ts            # GET status

apps/web/src/components/
├── captcha-settings.tsx       # UI for API key
├── captcha-queue.tsx          # Live queue display
└── inquiry-captcha-integration.md # This guide

packages/db/prisma/
└── schema.prisma              # Added 2 models
```

## Support

For issues or questions:
1. Check this guide first
2. Review error logs in browser/server console
3. Test with 2Captcha demo endpoints
4. Refer to 2Captcha API docs: https://2captcha.com/api/v1
