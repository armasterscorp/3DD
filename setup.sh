#!/bin/bash
set -e

echo "Installing dependencies..."
npm install

echo "Setting up database..."
cd packages/db
npm run generate
cd ../..

echo "Building projects..."
npm run build

echo "Setup complete!"
echo ""
echo "To start development:"
echo "1. Start Docker containers: docker-compose up"
echo "2. Run migrations: npm run db:push"
echo "3. Start dev server: npm run dev"
echo ""
echo "Frontend: http://localhost:3000"
echo "API: http://localhost:3001"
