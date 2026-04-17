/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The large JSONL files live outside app/ at ../data/math.
  // They are read at request time by server code; never bundled.
};

export default nextConfig;
