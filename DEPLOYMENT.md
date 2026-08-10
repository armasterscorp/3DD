# 3D Suite Deployment Guide

## Local Development

```bash
npm install
docker-compose up
npm run db:push
npm run dev
```

## Docker Production

### Build Images
```bash
docker-compose -f docker-compose.prod.yml build
```

### Start Services
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Vercel Deployment (Frontend)

```bash
# Connect GitHub repo to Vercel
# Set environment variables in Vercel dashboard
vercel env add DATABASE_URL
vercel env add NEXT_PUBLIC_API_URL

# Deploy
vercel deploy --prod
```

## Railway/Render Deployment (API)

1. Create account on Railway or Render
2. Connect GitHub repo
3. Set environment variables
4. Deploy

## Environment Variables (Production)

```env
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# WeTransfer
WETRANSFER_API_KEY=your_key
WETRANSFER_API_URL=https://api.wetransfer.com

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASSWORD=your_password
SMTP_FROM=noreply@3dsuite.com

# Redis
REDIS_URL=redis://user:pass@host:6379

# Monitoring
SENTRY_DSN=your_sentry_dsn
```

## Monitoring & Logging

### Health Checks
```bash
curl http://localhost:3001/api/health
```

### Queue Status
```bash
# Access Bull dashboard (add bull-board middleware)
http://localhost:3001/admin/queues
```

### Database
```bash
npm run db:studio
```

## Backup Strategy

- PostgreSQL: Daily snapshots
- Redis: Persistence enabled
- PDF uploads: Cloud storage (S3/GCS)

## Scaling

1. **Horizontal**: Deploy multiple queue workers
2. **Vertical**: Increase server resources
3. **Caching**: Redis for frequent queries
4. **Database**: Connection pooling, read replicas

## Maintenance

- Weekly logs cleanup
- Monthly database optimization
- Security updates
- Dependency updates (monthly)

## Disaster Recovery

- Database backups: Hourly
- Backup retention: 30 days
- Restore testing: Monthly
- Failover plan: Documented
