/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: ['@3d-suite/db', '@3d-suite/shared'],
};

module.exports = nextConfig;
