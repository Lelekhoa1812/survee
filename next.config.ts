import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The docs are read from disk at request time, so make sure they ship with the serverless bundle.
  outputFileTracingIncludes: {
    "/admin/docs/[[...slug]]": ["./docs/**/*"],
    "/api/docs/[...name]": ["./docs/**/*"],
  },
  serverExternalPackages: ["mongodb", "exceljs", "parse5", "nodemailer", "imapflow"],
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata?kind=resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata?kind=resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata?kind=as" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata?kind=as" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata?kind=as" },
      { source: "/.well-known/openid-configuration/:path*", destination: "/api/oauth/metadata?kind=as" },
    ];
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      // Pages and APIs may not be embedded anywhere. Questionnaire frame routes set their own policy.
      { source: "/((?!api/frame|api/admin/frame|api/admin/previews/|api/docs).*)", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    ];
  },
};

export default config;
