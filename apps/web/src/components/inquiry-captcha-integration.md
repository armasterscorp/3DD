# 2Captcha Integration for Inquiry Tab

## Overview

The 2Captcha integration automatically detects and solves CAPTCHAs during inquiry campaigns, separating them from the manual review queue.

## Components

### 1. CaptchaSettings Component
Location: `apps/web/src/components/captcha-settings.tsx`

Provides:
- API key input and validation
- Connection testing
- Status display
- Last test information

**Usage:**
```tsx
import { CaptchaSettings } from '@/components/captcha-settings';

<CaptchaSettings />
```

### 2. CaptchaQueue Component
Location: `apps/web/src/components/captcha-queue.tsx`

Provides:
- Real-time queue display
- Status tracking (pending, solving, solved, failed)
- Statistics dashboard
- Remove/clear actions
- Auto-refresh every 5 seconds

**Usage:**
```tsx
import { CaptchaQueue } from '@/components/captcha-queue';

<CaptchaQueue />
```

## API Endpoints

### Configuration

**GET /api/captcha/config**
- Get current captcha configuration
- Returns: `{ configured, isActive, lastTestAt, lastTestStatus, testError }`

**POST /api/captcha/config**
- Save/update 2Captcha API key
- Body: `{ apiKey: string }`
- Returns: `{ success, message, isActive }`

### Queue Management

**GET /api/captcha/queue**
- Get captcha queue for current user
- Returns: `{ items: [], stats: { total, pending, solving, solved, failed } }`

**DELETE /api/captcha/queue?id=<id>**
- Remove specific captcha from queue
- Returns: `{ success, message }`

**POST /api/captcha/clear**
- Clear all captchas for current user
- Returns: `{ success, message }`

**GET /api/captcha/status?taskId=<taskId>**
- Get status of a specific task
- Returns: `{ taskId, ... }`

## Backend Integration

### Services

**TwoCaptchaSolver** (`apps/api/src/lib/captcha-solver.ts`)
```typescript
const solver = new TwoCaptchaSolver(apiKey);

// Solve different captcha types
await solver.solveRecaptchaV2(url, siteKey);
await solver.solveRecaptchaV3(url, siteKey, minScore);
await solver.solveTurnstile(url, websiteKey);
await solver.solveImageCaptcha(base64Image, options);

// Test connection
await solver.testConnection();
```

**CaptchaStore** (`apps/api/src/lib/captcha-store.ts`)
```typescript
// Queue captcha for solving
await CaptchaStore.queueCaptcha({
  userId,
  inquiryRunId,
  targetUrl,
  captchaType,
  siteKey,
  websiteKey,
});

// Update status
await CaptchaStore.updateCaptchaQueue(id, {
  status: 'solved',
  solution: token,
  solvedAt: new Date(),
});
```

## Inquiry Worker Integration

In your inquiry backend worker, detect CAPTCHAs during form processing:

```typescript
import { TwoCaptchaSolver } from '@/lib/captcha-solver';
import { CaptchaStore } from '@/lib/captcha-store';

// 1. Check if captcha config exists
const config = await CaptchaStore.getCaptchaConfig(userId);
if (!config?.isActive) {
  // Queue for manual review
  return { status: 'review', reason: 'CAPTCHA - no solver configured' };
}

// 2. Detect CAPTCHA on page
if (await page.locator('[data-sitekey]').isVisible()) {
  const siteKey = await page.locator('[data-sitekey]').getAttribute('data-sitekey');
  const captchaType = 'recaptcha_v2';
  
  // 3. Queue in database
  const queueItem = await CaptchaStore.queueCaptcha({
    userId,
    inquiryRunId,
    targetUrl: page.url(),
    captchaType,
    siteKey,
  });
  
  try {
    // 4. Solve
    const solver = new TwoCaptchaSolver(config.apiKey);
    const token = await solver.solveRecaptchaV2(page.url(), siteKey);
    
    // 5. Update status
    await CaptchaStore.updateCaptchaQueue(queueItem.id, {
      status: 'solved',
      solution: token,
      solvedAt: new Date(),
    });
    
    // 6. Inject solution
    await page.evaluate((token) => {
      document.getElementById('g-recaptcha-response').value = token;
    }, token);
    
    // Continue form submission
  } catch (error) {
    // 7. Handle failure
    await CaptchaStore.updateCaptchaQueue(queueItem.id, {
      status: 'failed',
      error: error.message,
    });
    return { status: 'captcha', reason: 'Failed to solve CAPTCHA' };
  }
}
```

## Database Schema

### CaptchaConfig
```prisma
model CaptchaConfig {
  id            String   @id @default(cuid())
  userId        String   @unique
  apiKey        String
  isActive      Boolean  @default(false)
  lastTestAt    DateTime?
  lastTestStatus String?
  testError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### CaptchaQueue
```prisma
model CaptchaQueue {
  id            String   @id @default(cuid())
  userId        String
  inquiryRunId  String
  targetUrl     String
  captchaType   String   // recaptcha_v2, recaptcha_v3, turnstile, hcaptcha
  siteKey       String?
  websiteKey    String?
  minScore      Float?
  pageAction    String?
  taskId        String?  // 2Captcha task ID
  solution      String?  // Solved token
  status        String   @default("pending")
  attempts      Int      @default(0)
  error         String?
  cost          Float    @default(0)
  createdAt     DateTime @default(now())
  solvedAt      DateTime?
  expiresAt     DateTime // 7 days for cleanup
}
```

## Dashboard Integration

Add to your Inquiry settings in the dashboard:

```tsx
import { CaptchaSettings } from '@/components/captcha-settings';
import { CaptchaQueue } from '@/components/captcha-queue';

// In your dashboard page:
<div className="space-y-6">
  <CaptchaSettings />
  <CaptchaQueue />
</div>
```

## Key Features

✓ Per-license isolation - each user's API key is stored separately  
✓ Per-run tracking - monitor which CAPTCHAs are from which inquiry run  
✓ Automatic detection - reCAPTCHA v2, v3, Turnstile, hCaptcha, and image CAPTCHAs  
✓ Queue separation - CAPTCHAs are separate from manual review queue  
✓ Cost tracking - logs 2Captcha solving costs  
✓ Failure handling - failed CAPTCHAs marked for review  
✓ Auto-cleanup - queue entries expire after 7 days  
✓ Real-time monitoring - live queue status in dashboard  

## Error Handling

CAPTCHA solving failures result in:
1. Entry marked with status 'failed'
2. Error message logged
3. Target moved to review queue for manual inspection
4. Campaign continues to next target
5. User notified in dashboard
