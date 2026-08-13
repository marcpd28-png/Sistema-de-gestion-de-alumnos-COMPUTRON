# Codex Handoff

Actualizado: 2026-08-13

## Estado General

El sistema ya tiene implementado el flujo administrativo principal solicitado para caja, pagos, boletas, dashboard y limpieza visual. El objetivo actual es que cualquier equipo con VS Code, Codex y acceso al repo pueda retomar el trabajo sin depender del historial local del chat.

Repositorio oficial:

```text
https://github.com/marcpd28-png/Sistema-de-gestion-de-alumnos-COMPUTRON.git
```

Rama principal:

```text
main
```

Commits recientes relevantes:

```text
7e223b6 Optimiza interfaz administrativa
ca76e83 Configura trust proxy en produccion
64fedf3 Agrega caja y endurece seguridad
```

## Cambios Funcionales Relevantes

- Caja administrativa:
  - Apertura y cierre de caja.
  - Registro de ingresos y egresos.
  - Manejo de efectivo, Yape, Plin, transferencia, tarjeta y otros metodos.
  - Pagos mixtos, por ejemplo una parte en efectivo y otra en Yape.
  - Calculo de vuelto cuando el efectivo recibido supera el monto total.
  - Boletas conectadas al flujo de pago.

- Pagos:
  - Flujo preparado para registrar pago y emitir comprobante.
  - Validaciones para evitar inconsistencias de monto.
  - Integracion visual con caja.

- SUNAT:
  - Preparado para integrar la API externa `yorchavez9/Api-de-facturacion-electronica-sunat-Peru`.
  - La API SUNAT se considera un servicio separado.
  - Variables esperadas en `backend/.env`:

```env
SUNAT_API_BASE_URL=
SUNAT_API_TOKEN=
SUNAT_API_COMPANY_ID=
SUNAT_API_BRANCH_ID=
SUNAT_API_BOLETA_SERIE=
SUNAT_API_FACTURA_SERIE=
SUNAT_API_BOLETA_METODO_ENVIO=
SUNAT_API_TAX_PERCENT=
SUNAT_API_IGV_AFFECTATION=
```

- Dashboard:
  - Acceso directo al flujo de caja.
  - Indicadores administrativos esenciales.
  - Limpieza visual para reducir texto innecesario.

- Navegacion e interfaz:
  - Sidebar verde restaurado como identidad visual.
  - Menus organizados para uso administrativo.
  - Pantallas principales simplificadas.
  - Mejoras responsive en login, dashboard, pagos, caja y administracion.

- Seguridad:
  - Trust proxy configurado para produccion.
  - Cookies seguras en despliegue con HTTPS.
  - Rate limit, Helmet, CORS y validaciones mantenidas.
  - Archivos protegidos por backend.

## Verificacion Local Recomendada

Antes de cambiar o desplegar:

```bash
git status -sb
npm test
npm run build
```

Auditoria:

```bash
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
```

Ejecucion local:

```bash
docker compose up -d
npm run setup
npm run db:init
npm run dev
```

URLs locales:

```text
Frontend: http://localhost:8100
Backend:  http://localhost:4010/api
```

## Produccion

Dominio publico:

```text
https://sgi-put-ron.com
```

Verificaciones despues de desplegar:

```bash
curl -I https://sgi-put-ron.com/
curl https://sgi-put-ron.com/api/health
```

Notas:

- No guardar credenciales del VPS en el repo.
- No guardar contrasenas, tokens SUNAT, certificados ni `.env`.
- Si el frontend parece no actualizar, verificar cache de Nginx para `index.html`.
- Los assets versionados pueden usar cache largo; `index.html` no debe quedar cacheado.

## Como Continuar En Otro Equipo

1. Instalar VS Code y la extension de Codex.
2. Iniciar sesion con la misma cuenta.
3. Clonar el repo oficial.
4. Abrir la carpeta del proyecto en VS Code.
5. Pedir a Codex que lea `AGENTS.md` y `docs/CODEX_HANDOFF.md`.
6. Ejecutar pruebas antes de tocar produccion.

Comandos base:

```bash
git clone https://github.com/marcpd28-png/Sistema-de-gestion-de-alumnos-COMPUTRON.git
cd Sistema-de-gestion-de-alumnos-COMPUTRON
npm run setup
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up -d
npm run db:init
npm run dev
```

## Pendientes Naturales

- Conectar y probar una instancia real de la API SUNAT con certificado y correlativos reales.
- Definir politicas de backup automatico de PostgreSQL en produccion.
- Revisar roles/permisos con usuarios reales del area administrativa.
- Probar flujos completos con datos reales: matricula, cuota, pago mixto, vuelto, boleta, cierre de caja y reporte.
- Documentar proceso de despliegue privado fuera del repo si se requiere incluir IP, usuario SSH o rutas exactas del servidor.
