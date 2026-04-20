/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static build — all data is precomputed into public/subgraphs/*.json
  // by scripts/build_subgraphs.mjs and served as static assets. No server code.
  output: 'export',
};

export default nextConfig;
