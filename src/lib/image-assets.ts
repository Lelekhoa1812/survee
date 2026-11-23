export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Hard per-workspace ceiling for stored image data (100 MiB). */
export const WORKSPACE_IMAGE_QUOTA_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
export const IMAGE_ASSET_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml";

/** Public IDs embedded in survee asset URLs. */
export function imageAssetPublicIds(html: string): string[] {
  const ids = new Set<string>();
  const pattern = /\/api\/assets\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
  for (const match of html.matchAll(pattern)) ids.add(match[1]);
  return [...ids];
}

export interface ImageAssetSummary {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}
