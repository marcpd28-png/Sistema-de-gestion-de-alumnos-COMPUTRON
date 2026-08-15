const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACCOUNT_ACTIVATION_PURPOSE,
  ACTIVATION_CODE_TTL_MINUTES,
  createAccountActivationCode,
  consumeAccountActivationCode,
} = require('./accountActivation.service');

const createRecordingDb = () => {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };
};

test('genera código de activación y guarda solo hash', async () => {
  const db = createRecordingDb();
  const code = await createAccountActivationCode({ userId: 42, db });
  const insertCall = db.calls.find((call) => call.sql.includes('INSERT INTO email_verification_codes'));

  assert.match(code, /^\d{6}$/);
  assert.ok(insertCall);
  assert.equal(insertCall.params[0], 42);
  assert.equal(insertCall.params[1], ACCOUNT_ACTIVATION_PURPOSE);
  assert.notEqual(insertCall.params[2], code);
  assert.equal(insertCall.params[3], ACTIVATION_CODE_TTL_MINUTES);
});

test('consume correctamente un código válido', async () => {
  const db = createRecordingDb();
  const userId = 77;
  const code = await createAccountActivationCode({ userId, db });
  const insertCall = db.calls.find((call) => call.sql.includes('INSERT INTO email_verification_codes'));
  const savedHash = insertCall.params[2];
  const txCalls = [];

  const result = await consumeAccountActivationCode({
    userId,
    code,
    transactionRunner: async (callback) =>
      callback({
        async query(sql, params = []) {
          txCalls.push({ sql, params });
          if (sql.includes('SELECT id, code_hash, attempts')) {
            return { rowCount: 1, rows: [{ id: 9, code_hash: savedHash, attempts: 0 }] };
          }
          return { rowCount: 1, rows: [] };
        },
      }),
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(txCalls.some((call) => call.sql.includes('SET consumed_at = NOW()') && call.params[0] === 9));
});

test('bloquea código inválido al superar intentos', async () => {
  const db = createRecordingDb();
  const userId = 88;
  await createAccountActivationCode({ userId, db });
  const insertCall = db.calls.find((call) => call.sql.includes('INSERT INTO email_verification_codes'));
  const savedHash = insertCall.params[2];
  const txCalls = [];

  const result = await consumeAccountActivationCode({
    userId,
    code: '000000',
    transactionRunner: async (callback) =>
      callback({
        async query(sql, params = []) {
          txCalls.push({ sql, params });
          if (sql.includes('SELECT id, code_hash, attempts')) {
            return { rowCount: 1, rows: [{ id: 10, code_hash: savedHash, attempts: 4 }] };
          }
          return { rowCount: 1, rows: [] };
        },
      }),
  });

  assert.deepEqual(result, { ok: false, reason: 'max_attempts' });
  assert.ok(txCalls.some((call) => call.params[0] === 10 && call.params[1] === 5));
});
