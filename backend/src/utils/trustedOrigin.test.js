const assert = require('node:assert/strict');
const test = require('node:test');
const { createTrustedOriginPolicy } = require('./trustedOrigin');

const policy = createTrustedOriginPolicy({
  frontendUrls: ['https://computron.example', 'http://localhost:8100'],
  frontendUrlPatterns: [],
  nodeEnv: 'production',
});

test('permite solicitudes unsafe sin Origin para clientes internos o CLI', () => {
  assert.equal(policy.isTrustedUnsafeRequest({ method: 'POST', headers: {} }), true);
});

test('permite solicitudes unsafe desde frontend permitido', () => {
  assert.equal(
    policy.isTrustedUnsafeRequest({
      method: 'POST',
      headers: {
        origin: 'https://computron.example',
        'x-frontend-origin': 'https://computron.example',
      },
    }),
    true,
  );
});

test('bloquea solicitudes unsafe desde origen no permitido', () => {
  assert.equal(
    policy.isTrustedUnsafeRequest({
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    }),
    false,
  );
});

test('bloquea headers de origen contradictorios', () => {
  assert.equal(
    policy.isTrustedUnsafeRequest({
      method: 'POST',
      headers: {
        origin: 'https://computron.example',
        'x-frontend-origin': 'http://localhost:8100',
      },
    }),
    false,
  );
});

test('no aplica bloqueo a métodos seguros', () => {
  assert.equal(
    policy.isTrustedUnsafeRequest({
      method: 'GET',
      headers: { origin: 'https://evil.example' },
    }),
    true,
  );
});
