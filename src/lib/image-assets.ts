export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
export const IMAGE_ASSET_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml";

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
