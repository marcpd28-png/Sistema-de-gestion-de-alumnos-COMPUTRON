# Computron Agent Guide

## Project Context

Sistema full stack para gestion academica y administrativa del Instituto Computron.

- Backend: Node.js, Express, PostgreSQL.
- Frontend: React, Vite, Tailwind CSS.
- Auth: JWT access token en memoria y refresh token en cookie `httpOnly`.
- Produccion: frontend estatico servido por Nginx y API Node ejecutada con PM2.

El repositorio oficial es:

```text
https://github.com/marcpd28-png/Sistema-de-gestion-de-alumnos-COMPUTRON.git
```

## Main Commands

Desde la raiz del proyecto:

```bash
npm run setup
npm run db:init
npm run dev
npm test
npm run build
```

Comandos por paquete:

```bash
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
```

## Local Setup

1. Levantar PostgreSQL local:

```bash
docker compose up -d
```

2. Crear variables locales desde los ejemplos:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. Instalar dependencias e iniciar:

```bash
npm run setup
npm run db:init
npm run dev
```

La API local usa `http://localhost:4010/api` y el frontend local usa `http://localhost:8100`.

## Current Product Areas

- Usuarios, roles y permisos por modulo.
- Alumnos, apoderados, docentes, sedes, cursos y matriculas.
- Evaluaciones, notas y asistencia.
- Cuotas, pagos, auditoria de pago y reportes.
- Caja administrativa con apertura/cierre, ingresos, egresos, metodos mixtos, vuelto y boletas.
- Preparacion para integracion SUNAT mediante API externa Laravel.
- Dashboard con accesos directos y resumen de caja.

## UI Direction

La interfaz esta pensada para personal administrativo. Priorizar:

- Navegacion clara entre modulos.
- Menos texto explicativo dentro de pantallas operativas.
- Acciones visibles y consistentes.
- Formularios compactos, escaneables y responsivos.
- Sidebar verde como identidad visual actual.
- Evitar cambios visuales amplios sin validar que mejoran el flujo administrativo.

## Security Rules

- Nunca commitear `.env`, tokens, claves, credenciales SSH, certificados SUNAT ni copias de `~/.codex/auth.json`.
- Mantener cookies `httpOnly` para refresh token.
- Mantener CORS restringido en produccion.
- Mantener `helmet`, rate limit, validacion con `zod` y hash de passwords.
- No exponer archivos subidos sin pasar por permisos del backend.
- Para despliegues, usar secretos reales solo en el servidor o gestor de secretos.

## Deployment Notes

El sitio publico de produccion es:

```text
https://sgi-put-ron.com
```

La informacion sensible de VPS no debe quedar en el repositorio. Para desplegar desde otro equipo, obtener el acceso SSH del propietario y verificar antes:

```bash
git status -sb
npm test
npm run build
```

Despues de desplegar, validar:

```bash
curl -I https://sgi-put-ron.com/
curl https://sgi-put-ron.com/api/health
```

## Handoff

Para contexto reciente de cambios, leer:

```text
docs/CODEX_HANDOFF.md
```
