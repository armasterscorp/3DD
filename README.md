# 3D Suite - WeTransfer Campaign Manager

A professional, production-ready system for sending personalized PDF files at scale via WeTransfer with real-time tracking and analytics.

## Features

✅ **Campaign Management**
- Create campaigns with template PDFs
- Define dynamic placeholders ({{email}}, {{company}}, etc.)
- Support for unlimited custom fields

✅ **Lead Management**
- Import leads from CSV
- Manual lead entry
- Automatic deduplication

✅ **Automated Processing**
- Generate personalized PDFs for each lead
- Create temporary email addresses (10-minute TTL)
- Automatic WeTransfer account creation
- Upload personalized files
- Send WeTransfer links via email

✅ **Real-time Dashboard**
- Live campaign monitoring
- Real-time lead status tracking
- Activity logs with detailed analytics
- Success rate metrics
- Error handling and retry logic

✅ **Enterprise Features**
- Proxy rotation support
- Queue-based processing (Bull/Redis)
- Comprehensive error logging
- PostgreSQL for data persistence
- TypeScript for type safety

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Node.js
- **Database**: PostgreSQL, Prisma ORM
- **Queue**: Bull (Redis)
- **PDF**: PDFKit
- **Email**: Nodemailer
- **File Upload**: Multer

## Project Structure

```
3D-Suite/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── src/app/
│   │   │   ├── dashboard/     # Dashboard page
│   │   │   ├── campaigns/     # Campaigns pages
│   │   │   └── api/           # API routes
│   │   └── src/components/    # UI components
│   └── api/                    # Backend API
│       └── src/
│           ├── app/api/       # API endpoints
│           └── lib/           # Core services
├── packages/
│   ├── db/                    # Prisma schema & migrations
│   └── shared/                # Shared types & utilities
├── docker-compose.yml
├── package.json (monorepo)
└── .env.example
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7

### Installation

```bash
# Clone repository
git clone <repo-url>
cd 3D-Suite

# Install dependencies
npm install

# Setup environment
cp .env.example .env.local

# Start Docker containers
docker-compose up -d

# Setup database
npm run db:push
npm run db:generate

# Start development
npm run dev
```

Access the application:
- Frontend: http://localhost:3000
- API: http://localhost:3001
- Prisma Studio: http://localhost:5555

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/3d_suite"

# WeTransfer API
WETRANSFER_API_KEY="your_api_key"
WETRANSFER_API_URL="https://api.wetransfer.com"

# Temporary Email Service
TEMP_EMAIL_PROVIDER="tempmail" # or guerrillamail

# Redis/Bull
REDIS_URL="redis://localhost:6379"

# Email Service (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your_email@gmail.com"
SMTP_PASSWORD="your_app_password"
SMTP_FROM="noreply@3dsuite.com"

# Proxy (Optional)
PROXY_ENABLED="false"
PROXY_LIST="proxy1.com:8080,proxy2.com:8080"
```

## API Endpoints

### Campaigns
- `GET /api/campaigns` - List all campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/[id]` - Get campaign details
- `PATCH /api/campaigns/[id]` - Update campaign
- `DELETE /api/campaigns/[id]` - Delete campaign
- `POST /api/campaigns/[id]/send` - Start sending campaign

### Leads
- `GET /api/campaigns/[id]/leads` - List campaign leads
- `POST /api/campaigns/[id]/leads` - Import leads

### Logs
- `GET /api/campaigns/[id]/logs` - Get campaign activity logs

### Health
- `GET /api/health` - Health check

## Local no-database mode

If `DATABASE_URL` is not configured (or DB connectivity fails), the API automatically runs in `local-memory` mode:
- `GET /api/health` returns `status: "degraded"` with `mode: "local-memory"` instead of hard-failing.
- Campaign create/update/import/start/stop flows remain usable with runtime in-memory state.
- Dashboard draft/provider session metadata and CSV import events are kept in memory for the current API process.
- In-memory data is reset when the API server restarts.

## Campaign Workflow

1. **Create Campaign**
   - Upload template PDF
   - Define placeholders (email, name, company, etc.)

2. **Import Leads**
   - Upload CSV or manually add leads
   - System validates and deduplicates

3. **Start Campaign**
   - System queues all leads for processing
   - Leads are processed sequentially

4. **Processing Per Lead**
   - Generate temporary email
   - Generate personalized PDF
   - Create WeTransfer transfer
   - Send WeTransfer link via email
   - Log all activities

5. **Monitor**
   - Real-time dashboard shows progress
   - View individual lead status
   - Check detailed activity logs

## Database Schema

### Main Tables
- `users` - Campaign creators
- `campaigns` - Campaign metadata and stats
- `leads` - Individual recipients
- `campaign_logs` - Activity audit trail
- `temporary_emails` - Temp email tracking
- `wetransfer_accounts` - WeTransfer account records

## Future Enhancements

- [ ] Adobe integration for advanced PDF manipulation
- [ ] QuickBooks integration for automation
- [ ] Advanced analytics and reporting
- [ ] Custom branding options
- [ ] API key authentication
- [ ] Multi-user support with roles
- [ ] Webhook support
- [ ] Scheduled campaigns

## Support

For issues or questions, please open a GitHub issue.

## License

MIT
