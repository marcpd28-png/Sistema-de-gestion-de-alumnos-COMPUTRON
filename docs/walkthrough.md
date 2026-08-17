# Walkthrough - Solución de Impresión A5 Preimpresa (Computron)

Este documento detalla la solución implementada para adaptar la impresión de comprobantes al papel **A5 landscape preimpreso** utilizado por el Instituto Computron.

---

## 💻 Cambios Realizados

### 1. Modificación de Plantilla A5 (`F3`)
En el archivo [boleta.formato3.html](file:///Users/mark/Desktop/SISTEMCOMPUTRON/backend/src/templates/boleta.formato3.html), en la sección `@media print`, cambiamos la lógica de ocultación de elementos estáticos:

```diff
-        .print-static-brand,
-        .company-data,
-        .cut-line {
+        .format-background,
+        .company-data {
           display: none;
         }
```

*   **¿Qué logra este cambio?**
    *   Oculta completamente el elemento SVG `.format-background` (que incluye el logotipo de Computron, la marca de agua del libro y las líneas de bordes de las cajas externas). Esto evita la duplicación visual de bordes y logotipos sobre el papel físico que ya los tiene impresos de fábrica.
    *   Oculta `.company-data` (R.U.C., Razón Social y datos de la sede principal) porque el papel ya cuenta con este membrete preimpreso en la esquina superior derecha.
    *   Mantiene visible el título del documento (`DOCUMENT_TITLE_F3`) y el número de boleta (`DOCUMENT_NUMBER`), ya que estos son campos dinámicos que no pueden ser preimpresos.

### 2. Actualización de Pruebas Unitarias
En el archivo de pruebas [receiptTemplate.service.test.js](file:///Users/mark/Desktop/SISTEMCOMPUTRON/backend/src/services/receiptTemplate.service.test.js#L48), se adaptó la aserción de ocultamiento para que verifique los nuevos selectores `.format-background` y `.company-data`:

```diff
-  assert.match(html, /\.print-static-brand,\s*\.company-data,\s*\.cut-line\s*\{\s*display: none;/);
+  assert.match(html, /\.format-background,\s*\.company-data\s*\{\s*display: none;/);
```

---

## 🧪 Validación y Pruebas Realizadas

1.  **Ejecución de Pruebas Unitarias:** Se ejecutó `npm test` en el backend, pasando las 18 pruebas con éxito:
    ```bash
    ✔ oculta los datos preimpresos solo al imprimir y mantiene orientacion normal (4.84ms)
    ℹ pass 18
    ```
2.  **Validación de Diseño F3 (A5 Horizontal con 2 Recibos en Paralelo):**
    *   La plantilla `boleta.formato3.html` divide la página A5 horizontal en dos columnas idénticas de `105mm` de ancho cada una (mediante CSS Grid: `grid-template-columns: 105mm 105mm`).
    *   Dentro de cada columna, el diseño A5 vertical (`148.5mm x 210mm`) se reduce proporcionalmente a un factor de escala de **`0.707`** (escala exacta para encajar en la mitad del A5 horizontal).
    *   Al ocultar el fondo estático en la impresión, ambos recibos (el del alumno a la izquierda y el del instituto a la derecha) conservarán las posiciones exactas y alineadas de los textos (cliente, conceptos, tablas y QR) para calzar de manera perfecta en los espacios en blanco del papel preimpreso de Computron.
