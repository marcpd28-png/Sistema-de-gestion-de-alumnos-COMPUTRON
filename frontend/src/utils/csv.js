const CSV_MIME_TYPE = 'text/csv;charset=utf-8';

export const normalizeCsvFileName = (filename = 'reporte.csv') => {
  const trimmed = String(filename || '').trim();
  if (!trimmed) return 'reporte.csv';
  if (trimmed.toLowerCase().endsWith('.csv')) return trimmed;
  return `${trimmed.replace(/\.[^.]+$/, '')}.csv`;
};

export const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value);
  const escaped = normalized.replaceAll('"', '""');
  return /[",\n\r;]/.test(escaped) ? `"${escaped}"` : escaped;
};

export const buildCsvContent = ({ headers = [], rows = [] }) => {
  const headerLabels = headers.map((column) => escapeCsvCell(column.label));
  const bodyRows = rows.map((row) =>
    headers.map((column) => escapeCsvCell(row[column.key])).join(';'),
  );

  return ['\uFEFF' + headerLabels.join(';'), ...bodyRows].join('\r\n');
};

export const downloadCsv = async ({ filename, headers, rows }) => {
  const csvContent = buildCsvContent({ headers, rows });
  const blob = new Blob([csvContent], { type: CSV_MIME_TYPE });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = normalizeCsvFileName(filename);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

export const downloadExcel = downloadCsv;
