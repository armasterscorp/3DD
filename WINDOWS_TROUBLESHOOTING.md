# Windows Troubleshooting Guide

## Common Issues & Solutions

### Docker Issues

#### "Docker daemon is not running"
**Symptoms:** `Cannot connect to Docker daemon`

**Solutions:**
1. Start Docker Desktop from Start Menu
2. Wait 30 seconds for it to fully start
3. Check system tray - Docker icon should be visible
4. Try again

#### "Docker command not found"
**Symptoms:** `docker: command not found` or `docker is not recognized`

**Solutions:**
1. Download Docker Desktop from docker.com
2. Run installer (requires Windows Pro/Enterprise or WSL2)
3. Restart computer
4. Try again

#### Containers won't start
**Symptoms:** `docker-compose up` fails

**Solutions:**
```powershell
# Stop all containers
docker-compose down

# Remove orphaned containers
docker container prune

# Restart Docker
Restart-Service Docker

# Try again
docker-compose up -d
```

#### PostgreSQL connection refused
**Symptoms:** `psql: could not translate host name "postgres" to address`

**Solutions:**
```powershell
# Check if postgres container is running
docker ps | findstr postgres

# If not running, restart it
docker-compose restart postgres

# Check logs
docker logs 3d-suite-postgres-1

# Verify connection string in .env.local
# DATABASE_URL="postgresql://user:password@localhost:5432/3d_suite"
```

---

### Node.js Issues

#### "npm: command not found"
**Symptoms:** `npm is not recognized as an internal or external command`

**Solutions:**
1. Download Node.js from nodejs.org (LTS version)
2. Run installer with default settings
3. Restart PowerShell/Command Prompt
4. Verify: `node --version` and `npm --version`

#### "npm install" fails
**Symptoms:** Various npm errors during install

**Solutions:**
```powershell
# Clear npm cache
npm cache clean --force

# Delete node_modules and lock file
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json

# Install fresh
npm install
```

#### Out of memory during build
**Symptoms:** `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed`

**Solutions:**
```powershell
# Increase Node heap size
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm install
```

---

### Port Issues

#### "Port already in use"
**Symptoms:** `Error: listen EADDRINUSE: address already in use :::7200`

**Solutions:**
```powershell
# Find what's using the port
Get-NetTCPConnection -LocalPort 7200

# Kill the process (replace PID with actual PID)
Stop-Process -Id <PID> -Force

# Or use different ports in .env.local
FRONTEND_PORT=7300
API_PORT=7301
```

#### "Cannot connect to localhost"
**Symptoms:** `ERR_CONNECTION_REFUSED` in browser

**Solutions:**
1. Ensure dev servers are running
2. Check port numbers in .env.local
3. Check firewall settings
4. Try `127.0.0.1` instead of `localhost`
5. Check browser console for errors

---

### Database Issues

#### "Database connection failed"
**Symptoms:** `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solutions:**
```powershell
# Check if database is running
docker ps | findstr postgres

# Start database
docker-compose restart postgres

# Wait 10 seconds and try again
Start-Sleep -Seconds 10
```

#### "FATAL: authentication failed for user"
**Symptoms:** PostgreSQL authentication error

**Solutions:**
1. Check credentials in .env.local
2. Verify DATABASE_URL format:
   ```
   postgresql://user:password@localhost:5432/3d_suite
   ```
3. Check docker-compose.yml for environment variables
4. Reset database:
   ```powershell
   docker-compose down -v  # -v removes volumes
   docker-compose up -d
   ```

#### "relation doesn't exist"
**Symptoms:** `error: relation "public.Campaign" does not exist`

**Solutions:**
```powershell
# Regenerate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Or reset database
npm run db:reset
```

---

### Redis Issues

#### "Redis connection refused"
**Symptoms:** `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Solutions:**
```powershell
# Check if Redis is running
docker ps | findstr redis

# Restart Redis
docker-compose restart redis

# If that doesn't work
docker-compose down
docker-compose up -d redis
```

---

### Frontend Issues

#### "Module not found" errors
**Symptoms:** `Cannot find module '@/components/ui/button'`

**Solutions:**
```powershell
# Regenerate dependencies
rm -r node_modules
npm install

# Restart dev server
# Kill terminal (Ctrl+C) and restart
```

#### Page not loading or blank
**Symptoms:** White screen or errors in console

**Solutions:**
1. Check browser console (F12)
2. Look for JavaScript errors
3. Check network tab for failed requests
4. Hard refresh (Ctrl+Shift+R)
5. Check that API is running on port 7201

#### CSS not loading
**Symptoms:** Unstyled page

**Solutions:**
```powershell
# Restart dev server
# Delete .next folder
rm -r apps/web/.next

# Restart
npm run dev:web
```

---

### API Issues

#### "Cannot find module" errors
**Symptoms:** Module not found when starting API

**Solutions:**
```powershell
# Regenerate Prisma
npm run db:generate

# Reinstall dependencies
rm -r node_modules
npm install

# Restart API
```

#### API endpoints return 500 errors
**Symptoms:** Internal Server Error

**Solutions:**
1. Check terminal for error messages
2. Check .env.local configuration
3. Verify database connection
4. Check API logs: `curl http://localhost:7201/api/health`

---

### File Permission Issues

#### "Permission denied" when creating files
**Symptoms:** `Error: EACCES: permission denied`

**Solutions:**
1. Run PowerShell as Administrator
2. Check file permissions
3. Disable antivirus temporarily
4. Try different directory (C:\dev instead of Program Files)

---

### Network Issues

#### Cannot access from other computer
**Symptoms:** `localhost:7200` works but `192.168.x.x:7200` doesn't

**Solutions:**
1. Update .env.local to bind to all interfaces
2. Check firewall rules
3. Check network sharing settings

---

### Useful Debugging Commands

```powershell
# Check all services
docker ps
docker ps -a  # including stopped

# View logs
docker logs <container-name>
docker logs -f <container-name>  # follow logs

# Check running processes on ports
netstat -ano
Get-NetTCPConnection

# Check disk space
dir C:\

# Check environment variables
$env:DATABASE_URL
$env:NODE_ENV

# Test connectivity
Test-NetConnection localhost -Port 7200

# Clear cache
npm cache clean --force
pip cache purge  # for Python if needed

# Check system resources
Get-Process | Sort-Object CPU -Descending | Select-Object Name, CPU, Memory -First 10
```

---

### Getting Help

1. **Check logs first**
   ```powershell
   docker-compose logs
   # Check terminal output
   ```

2. **Search error message**
   - Copy full error message
   - Search on Google
   - Check GitHub Issues

3. **Ask for help**
   - Provide error message
   - Include output of `npm --version`, `node --version`, `docker --version`
   - Include relevant .env.local settings (no secrets)
   - Include full command you ran

---

## Reset Everything

If everything is broken:

```powershell
# Stop all services
docker-compose down -v  # -v removes volumes (deletes database)

# Clean up
rm -r node_modules .next apps/*/.next

# Start fresh
npm install
docker-compose up -d
npm run db:push

# Run tests
node test-setup.js
```

This will reset everything to a clean state.
