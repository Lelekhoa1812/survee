import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/forgot-password", "/join", "/oauth/", "/reset-password", "/signup", "/verify", "/verify-email"],
    },
    sitemap: "https://kqa-bay.vercel.app/sitemap.xml",
  };
}
