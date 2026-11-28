/** Sends a file as the raw request body, the way the API's upload endpoints expect it. */
export async function uploadFile<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type,
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Upload failed');
  return data as T;
}

export const MEDIA_ACCEPT: Record<'IMAGE' | 'VIDEO' | 'DOCUMENT', { accept: string; hint: string }> = {
  IMAGE: { accept: 'image/jpeg,image/png', hint: 'JPG or PNG, up to 5 MB' },
  VIDEO: { accept: 'video/mp4', hint: 'MP4, up to 16 MB' },
  DOCUMENT: { accept: 'application/pdf', hint: 'PDF, up to 16 MB' },
};
