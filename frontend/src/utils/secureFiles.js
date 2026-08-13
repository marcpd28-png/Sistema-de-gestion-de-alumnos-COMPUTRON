import api from '../services/api';

const extractFilename = (contentDisposition, fallback = 'archivo') => {
  const header = String(contentDisposition || '');
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = header.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) return plainMatch[1].trim();

  return fallback;
};

const openLoadingWindow = () => {
  if (typeof window === 'undefined') return null;
  const popup = window.open('about:blank', '_blank');
  if (!popup) return null;
  popup.opener = null;
  popup.document.open();
  popup.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>Abriendo archivo</title></head><body style="font-family:Arial,sans-serif;color:#1f2937;padding:24px"><h2>Abriendo archivo...</h2><p>Espera un momento.</p></body></html>',
  );
  popup.document.close();
  return popup;
};

export const openSecureFile = async ({
  url,
  params = {},
  filename = 'archivo',
  download = false,
} = {}) => {
  if (!url) return;

  const popup = download ? null : openLoadingWindow();
  const response = await api.get(url, {
    params: {
      ...params,
      ...(download ? { download: '1' } : {}),
    },
    responseType: 'blob',
    _skipResponseCache: true,
  });

  const blob = new Blob([response.data], {
    type: response.headers?.['content-type'] || 'application/octet-stream',
  });
  const objectUrl = URL.createObjectURL(blob);
  const resolvedFilename = extractFilename(
    response.headers?.['content-disposition'],
    filename,
  );

  if (download || !popup || popup.closed) {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = resolvedFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    return;
  }

  popup.location.href = objectUrl;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
};
