/**
 * CAPTCHA Integration - Dashboard Integration Instructions
 * 
 * To add the CAPTCHA settings to your dashboard:
 * 
 * 1. Import components at top of apps/web/src/app/dashboard/page.tsx:
 */

// Add these imports
import { CaptchaSettings } from '@/components/captcha-settings';
import { CaptchaQueue } from '@/components/captcha-queue';

/*
 * 2. In your Inquiry settings/configuration section, add:
 */

{/* ===== CAPTCHA CONFIGURATION SECTION ===== */}
<div className="mb-8 border-t pt-8">
  <h3 className="text-2xl font-bold text-gray-900 mb-6">CAPTCHA Solving</h3>
  <div className="space-y-6">
    <CaptchaSettings />
    <CaptchaQueue />
  </div>
</div>

/*
 * 3. If using tabs (Inquiry / Gmail / Adobe / etc), add a new tab:
 * 
 * Add to your tab configuration:
 */

{
  label: 'CAPTCHA',
  id: 'captcha',
  icon: '🤖', // or use lucide-react icons
  content: (
    <div className="p-6 space-y-6">
      <CaptchaSettings />
      <CaptchaQueue />
    </div>
  )
}

/*
 * 4. Ensure you're passing x-user-id header in your API calls:
 */

// In apps/web/src/lib/ or wherever you configure axios:
const axiosInstance = axios.create({
  // ... other config
  headers: {
    'x-user-id': userId, // Your user ID from session/auth
  },
});

// Or add interceptor:
axiosInstance.interceptors.request.use((config) => {
  config.headers['x-user-id'] = getUserId(); // Get from your auth system
  return config;
});

/*
 * 5. Make sure components can access axios with headers.
 *    If using global axios, update in the components:
 */

// In captcha-settings.tsx and captcha-queue.tsx, update axios calls:
const response = await axios.get('/api/captcha/config', {
  headers: {
    'x-user-id': getUserId(), // Your auth function
  },
});

// OR configure axios globally once
axios.defaults.headers.common['x-user-id'] = getUserId();

/*
 * Complete Example: Adding to Inquiry Tab in Dashboard
 * ==============================================
 * 
 * In your tabs configuration:
 */

const inquiryTab = {
  label: 'Inquiry',
  id: 'inquiry',
  content: (
    <div className="space-y-8">
      {/* Existing inquiry configuration */}
      <section>
        <h3 className="text-xl font-bold mb-4">Inquiry Settings</h3>
        {/* Your existing settings */}
      </section>

      {/* NEW: CAPTCHA Configuration */}
      <section className="border-t pt-8">
        <CaptchaSettings />
      </section>

      {/* NEW: CAPTCHA Queue Monitoring */}
      <section>
        <CaptchaQueue />
      </section>
    </div>
  ),
};
