# Sistema Instituto Computron

Implementación full stack del sistema de gestión académica y administrativa con:

- Backend: Node.js + Express + PostgreSQL
- Frontend: React + Tailwind CSS
- Autenticación: JWT access en memoria + refresh en cookie `httpOnly`
- Correo: Nodemailer
- Seguridad: Helmet, CORS, rate limit, hash de contraseñas, archivos protegidos

## Módulos incluidos

- Usuarios y roles (`ADMIN`, `DOCENTE`, `SECRETARIADO`, `DIRECTOR`)
- Matriz de permisos por rol configurable desde `Usuarios` (Admin)
- Alumnos y apoderados (N:M)
- Sedes y cursos (N:M con `course_campus`)
- Docentes y asignación a cursos/sedes por periodo con horario
- Matrículas por periodo
- Evaluaciones, notas y asistencia
- Cuotas, pagos y auditoría de estado de pago
- Caja administrativa: apertura/cierre, efectivo, métodos mixtos, vuelto y boletas
- Notificaciones por correo y recordatorios automáticos
- Reportes financieros y de morosidad
- Exportación CSV de reportes
- Base en 3FN con claves foráneas, índices y vistas

## Estructura

- `backend`: API REST + SQL + scripts DB
- `frontend`: aplicación React
- `docker-compose.yml`: PostgreSQL local

## Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL 14+ (o usar Docker Compose)

## Inicio rápido local

### 1) Base de datos

```bash
docker compose up -d
```

### 2) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run db:init
npm run dev
```

API: `http://localhost:4010/api`

### 3) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Web: `http://localhost:8100`

### Alternativa: levantar todo desde la raíz

```bash
npm install
npm run setup
npm run db:init
npm run dev
```

## Primer usuario (ADMIN)

El primer registro puede crearse sin token; desde el segundo usuario, solo `ADMIN` puede registrar usuarios.

```bash
curl -X POST http://localhost:4010/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "first_name":"Admin",
    "last_name":"Computron",
    "email":"admin@computron.com",
    "password":"Admin12345",
    "roles":["ADMIN"]
  }'
```

Luego inicia sesión en el frontend con ese usuario.

## Endpoints principales

- Auth: `/api/auth/*`
- Dashboard: `/api/dashboard/summary`
- Usuarios: `/api/users`
- Alumnos/Apoderados: `/api/students`, `/api/guardians`
- Docentes y asignación: `/api/teachers`, `/api/teachers/assignments`
- Sedes/Cursos: `/api/campuses`, `/api/courses`
- Matrículas/Cuotas: `/api/enrollments`
- Académico: `/api/academic` (asistencia, evaluaciones y notas)
- Pagos/Auditoría: `/api/payments`
- Reportes: `/api/reports`
- Notificaciones: `/api/notifications`, `/api/notifications/reminders/run`, `/api/notifications/jobs/*`
- Catálogos: `/api/catalogs`

## Pruebas y verificación

```bash
npm test
npm run build
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
```

Los reportes descargan CSV para evitar dependencias vulnerables de lectura/escritura
Excel en el navegador.

## Integración SUNAT

El módulo de caja queda preparado para consumir la API externa
`yorchavez9/Api-de-facturacion-electronica-sunat-Peru` como servicio separado.
Levanta esa API Laravel, configura empresa/sucursal/correlativos/certificado y coloca en
`backend/.env`:

```env
SUNAT_API_BASE_URL=http://localhost:8000
SUNAT_API_TOKEN=token_sanctum
SUNAT_API_COMPANY_ID=1
SUNAT_API_BRANCH_ID=1
SUNAT_API_BOLETA_SERIE=B001
SUNAT_API_FACTURA_SERIE=F001
SUNAT_API_BOLETA_METODO_ENVIO=resumen_diario
```

Desde `Caja`, cada boleta/factura puede enviarse manualmente con el botón `SUNAT`.
El sistema guarda el estado, número SUNAT y respuesta de la API en
`electronic_document_submissions`. Por defecto los servicios se envían como operaciones
inafectas (`SUNAT_API_TAX_PERCENT=0`, `SUNAT_API_IGV_AFFECTATION=30`); cambia esas
variables si vas a emitir con IGV.

## Control de accesos (RBAC por permisos)

- Cada rol tiene permisos granulares de `view` y `manage` por módulo.
- El rol `ADMIN` tiene acceso total implícito.
- Desde la sección `Usuarios` se puede:
  - Asignar roles a usuarios.
  - Activar/desactivar usuarios.
  - Configurar permisos por rol (excepto `ADMIN`).

## Despliegue en HostGator (VPS)

1. Instalar Node.js LTS, PostgreSQL y Nginx.
2. Configurar `.env` de backend con credenciales reales y secretos JWT fuertes.
3. Compilar frontend con `npm run build` y servir `frontend/dist` con Nginx.
4. Ejecutar backend con PM2 (`pm2 start src/server.js --name computron-api`).
5. Configurar reverse proxy de Nginx:
   - `https://tudominio.com` -> frontend estático
   - `https://tudominio.com/api` -> backend `localhost:4010`
6. Activar SSL con Let's Encrypt (`certbot`).

## Seguridad recomendada para producción

- Cambiar secretos JWT y contraseñas por valores robustos.
- Restringir CORS a dominio productivo.
- Forzar HTTPS con redirección en Nginx.
- Mantener el backend detrás de `/api` en el mismo dominio del frontend para que la
  cookie `httpOnly` de refresh funcione correctamente.
- Ajustar `API_RATE_LIMIT_WINDOW_MS` y `API_RATE_LIMIT_MAX` según el tráfico real.
- Configurar backup automático de PostgreSQL.
- Usar SMTP real (HostGator o proveedor externo) en `backend/.env`.
