const fs = require('fs');
const path = require('path');
const ApiError = require('./apiError');

const ZIP_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.zip']);
const LEGACY_OFFICE_EXTENSIONS = new Set(['.doc', '.xls', '.ppt']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const getLowerExtension = (fileName = '') => path.extname(String(fileName || '')).toLowerCase();

const readHeader = (filePath, size = 512) => {
  const fileDescriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(fileDescriptor, buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fileDescriptor);
  }
};

const hasPdfSignature = (header) => header.length >= 4 && header.subarray(0, 4).toString() === '%PDF';
const hasZipSignature = (header) =>
  header.length >= 4 &&
  header[0] === 0x50 &&
  header[1] === 0x4b &&
  [0x03, 0x05, 0x07].includes(header[2]) &&
  [0x04, 0x06, 0x08].includes(header[3]);
const hasJpegSignature = (header) =>
  header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
const hasPngSignature = (header) =>
  header.length >= 8 &&
  header[0] === 0x89 &&
  header.subarray(1, 4).toString() === 'PNG' &&
  header[4] === 0x0d &&
  header[5] === 0x0a &&
  header[6] === 0x1a &&
  header[7] === 0x0a;
const hasWebpSignature = (header) =>
  header.length >= 12 && header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP';
const hasLegacyOfficeSignature = (header) =>
  header.length >= 8 &&
  header[0] === 0xd0 &&
  header[1] === 0xcf &&
  header[2] === 0x11 &&
  header[3] === 0xe0 &&
  header[4] === 0xa1 &&
  header[5] === 0xb1 &&
  header[6] === 0x1a &&
  header[7] === 0xe1;

const looksLikePlainText = (header) => {
  if (!header.length) return true;
  let controlBytes = 0;

  for (const byte of header) {
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !isAllowedControl) controlBytes += 1;
  }

  return controlBytes === 0;
};

const extensionMatchesSignature = (extension, header) => {
  if (extension === '.pdf') return hasPdfSignature(header);
  if (extension === '.jpg' || extension === '.jpeg') return hasJpegSignature(header);
  if (extension === '.png') return hasPngSignature(header);
  if (extension === '.webp') return hasWebpSignature(header);
  if (ZIP_EXTENSIONS.has(extension)) return hasZipSignature(header);
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) return hasLegacyOfficeSignature(header);
  if (extension === '.txt') return looksLikePlainText(header);
  return false;
};

const validateUploadedFileSignature = ({
  filePath,
  originalName,
  mimetype,
  allowedExtensions,
  allowedMimeTypes,
  genericMimeTypes = [],
  label = 'archivo',
}) => {
  const extension = getLowerExtension(originalName);
  const normalizedMimeType = String(mimetype || '').toLowerCase();
  const allowedExtensionSet = new Set(allowedExtensions);
  const allowedMimeTypeSet = new Set(allowedMimeTypes);
  const genericMimeTypeSet = new Set(genericMimeTypes);

  if (!allowedExtensionSet.has(extension)) {
    throw new ApiError(400, `Extension de ${label} no permitida.`);
  }

  if (!allowedMimeTypeSet.has(normalizedMimeType) && !genericMimeTypeSet.has(normalizedMimeType)) {
    throw new ApiError(400, `Formato de ${label} no permitido.`);
  }

  const header = readHeader(filePath);
  if (!extensionMatchesSignature(extension, header)) {
    throw new ApiError(400, `El contenido del ${label} no coincide con su extension.`);
  }

  return {
    extension,
    mimetype: normalizedMimeType,
  };
};

const removeUploadedFileQuietly = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_error) {
    // no-op: the upload validation error is more useful than a cleanup failure
  }
};

module.exports = {
  getLowerExtension,
  validateUploadedFileSignature,
  removeUploadedFileQuietly,
};
