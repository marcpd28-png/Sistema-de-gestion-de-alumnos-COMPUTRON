const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateUploadedFileSignature } = require('./fileValidation');

const withTempFile = (filename, content, callback) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'computron-upload-'));
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, content);
  try {
    callback(filePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

test('acepta PDF cuando extension, MIME y firma coinciden', () => {
  withTempFile('constancia.pdf', Buffer.from('%PDF-1.7\ncontenido'), (filePath) => {
    const result = validateUploadedFileSignature({
      filePath,
      originalName: 'constancia.pdf',
      mimetype: 'application/pdf',
      allowedExtensions: new Set(['.pdf']),
      allowedMimeTypes: new Set(['application/pdf']),
      label: 'evidencia',
    });

    assert.equal(result.extension, '.pdf');
  });
});

test('rechaza archivo con extension PDF pero contenido no PDF', () => {
  withTempFile('constancia.pdf', Buffer.from('no es pdf'), (filePath) => {
    assert.throws(
      () =>
        validateUploadedFileSignature({
          filePath,
          originalName: 'constancia.pdf',
          mimetype: 'application/pdf',
          allowedExtensions: new Set(['.pdf']),
          allowedMimeTypes: new Set(['application/pdf']),
          label: 'evidencia',
        }),
      /no coincide con su extension/,
    );
  });
});
