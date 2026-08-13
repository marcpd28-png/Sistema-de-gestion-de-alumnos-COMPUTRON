import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsvContent, normalizeCsvFileName } from './csv.js';

test('normaliza extension CSV reemplazando XLSX anterior', () => {
  assert.equal(normalizeCsvFileName('reporte_pagos.xlsx'), 'reporte_pagos.csv');
  assert.equal(normalizeCsvFileName('usuarios.csv'), 'usuarios.csv');
});

test('construye CSV con BOM, separador punto y coma y escape de comillas', () => {
  const csv = buildCsvContent({
    headers: [
      { key: 'name', label: 'Nombre' },
      { key: 'note', label: 'Nota' },
    ],
    rows: [{ name: 'Juan "Admin"', note: 'Pago; parcial' }],
  });

  assert.equal(csv, '\uFEFFNombre;Nota\r\n"Juan ""Admin""";"Pago; parcial"');
});
