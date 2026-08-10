# 3D Suite Development Ports

## Windows Development Ports (Custom - Non-Standard)

We use non-standard ports to avoid conflicts with common services:

| Service | Port | URL | Purpose |
|---------|------|-----|----------|
| Frontend | **7200** | http://localhost:7200 | Next.js Frontend App |
| API | **7201** | http://localhost:7201 | Backend API Routes |
| PostgreSQL | 5432 | localhost:5432 | Database (Internal) |
| Redis | 6379 | localhost:6379 | Queue System (Internal) |
| Prisma Studio | 5555 | http://localhost:5555 | Database Management |

## Why These Ports?

- **7200-7299 range**: Uncommon, rarely used by other applications
- **Avoids conflicts**: Port 3000/3001 often used by other dev servers
- **Windows friendly**: No permission issues
- **Easy to remember**: Sequential numbers

## Changing Ports

To use different ports, edit `.env.local`:

```env
FRONTEND_PORT=8200
API_PORT=8201
NEXT_PUBLIC_API_URL="http://localhost:8201"
```

Then update `next.config.js` in each app:

```javascript
// apps/web/next.config.js
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: 'http://localhost:8201',
  },
};
```

## Port Reference Guide

### Common Ports (Avoid These)
- 80: HTTP
- 443: HTTPS
- 3000: Common dev port
- 3001: Common alternative dev port
- 5000: Flask, other servers
- 8000: Django, other servers
- 8080: Many services
- 9000: SonarQube, other services

### Safe Port Ranges for Development
- 7200-7299
- 8200-8299
- 9200-9299
- 5001-5099
- 5555+

## Docker Port Mapping

Docker services are only accessible internally within containers. Expose additional ports in `docker-compose.yml` if needed:

```yaml
services:
  postgres:
    ports:
      - "5432:5432"  # External:Internal
  redis:
    ports:
      - "6379:6379"
```

## Network Communication

### Frontend → API
```
http://localhost:7200 → http://localhost:7201/api
```

Configured in `apps/web/src/lib/api.ts`:
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7201';
```

### API → Database
```
http://localhost:7201 → postgresql://localhost:5432
```

Configured in `.env.local`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/3d_suite"
```

## Troubleshooting Port Issues

### Check if Port is In Use

**PowerShell:**
```powershell
Get-NetTCPConnection -LocalPort 7200
```

**Command Prompt:**
```cmd
netstat -ano | findstr :7200
```

### Kill Process Using Port

**PowerShell:**
```powershell
Stop-Process -Id <PID> -Force
```

**Command Prompt:**
```cmd
taskkill /PID <PID> /F
```

## Firewall Rules

If you can't access services:

1. Open Windows Defender Firewall
2. Click "Allow an app through firewall"
3. Find Node.js or npm
4. Ensure "Private" is checked

Or allow ports:
```powershell
New-NetFirewallRule -DisplayName "Allow Port 7200" -Direction Inbound -LocalPort 7200 -Action Allow -Protocol TCP
New-NetFirewallRule -DisplayName "Allow Port 7201" -Direction Inbound -LocalPort 7201 -Action Allow -Protocol TCP
```

## Production Ports

For production deployment:
- Frontend: Port 80/443 (via CDN/load balancer)
- API: Port 80/443 (via reverse proxy)
- Internal services: Private network

See `DEPLOYMENT.md` for production setup.
