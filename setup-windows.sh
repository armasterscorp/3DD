#!/bin/bash
# Windows setup script - Run in Git Bash or PowerShell

echo "====================================="
echo "3D Suite - Windows Development Setup"
echo "====================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install from nodejs.org"
    exit 1
fi
echo "✓ Node.js $(node --version)"

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker Desktop from docker.com"
    exit 1
fi
echo "✓ Docker $(docker --version)"

if ! command -v git &> /dev/null; then
    echo "❌ Git not found. Please install from git-scm.com"
    exit 1
fi
echo "✓ Git $(git --version)"

echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "Starting Docker services..."
docker-compose up -d

echo ""
echo "Waiting for services to be ready..."
sleep 10

echo ""
echo "Setting up database..."
npm run db:generate
npm run db:push

echo ""
echo "====================================="
echo "✅ Setup Complete!"
echo "====================================="
echo ""
echo "To start development, run:"
echo ""
echo "  npm run dev:windows"
echo ""
echo "Access the application at:"
echo "  Frontend: http://localhost:7200"
echo "  API:      http://localhost:7201"
echo "  Database: npm run db:studio"
echo ""
