/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hosts allowed to load the dev server's internal /_next/* resources (HMR,
  // etc.) from a non-localhost origin. Without this, opening the app via the
  // LAN "Network" URL is blocked by Next's cross-origin dev guard. localhost /
  // 127.0.0.1 are always allowed; add other hosts/IPs you browse the dev app from.
  allowedDevOrigins: ["192.168.56.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
