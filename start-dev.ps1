#!/usr/bin/env powershell
# Windows-specific development startup script

Write-Host ""
Write-Host "====================================="
Write-Host "3D Suite - Windows Development Setup" -ForegroundColor Cyan
Write-Host "====================================="
Write-Host ""

# Colors for output
$ErrorColor = "Red"
$SuccessColor = "Green"
$InfoColor = "Cyan"
$WarningColor = "Yellow"

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "❌ .env.local not found" -ForegroundColor $ErrorColor
    Write-Host "Creating .env.local from .env.example..." -ForegroundColor $InfoColor
    Copy-Item ".env.example" -Destination ".env.local"
    Write-Host "✅ .env.local created. Please edit it with your configuration." -ForegroundColor $SuccessColor
    Write-Host ""
}

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor $InfoColor
try {
    $dockerVersion = docker --version
    Write-Host "✅ $dockerVersion" -ForegroundColor $SuccessColor
} catch {
    Write-Host "❌ Docker not found or not running" -ForegroundColor $ErrorColor
    Write-Host "Please start Docker Desktop" -ForegroundColor $WarningColor
    exit 1
}

# Check Node
Write-Host "Checking Node.js..." -ForegroundColor $InfoColor
try {
    $nodeVersion = node --version
    Write-Host "✅ Node $nodeVersion" -ForegroundColor $SuccessColor
} catch {
    Write-Host "❌ Node.js not found" -ForegroundColor $ErrorColor
    exit 1
}

Write-Host ""

# Start Docker containers
Write-Host "Starting Docker containers..." -ForegroundColor $InfoColor
docker-compose up -d
Write-Host "✅ Docker containers started" -ForegroundColor $SuccessColor

Write-Host ""
Write-Host "Waiting for services to be ready..." -ForegroundColor $InfoColor
Start-Sleep -Seconds 5

# Display information
Write-Host ""
Write-Host "====================================="
Write-Host "✅ Setup Complete!" -ForegroundColor $SuccessColor
Write-Host "====================================="
Write-Host ""

Write-Host "Next steps:" -ForegroundColor $InfoColor
Write-Host ""
Write-Host "1. Open 3 PowerShell windows" -ForegroundColor $WarningColor
Write-Host ""
Write-Host "   Terminal 1 - Frontend:" -ForegroundColor $InfoColor
Write-Host "   npm run dev:web" -ForegroundColor $WarningColor
Write-Host ""
Write-Host "   Terminal 2 - API:" -ForegroundColor $InfoColor
Write-Host "   npm run dev:api" -ForegroundColor $WarningColor
Write-Host ""
Write-Host "   Terminal 3 - Optional (Queue):" -ForegroundColor $InfoColor
Write-Host "   npm run queue:process" -ForegroundColor $WarningColor
Write-Host ""
Write-Host "   OR run all at once:" -ForegroundColor $InfoColor
Write-Host "   npm run dev:windows" -ForegroundColor $WarningColor
Write-Host ""

Write-Host "2. Access the application:" -ForegroundColor $InfoColor
Write-Host "   Frontend: http://localhost:7200" -ForegroundColor $WarningColor
Write-Host "   API:      http://localhost:7201" -ForegroundColor $WarningColor
Write-Host "   Database: http://localhost:5555" -ForegroundColor $WarningColor
Write-Host ""

Write-Host "3. View logs:" -ForegroundColor $InfoColor
Write-Host "   docker-compose logs -f" -ForegroundColor $WarningColor
Write-Host ""

Write-Host "Happy developing! 🚀" -ForegroundColor $SuccessColor
Write-Host ""
