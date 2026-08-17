# Evaluación de Alineación con el Modelo de Negocio - Instituto Computron

Este documento evalúa cómo se alinea la implementación del software actual con las necesidades y la lógica del modelo de negocio del **Instituto Computron** (un instituto de educación superior / CETPRO con 27 sedes en el Perú).

---

## 1. Orientación del Sistema (Core Business)

El sistema web está diseñado para resolver las dos verticales operativas de un instituto de educación superior masivo:

1.  **Vertical Académica (Intranet / LMS):** Gestión del ciclo de vida del estudiante (matrícula, asistencia, registro de calificaciones, traslados de sede, aula virtual con foros y recursos, exámenes en línea y certificación).
2.  **Vertical Financiera/Recaudación (ERP / Caja):** Recaudación descentralizada de matrículas y pensiones, venta de trámites administrativos (certificados, duplicados, constancias), flujo y arqueo de caja física y digital por sede (apertura, egresos, vuelto, diferencias) y facturación electrónica (SUNAT).

---

## 2. Evaluación de Cumplimiento del Modelo de Negocio

A continuación, analizamos si las reglas de negocio implementadas en el código cubren los procesos reales del instituto:

### A. Operativa de Caja y Recaudación
*   **Requerimiento del negocio:** Las sedes operan de forma independiente. Cada cajero abre su caja, recibe efectivo o pagos digitales (Yape, Plin, Transferencias), entrega vuelto de caja chica y registra arqueos al finalizar el día para detectar faltantes o sobrantes.
*   **¿Cumple el código actual?**
    *   **Sí, a nivel de flujo de caja:** La base de datos y la UI implementan correctamente aperturas y cierres de sesión vinculados a sedes (`campus_id`), cálculo transaccional de vuelto, métodos de pago mixtos (efectivo + digital) e ingresos/egresos directos.
    *   **Brecha de Control/Fraude:** Para métodos de pago no efectivos (Yape, Plin, Transferencia bancaria), el cajero ingresa un código de referencia textual de forma manual. El sistema no tiene un flujo de **conciliación bancaria** (importar cartolas/estados de cuenta para cruzar y validar transacciones). Sin esto, existe el riesgo de que el personal acepte capturas falsas o digite códigos ficticios para cuadrar la caja.

### B. Modelo Multisede y Descentralización
*   **Requerimiento del negocio:** Computron tiene 27 sedes. Un cajero o secretaria en Cusco no debe ver ni alterar información de Arequipa o Los Olivos. Un Director General en Lima debe tener una visión consolidada (Dashboard global) para la toma de decisiones.
*   **¿Cumple el código actual?**
    *   **Sí, a nivel de permisos y alcance:** El backend implementa un control geográfico riguroso (`parseCampusScopeId`) que filtra alumnos, matrículas, ingresos y reportes según las sedes asignadas al usuario en `user_campuses`. El Dashboard permite alternar el alcance global o local si el usuario tiene el rol `ADMIN`.
    *   **Brecha en Traslados Académicos:** La base de datos registra solicitudes de traslado entre sedes (`student_transfer_requests`), pero al aprobar un traslado, el sistema reasigna la matrícula pero **deja las notas y asistencias históricas asociadas a la sección de origen**. El negocio requiere que el historial académico del alumno viaje completo y se homologue con la oferta de la sede de destino.

### C. Ciclo de Cobros (Pensiones y Matrículas)
*   **Requerimiento del negocio:** El cobro educativo se fracciona típicamente en 1 derecho de matrícula y N cuotas mensuales (pensiones) por periodo. La institución necesita identificar morosos rápidamente para gestionar recordatorios de cobro y evitar pérdidas.
*   **¿Cumple el código actual?**
    *   **Sí, a nivel estructural:** Se generan cuotas (`installments`) asociadas a conceptos de pago predefinidos y fechas de vencimiento. Además, hay un servicio automatizado en segundo plano (`notificationJobs.service.js`) que envía correos recordatorios a deudores vencidos.
    *   **Brecha en Recargos e Intereses:** El sistema no contempla la acumulación de intereses moratorios automáticos tras el vencimiento de la cuota. En el modelo educativo peruano, los pagos atrasados suelen generar una mora diaria o fija, la cual actualmente debe registrarse de forma manual como una cuota "OTRO", desgastando la operación.

### D. Facturación Electrónica (SUNAT)
*   **Requerimiento del negocio:** En Perú, la educación es un servicio inafecto al IGV (Código SUNAT de afectación: `30` - Inafecto - Operación Onerosa). El sistema debe emitir Boletas de Venta y Facturas electrónicas por cada cobranza y enviarlas a SUNAT.
*   **¿Cumple el código actual?**
    *   **Sí, a nivel técnico:** El módulo `sunatApi.service.js` está preparado para construir las tramas JSON inafectas exigidas por SUNAT, distinguir boletas/facturas e inferir tipos de documento (DNI, RUC, etc.).
    *   **Brecha de Validación y Cumplimiento:** 
        1.  **Límite de Identificación:** Según SUNAT, si una boleta de venta supera los S/ 700.00, es obligatorio identificar al comprador (DNI/CE y dirección). El sistema no bloquea la emisión de boletas anónimas que superen este límite.
        2.  **Notas de Crédito:** Si se anula un cobro que ya fue reportado y aceptado por SUNAT, legalmente se debe generar una Nota de Crédito para neutralizar el ingreso. El sistema actual solo cambia el estado interno a `VOIDED` (anulado) pero no emite el comprobante electrónico de anulación ante SUNAT.

---

## 3. Conclusión y Veredicto Operativo

El sistema **cumple estructuralmente** con el modelo de negocio básico de Computron: resuelve la cobranza descentralizada de las 27 sedes y automatiza la intranet de los alumnos.

Sin embargo, el software está en una fase **"Operativamente Vulnerable"**. Para ser desplegado con seguridad en un entorno de producción real y masivo, requiere endurecer los controles financieros (conciliación bancaria contra fraudes, alertas de límite de S/ 700 en boletas, generación de Notas de Crédito y registro exhaustivo de logs de auditoría en cambios de notas y accesos).
