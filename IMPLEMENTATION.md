# WeTransfer Campaign Manager - Implementation Guide

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- WeTransfer API key
- SMTP credentials

### Setup

1. **Clone and install**
```bash
git clone <repo>
cd 3D-Suite
npm install
```

2. **Configure environment**
```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

3. **Start services**
```bash
docker-compose up -d
npm run db:push
npm run dev
```

4. **Access**
- Frontend: http://localhost:3000
- API: http://localhost:3001

## Workflow

### Create Campaign
1. Go to /campaigns/create
2. Upload template PDF with placeholders like `{{email}}`, `{{company}}`
3. Define placeholder names

### Import Leads
1. Go to campaign details
2. Click "Import Leads"
3. Upload CSV with columns: email, name, company, referenceNumber

### Send Campaign
1. Click "Start Campaign"
2. System automatically processes each lead:
   - Creates temp email
   - Generates personalized PDF
   - Uploads to WeTransfer
   - Sends email with link
3. Monitor real-time progress

## Architecture

### Frontend (Next.js)
- Dashboard with real-time stats
- Campaign management UI
- Lead import/management
- Activity logs viewer

### Backend (Next.js API Routes)
- Campaign CRUD operations
- Lead import validation
- Queue management
- Activity logging

### Queue System (Bull/Redis)
- Processes leads sequentially
- Automatic retry on failure
- Graceful error handling
- Persistent job tracking

### Services
- **PDF Generation**: PDFKit for personalization
- **Email**: Nodemailer for sending links
- **WeTransfer**: Official API for file transfers
- **Temp Email**: TempMail or GuerrillaMail

## Database Schema

```sql
-- Campaigns
Campaign
  - id (PK)
  - userId (FK)
  - name, description
  - templatePdfUrl, placeholders
  - status (draft, active, completed, paused)
  - totalLeads, processedLeads, successLeads, failedLeads
  - createdAt, updatedAt

-- Leads
Lead
  - id (PK)
  - campaignId (FK)
  - email, name, company, referenceNumber
  - customFields (JSON)
  - status (pending, processing, sent, failed)
  - weTransferId, tempEmail, errorMessage
  - sentAt, createdAt, updatedAt

-- Logs
CampaignLog
  - id (PK)
  - campaignId (FK)
  - leadId (FK)
  - action (created_campaign, imported_leads, etc.)
  - status (success, error, warning, info)
  - details (JSON)
  - createdAt
```

## API Reference

### Campaigns

**Create Campaign**
```bash
POST /api/campaigns
Content-Type: application/json

{
  "name": "Q3 Campaign",
  "description": "Q3 product launch",
  "templatePdfUrl": "/uploads/template.pdf",
  "placeholders": ["email", "name", "company"]
}
```

**List Campaigns**
```bash
GET /api/campaigns
```

**Get Campaign Details**
```bash
GET /api/campaigns/{id}
```

**Start Campaign**
```bash
POST /api/campaigns/{id}/send
```

### Leads

**Import Leads**
```bash
POST /api/campaigns/{id}/leads
Content-Type: application/json

{
  "leads": [
    {
      "email": "john@example.com",
      "name": "John Doe",
      "company": "Acme Inc",
      "referenceNumber": "REF001"
    }
  ]
}
```

**Get Campaign Leads**
```bash
GET /api/campaigns/{id}/leads
```

### Logs

**Get Activity Logs**
```bash
GET /api/campaigns/{id}/logs?limit=100&offset=0
```

## Monitoring

### Real-time Dashboard
- Campaign statistics
- Lead status breakdown
- Success/failure rates
- Live activity feed

### Activity Logs
- Timestamp for each action
- Status (success/error/warning)
- Detailed error messages
- Performance metrics

## Troubleshooting

### Common Issues

**PDF Generation Fails**
- Check template PDF format
- Verify placeholders exist in template
- Check disk space for temp files

**Email Not Sending**
- Verify SMTP credentials
- Check firewall rules
- Verify sender email is authorized

**WeTransfer Upload Fails**
- Verify API key is valid
- Check file size limits
- Verify network connectivity

**Queue Not Processing**
- Check Redis connection
- Verify queue processor is running
- Check logs for errors

## Performance Tips

1. **Batch Processing**: Process up to 1000 leads per campaign
2. **Proxy Rotation**: Enable for IP-based rate limiting
3. **Caching**: Leverage Redis for temporary data
4. **Monitoring**: Set up alerts for failed jobs
5. **Scaling**: Use multiple queue workers for large campaigns

## Security

- Never commit `.env.local`
- Use environment variables for secrets
- Validate all CSV inputs
- Sanitize placeholder values
- Use HTTPS in production
- Implement rate limiting
- Add authentication to API

## Future Features

- [ ] Adobe integration
- [ ] QuickBooks integration
- [ ] Advanced scheduling
- [ ] Custom branding
- [ ] Multi-user support
- [ ] Webhook notifications
- [ ] Advanced analytics
- [ ] API key authentication

## Support

For issues or questions, open a GitHub issue.
