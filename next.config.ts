import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The docs are read from disk at request time, so make sure they ship with the serverless bundle.
  outputFileTracingIncludes: {
    "/admin/docs/[[...slug]]": ["./docs/**/*"],
    "/api/docs/[...name]": ["./docs/**/*"],
  },
  serverExternalPackages: ["mongodb", "exceljs", "parse5"],
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      // Pages and APIs may not be embedded anywhere. The two questionnaire frame routes set their own policy.
      { source: "/((?!api/frame|api/admin/frame|api/docs).*)", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    ];
  },
};

export default config;
