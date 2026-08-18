/**
 * Cloudinary image storage — signed direct uploads.
 *
 * The API secret never leaves the server. The client asks us to sign an
 * upload; we return a short-lived signature and the client PUTs the file
 * straight to Cloudinary, so image bytes never pass through our (small) box.
 * A no-op with a clear flag until credentials are set.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';

export function uploadsEnabled(): boolean {
  const c = config.cloudinary;
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

/** Folders keep the media library tidy and let us scope what each caller can write. */
export type UploadFolder =
  | 'eventana/receipts'
  | 'eventana/themes'
  | 'eventana/designs'
  | 'eventana/setup-photos'
  | 'eventana/customers';

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
}

/**
 * Signs an upload for a folder. Cloudinary's rule: SHA-1 of the
 * alphabetically-sorted params (`folder`, `timestamp`) as `k=v&k2=v2`, with
 * the API secret appended — hex digest.
 */
export function signUpload(folder: UploadFolder): SignedUpload | null {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex');

  return {
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
  };
}
