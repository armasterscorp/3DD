#!/bin/bash
echo "3D Suite Build"
echo "==============="
echo ""
echo "Installing dependencies..."
npm ci

echo ""
echo "Generating Prisma client..."
cd packages/db
npm run generate
cd ../..

echo ""
echo "Building packages..."
npm run build

echo ""
echo "Build complete!"
