# Windows Development Setup Guide

## Prerequisites

### 1. Install Required Software

#### Node.js
- Download from [nodejs.org](https://nodejs.org/) (LTS version 18+)
- Run installer and follow prompts
- Verify installation:
```bash
node --version
npm --version
```

#### Git
- Download from [git-scm.com](https://git-scm.com/)
- Run installer with default settings
- Verify:
```bash
git --version
```

#### Docker Desktop
- Download from [docker.com](https://www.docker.com/products/docker-desktop)
- Run installer
- Restart computer when prompted
- Verify:
```bash
docker --version
docker-compose --version
```

#### Visual Studio Code (Optional but recommended)
- Download from [code.visualstudio.com](https://code.visualstudio.com/)
- Extensions: Prisma, Thunder Client (for API testing)

### 2. Verify Docker is Running

Open PowerShell and run:
```powershell
docker run hello-world
```

If this works, Docker is properly installed.

## Setup Steps

### Step 1: Clone Repository

```powershell
# Open PowerShell and navigate to desired directory
cd C:\Users\YourUsername\Projects

# Clone repo
git clone https://github.com/emilysanders0018/3D-Suite.git
cd 3D-Suite

# Switch to feature branch
git checkout feat/wetransfer-campaign-manager
```

### Step 2: Configure Environment Variables

```powershell
# Copy example env file
Copy-Item .env.example -Destination .env.local
```

Open `.env.local` in VS Code and update:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/3d_suite"

# Ports (CUSTOM - NON-STANDARD)
FRONTEND_PORT=7200
API_PORT=7201

# WeTransfer API
WETRANSFER_API_KEY="your_wetransfer_api_key_here"
WETRANSFER_API_URL="https://api.wetransfer.com"

# Temporary Email Service
TEMP_EMAIL_PROVIDER="tempmail"

# Redis/Bull Queue
REDIS_URL="redis://localhost:6379"

# Email Service (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your_email@gmail.com"
SMTP_PASSWORD="your_app_password"
SMTP_FROM="noreply@3dsuite.com"

# Proxy (Optional)
PROXY_ENABLED="false"

# General
NODE_ENV="development"
NEXT_PUBLIC_API_URL="http://localhost:7201"
```

**Important Notes:**
- For Gmail SMTP, use [App Passwords](https://support.google.com/accounts/answer/185833)
- For WeTransfer, get API key from [wetransfer.com/developers](https://wetransfer.com/developers)
- Temp email services work automatically (no configuration needed)

### Step 3: Install Dependencies

```powershell
# Install all packages
npm install

# This will install monorepo dependencies
# Takes 2-5 minutes
```

### Step 4: Start Docker Services

```powershell
# Start PostgreSQL and Redis in background
docker-compose up -d

# Verify services are running
docker ps

# You should see postgres and redis containers
```

### Step 5: Setup Database

```powershell
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Seed data (optional)
# npm run db:seed
```

### Step 6: Update Next.js Configuration

Edit `apps/web/next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@3d-suite/db', '@3d-suite/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7201',
  },
};

module.exports = nextConfig;
```

Edit `apps/api/next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@3d-suite/db', '@3d-suite/shared'],
};

module.exports = nextConfig;
```

### Step 7: Update Package.json Scripts

Edit `package.json` in root:
```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "dev:web": "npm run dev --workspace=@3d-suite/web -- -p 7200",
    "dev:api": "npm run dev --workspace=@3d-suite/api -- -p 7201",
    "dev:windows": "npm run dev:web & npm run dev:api",
    "build": "turbo run build",
    "start": "turbo run start",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "db:push": "cd packages/db && prisma db push",
    "db:generate": "cd packages/db && prisma generate",
    "db:studio": "cd packages/db && prisma studio"
  }
}
```

### Step 8: Start Development Servers

#### Option A: Run Both in One Command (Recommended)

```powershell
npm run dev:windows
```

#### Option B: Run Separately in Different PowerShell Windows

```powershell
# Terminal 1: Start Frontend
npm run dev:web

# Terminal 2: Start API
npm run dev:api

# Terminal 3 (Optional): Start Queue Processor
# npm run queue:process
```

#### Option C: Using Turbo (All in One Window)

```powershell
npm run dev
```

## Verify Setup

### Check Frontend
Open browser: **http://localhost:7200**
- Should see 3D Suite homepage
- Click "Get Started" or "Dashboard"

### Check API
Open browser: **http://localhost:7201/api/health**
- Should return JSON: `{ "status": "ok", "timestamp": "..." }`

### Check Database
```powershell
npm run db:studio

# Opens http://localhost:5555
# You can view and edit database records
```

## Testing Workflow

### 1. Create a Test Campaign
1. Go to http://localhost:7200/campaigns/create
2. Fill in:
   - Campaign Name: "Test Campaign"
   - Description: "Testing WeTransfer integration"
   - Placeholders: `email, name, company`
3. Upload a test PDF (any PDF file)
4. Click "Create Campaign"

### 2. Import Test Leads
1. Go back to campaign
2. Click "Import Leads" tab
3. Use this CSV format:
```csv
email,name,company,referenceNumber
john@example.com,John Doe,Acme Inc,REF001
jane@example.com,Jane Smith,Tech Corp,REF002
bob@example.com,Bob Johnson,StartUp LLC,REF003
```
4. Submit the form

### 3. Start Campaign
1. Click "Start Campaign" button
2. Monitor real-time progress on dashboard
3. Check logs for detailed activity

## Troubleshooting

### Issue: "Docker daemon is not running"
**Solution:**
```powershell
# Start Docker Desktop
# Or restart Docker service
Restart-Service Docker
```

### Issue: "Port 7200/7201 already in use"
**Solution:**
Change ports in `.env.local`:
```env
FRONTEND_PORT=7300
API_PORT=7301
NEXT_PUBLIC_API_URL="http://localhost:7301"
```

### Issue: "npm ERR! code E401 Unauthorized"
**Solution:**
```powershell
npm login
# Or clear cache
npm cache clean --force
npm install
```

### Issue: "PostgreSQL connection refused"
**Solution:**
```powershell
# Check if container is running
docker ps

# If not, restart
docker-compose restart postgres

# Check logs
docker logs 3d-suite-postgres-1
```

### Issue: "Redis connection refused"
**Solution:**
```powershell
# Restart Redis
docker-compose restart redis

# Or recreate
docker-compose down
docker-compose up -d
```

### Issue: "Module not found" errors
**Solution:**
```powershell
# Clean install
rm -r node_modules package-lock.json
npm install

# Regenerate Prisma
npm run db:generate
```

## Development Tips

### Hot Reload
- Frontend changes auto-reload (Next.js)
- API changes auto-reload (Next.js)
- Database schema changes: `npm run db:push`

### Debugging
- Chrome DevTools: F12
- API debugging: Use Thunder Client or Postman
- Database: `npm run db:studio`
- Server logs: Check terminal

### Testing API Endpoints

Install Thunder Client extension in VS Code:

```
GET http://localhost:7201/api/health

GET http://localhost:7201/api/campaigns

POST http://localhost:7201/api/campaigns
Content-Type: application/json

{
  "name": "Test",
  "templatePdfUrl": "/test.pdf",
  "placeholders": ["email", "name"],
  "userId": "test-user"
}
```

## Stopping Development

```powershell
# Stop all dev servers (Ctrl+C in each terminal)

# Keep Docker running (recommended)
# Or stop Docker
docker-compose down

# Stop Docker Desktop
# Via system tray or Task Manager
```

## Next Steps After Setup

1. **Configure WeTransfer API**
   - Get API key from WeTransfer
   - Add to .env.local
   - Test with sample campaign

2. **Setup Email Service**
   - Configure Gmail or other SMTP
   - Get app password
   - Test email sending

3. **Create Sample Data**
   - Create test campaigns
   - Import test leads
   - Run through workflow

4. **Review Code**
   - Check database schema: `packages/db/prisma/schema.prisma`
   - Review API routes: `apps/api/src/app/api/`
   - Check frontend: `apps/web/src/app/`

## Performance Notes

- **Initial build**: 2-3 minutes
- **Dev server startup**: 30-60 seconds
- **Hot reload**: 2-5 seconds
- **Database operations**: <1 second
- **PDF generation**: 1-2 seconds per lead

## Security Reminders

⚠️ **Never commit .env.local to git**

Keep sensitive data secure:
- API keys
- SMTP passwords
- Database passwords
- Access tokens

Use `.gitignore` (already configured)

## Production Migration

When ready for production:

1. Deploy frontend to Vercel
2. Deploy API to Railway/Render
3. Use managed PostgreSQL
4. Use managed Redis
5. Configure custom domain
6. Setup SSL/TLS
7. Configure monitoring

See `DEPLOYMENT.md` for details.

## Support

If you encounter issues:

1. Check logs in terminal
2. Check `docker logs <container-name>`
3. Review error messages
4. Try restarting services
5. Open GitHub issue with details

Good luck with your development! 🚀
