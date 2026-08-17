/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  devIndicators: false,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
