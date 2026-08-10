#!/bin/bash
set -e

echo "🚀 Starting 3D Suite..."

# Start PostgreSQL
echo "📦 Starting PostgreSQL..."
docker-compose up -d postgres

# Start Redis
echo "🔴 Starting Redis..."
docker-compose up -d redis

# Wait for services to be ready
echo "⏳ Waiting for services..."
sleep 5

# Run migrations
echo "🗄️  Running database migrations..."
cd packages/db
npm run push || true
cd ../..

# Start development servers in background
echo "🔵 Starting frontend (port 3000)..."
npm run --workspace=@3d-suite/web dev &
FRONTEND_PID=$!

echo "🟢 Starting API (port 3001)..."
npm run --workspace=@3d-suite/api dev &
API_PID=$!

echo "⚙️  Starting queue processor..."
node apps/api/dist/queue/processor.js &
QUEUE_PID=$!

echo ""
echo "✅ 3D Suite is running!"
echo ""
echo "📍 Frontend: http://localhost:3000"
echo "📍 API: http://localhost:3001"
echo "📍 Prisma Studio: npm run db:studio"
echo ""
echo "Press Ctrl+C to stop all services..."
echo ""

# Wait for all processes
wait
