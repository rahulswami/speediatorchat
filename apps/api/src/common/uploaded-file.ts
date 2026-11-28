import { BadRequestException } from '@nestjs/common';
import type { MediaFormat } from '@speediator/types';

/** Raw uploads (application/octet-stream) are capped here and in the body parser. */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

// Types both Meta's upload APIs accept for template headers, with Meta's size limits.
const ALLOWED: Record<string, { format: MediaFormat; maxBytes: number }> = {
  'image/jpeg': { format: 'IMAGE', maxBytes: 5 * 1024 * 1024 },
  'image/png': { format: 'IMAGE', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { format: 'VIDEO', maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { format: 'DOCUMENT', maxBytes: MAX_UPLOAD_BYTES },
};

export interface UploadedFile {
  fileName: string;
  fileType: string;
  format: MediaFormat;
  bytes: Uint8Array<ArrayBuffer>;
}

export function readUploadedFile(
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
): UploadedFile {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new BadRequestException('Send the file as the request body (application/octet-stream)');
  }
  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const fileType = (header('x-file-type') ?? '').toLowerCase();
  const allowed = ALLOWED[fileType];
  if (!allowed) throw new BadRequestException('Use a JPG or PNG image, an MP4 video or a PDF document');
  if (body.length > allowed.maxBytes) {
    throw new BadRequestException(`That file is too large. The limit is ${allowed.maxBytes / 1024 / 1024} MB.`);
  }

  let fileName = 'file';
  try {
    fileName = decodeURIComponent(header('x-file-name') ?? 'file');
  } catch {
    // Keep the generic name if the header isn't valid URI encoding.
  }
  fileName = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'file';

  return { fileName, fileType, format: allowed.format, bytes: new Uint8Array(body) };
}
