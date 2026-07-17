BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  id SMALLSERIAL PRIMARY KEY,
  name VARCHAR(30) UNIQUE NOT NULL
);

INSERT INTO roles (name)
VALUES ('ADMIN'), ('DOCENTE'), ('SECRETARIADO'), ('DIRECTOR'), ('ALUMNO')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(120) UNIQUE NOT NULL,
  module VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (code, module, name, description)
VALUES
  ('dashboard.view', 'DASHBOARD', 'Ver dashboard', 'Permite visualizar el panel de indicadores generales.'),
  ('users.create', 'USERS', 'Crear usuarios', 'Permite registrar nuevos usuarios en el sistema.'),
  ('users.view', 'USERS', 'Ver usuarios', 'Permite consultar el listado de usuarios.'),
  ('users.roles.manage', 'USERS', 'Gestionar roles de usuario', 'Permite asignar o quitar roles a los usuarios.'),
  ('users.status.manage', 'USERS', 'Gestionar estado de usuario', 'Permite activar o desactivar cuentas de usuario.'),
  ('users.permissions.manage', 'USERS', 'Configurar permisos por rol', 'Permite administrar la matriz de permisos de cada rol.'),
  ('students.view', 'STUDENTS', 'Ver alumnos', 'Permite consultar alumnos y su informacion academica.'),
  ('students.manage', 'STUDENTS', 'Gestionar alumnos', 'Permite crear, editar y vincular alumnos.'),
  ('guardians.view', 'GUARDIANS', 'Ver apoderados', 'Permite consultar apoderados registrados.'),
  ('guardians.manage', 'GUARDIANS', 'Gestionar apoderados', 'Permite crear, editar y eliminar apoderados.'),
  ('campuses.view', 'CAMPUSES', 'Ver sedes', 'Permite consultar sedes del instituto.'),
  ('campuses.manage', 'CAMPUSES', 'Gestionar sedes', 'Permite crear, editar y eliminar sedes.'),
  ('courses.view', 'COURSES', 'Ver cursos', 'Permite consultar cursos y su catalogo.'),
  ('courses.manage', 'COURSES', 'Gestionar cursos', 'Permite crear, editar cursos y ofertas por sede.'),
  ('periods.view', 'CATALOGS', 'Ver periodos academicos', 'Permite consultar periodos academicos.'),
  ('periods.manage', 'CATALOGS', 'Gestionar periodos academicos', 'Permite crear y administrar periodos academicos.'),
  ('payment_concepts.view', 'CATALOGS', 'Ver conceptos de pago', 'Permite consultar conceptos de pago disponibles.'),
  ('enrollments.view', 'ENROLLMENTS', 'Ver matriculas', 'Permite consultar matriculas de alumnos.'),
  ('enrollments.manage', 'ENROLLMENTS', 'Gestionar matriculas', 'Permite crear y actualizar matriculas.'),
  ('installments.view', 'ENROLLMENTS', 'Ver cuotas', 'Permite consultar cuotas asociadas a matriculas.'),
  ('installments.manage', 'ENROLLMENTS', 'Gestionar cuotas', 'Permite crear y administrar cuotas.'),
  ('teachers.view', 'TEACHERS', 'Ver docentes', 'Permite consultar docentes registrados.'),
  ('teachers.assignments.view', 'TEACHERS', 'Ver asignaciones docentes', 'Permite consultar cursos y horarios asignados a docentes.'),
  ('teachers.assignments.manage', 'TEACHERS', 'Gestionar asignaciones docentes', 'Permite crear y modificar asignaciones de docentes.'),
  ('academic.attendance.view', 'ACADEMIC', 'Ver asistencias', 'Permite consultar asistencias registradas.'),
  ('academic.attendance.manage', 'ACADEMIC', 'Gestionar asistencias', 'Permite registrar y actualizar asistencias.'),
  ('academic.assessments.view', 'ACADEMIC', 'Ver evaluaciones', 'Permite consultar evaluaciones programadas.'),
  ('academic.assessments.manage', 'ACADEMIC', 'Gestionar evaluaciones', 'Permite crear evaluaciones.'),
  ('academic.grades.view', 'ACADEMIC', 'Ver notas', 'Permite consultar notas de alumnos.'),
  ('academic.grades.manage', 'ACADEMIC', 'Gestionar notas', 'Permite registrar y actualizar notas.'),
  ('payments.view', 'PAYMENTS', 'Ver pagos', 'Permite consultar el historial de pagos.'),
  ('payments.manage', 'PAYMENTS', 'Gestionar pagos', 'Permite registrar pagos y cambiar su estado.'),
  ('payments.audit.view', 'PAYMENTS', 'Ver auditoria de pagos', 'Permite consultar auditoria de cambios de pagos.'),
  ('reports.view', 'REPORTS', 'Ver reportes', 'Permite consultar reportes academicos y financieros.'),
  ('notifications.view', 'NOTIFICATIONS', 'Ver notificaciones', 'Permite consultar historial de notificaciones.'),
  ('notifications.manage', 'NOTIFICATIONS', 'Gestionar notificaciones', 'Permite ejecutar procesos de recordatorios por correo.')
ON CONFLICT (code) DO UPDATE
SET
  module = EXCLUDED.module,
  name = EXCLUDED.name,
  description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code = ANY(ARRAY[
    'dashboard.view',
    'users.view',
    'students.view',
    'students.manage',
    'guardians.view',
    'guardians.manage',
    'campuses.view',
    'campuses.manage',
    'courses.view',
    'courses.manage',
    'periods.view',
    'periods.manage',
    'payment_concepts.view',
    'enrollments.view',
    'enrollments.manage',
    'installments.view',
    'installments.manage',
    'teachers.view',
    'teachers.assignments.view',
    'teachers.assignments.manage',
    'academic.attendance.view',
    'academic.attendance.manage',
    'academic.assessments.view',
    'academic.assessments.manage',
    'academic.grades.view',
    'academic.grades.manage',
    'payments.view',
    'payments.manage',
    'payments.audit.view',
    'reports.view',
    'notifications.view',
    'notifications.manage'
  ]::text[])
WHERE r.name = 'DIRECTOR'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code = ANY(ARRAY[
    'dashboard.view',
    'students.view',
    'students.manage',
    'guardians.view',
    'guardians.manage',
    'campuses.view',
    'campuses.manage',
    'courses.view',
    'courses.manage',
    'periods.view',
    'periods.manage',
    'payment_concepts.view',
    'enrollments.view',
    'enrollments.manage',
    'installments.view',
    'installments.manage',
    'teachers.view',
    'teachers.assignments.view',
    'teachers.assignments.manage',
    'academic.attendance.view',
    'academic.attendance.manage',
    'academic.assessments.view',
    'academic.grades.view',
    'payments.view',
    'payments.manage',
    'payments.audit.view',
    'reports.view',
    'notifications.view',
    'notifications.manage'
  ]::text[])
WHERE r.name = 'SECRETARIADO'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code = ANY(ARRAY[
    'dashboard.view',
    'students.view',
    'courses.view',
    'periods.view',
    'teachers.view',
    'teachers.assignments.view',
    'academic.attendance.view',
    'academic.attendance.manage',
    'academic.assessments.view',
    'academic.assessments.manage',
    'academic.grades.view',
    'academic.grades.manage'
  ]::text[])
WHERE r.name = 'DOCENTE'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  document_number VARCHAR(30),
  phone VARCHAR(30),
  address VARCHAR(240),
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS campuses (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  address VARCHAR(250) NOT NULL,
  city VARCHAR(120) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO campuses (name, address, city)
VALUES
  ('Los Olivos - Lima', 'Psje. Ayarza 180 (frente a Mega Plaza) Los Olivos', 'Lima'),
  ('Puente Piedra - Lima', 'Av. República de Venezuela 202 (esq. plaza de Armas)', 'Lima'),
  ('San Borja - Lima', 'Av. Javier Prado Este 2950', 'Lima'),
  ('San Juan de Miraflores - Lima', 'Av. San Juan 1066 2do Piso (Al costado del Banco Pichincha)', 'Lima'),
  ('Ate Vitarte - Lima', 'Av. Nicolás Ayllon N° 5586 (Frente al grifo Tokio)', 'Lima'),
  ('Lima - Lima', 'Avenida 9 de diciembre 422 (A media cuadra de la Plaza Bolognesi)', 'Lima'),
  ('Huacho - Lima', 'Coronel Portillo 140, referencia Plazuela dos de mayo a la derecha', 'Lima'),
  ('Abancay - Apurímac', 'Av. Panama S/N Mz G Lot 2. Urb Horacio Zeballos', 'Apurímac'),
  ('Huaraz - Ancash', 'Av. Mariscal Toribio de Luzuriaga N° 410 3er piso', 'Ancash'),
  ('Bagua Grande - Amazonas', 'Jr. Ciro Alegria N°976', 'Amazonas'),
  ('Cajamarca - Cajamarca', 'Jr. Belén 740-742, Jr. G. Urrelo 849 Cajamarca', 'Cajamarca'),
  ('Jaén - Cajamarca', 'Calle Marañón 1440', 'Cajamarca'),
  ('La Merced - Chanchamayo', 'Jr. Junín N° 139', 'Chanchamayo'),
  ('Huancavelica - Huancavelica', 'Jr. Torre Tagle 462 / Al costado de la Fiscalía de la Nación a espaldas de la catedral de Huancavelica', 'Huancavelica'),
  ('Huancayo - Junín', 'Jr. Manuel Fuentes 320 El Tambo Huancayo', 'Junín'),
  ('Ica - Ica', 'Av. Nicolás de Rivera El Viejo 102', 'Ica'),
  ('Pucallpa - Ucayali', 'Av. Aguaytía Mz.27 Lt 3. Manantay Coronel Portillo', 'Ucayali'),
  ('Ayacucho - Ayacucho', 'Jr. Callao 468', 'Ayacucho'),
  ('Juliaca - Puno', 'Urb. La Florida, Jr. los Rosales 101- referencia por la comisaría Santa Rosa. Salida Puno.', 'Puno'),
  ('Chimbote - Ancash', 'Jr. Elias Aguirre N° 161 Mz 3 - 2do piso - Chimbote - Referencia al costado del restaurante Brandy, al frente de la notaría Guillermo Carranza', 'Ancash'),
  ('Cusco - Cusco', 'Av. Garcilaso 222 - Referencia Frente a Serpost', 'Cusco'),
  ('Bellavista - Anchoajo- San Martín', 'Jr. Miraflores 208 primer piso Bellavista, referencia al costado de Anchoajo', 'San Martín'),
  ('Arequipa - Arequipa', 'Mariano ignacio prado 112 Ref: A espaldas Estadio melgar, zona sur', 'Arequipa'),
  ('Moyobamba - San Martin', '2 de Mayo', 'San Martin'),
  ('Tarma - Junin', 'Ref. Frente a Celima', 'Junin'),
  ('Quillabamba - Cusco', 'Ref. al frente del C.E.B.E ROSA DE LAS AMERICAS', 'Cusco'),
  ('Tacna - Tacna', 'Ref. Avenida Blondell N° 40', 'Tacna')
ON CONFLICT (name) DO UPDATE
SET
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  updated_at = NOW();

ALTER TABLE users
ADD COLUMN IF NOT EXISTS base_campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_campuses (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, campus_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_campuses_primary
  ON user_campuses(user_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_user_campuses_campus_user
  ON user_campuses(campus_id, user_id);

INSERT INTO user_campuses (user_id, campus_id, is_primary)
SELECT id, base_campus_id, TRUE
FROM users
WHERE base_campus_id IS NOT NULL
ON CONFLICT (user_id, campus_id) DO NOTHING;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS document_number VARCHAR(30);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS address VARCHAR(240);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS courses (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  description VARCHAR(500),
  duration_hours INTEGER NOT NULL CHECK (duration_hours > 0),
  passing_grade NUMERIC(4,2) NOT NULL DEFAULT 11,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE courses
ADD COLUMN IF NOT EXISTS passing_grade NUMERIC(4,2);

UPDATE courses
SET passing_grade = 11
WHERE passing_grade IS NULL;

ALTER TABLE courses
ALTER COLUMN passing_grade SET DEFAULT 11;

ALTER TABLE courses
ALTER COLUMN passing_grade SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'courses_passing_grade_check'
  ) THEN
    ALTER TABLE courses
    ADD CONSTRAINT courses_passing_grade_check
    CHECK (passing_grade >= 0 AND passing_grade <= 20);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS course_campus (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  modality VARCHAR(20) NOT NULL DEFAULT 'PRESENCIAL' CHECK (modality IN ('PRESENCIAL', 'VIRTUAL', 'HIBRIDO')),
  monthly_fee NUMERIC(10,2) NOT NULL CHECK (monthly_fee >= 0),
  capacity INTEGER CHECK (capacity > 0),
  schedule_info VARCHAR(240),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, campus_id)
);

ALTER TABLE course_campus
ADD COLUMN IF NOT EXISTS modality VARCHAR(20);

UPDATE course_campus
SET modality = 'PRESENCIAL'
WHERE modality IS NULL;

ALTER TABLE course_campus
ALTER COLUMN modality SET DEFAULT 'PRESENCIAL';

ALTER TABLE course_campus
ALTER COLUMN modality SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'course_campus_modality_check'
  ) THEN
    ALTER TABLE course_campus
    ADD CONSTRAINT course_campus_modality_check
    CHECK (modality IN ('PRESENCIAL', 'VIRTUAL', 'HIBRIDO'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS guardians (
  id BIGSERIAL PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(30),
  document_number VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  document_number VARCHAR(30) UNIQUE NOT NULL,
  birth_date DATE NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(30),
  address VARCHAR(240),
  notes VARCHAR(500),
  assigned_campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL,
  user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students
ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE students
ADD COLUMN IF NOT EXISTS user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE students
ADD COLUMN IF NOT EXISTS assigned_campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS student_guardian (
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id BIGINT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relationship VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, guardian_id)
);

CREATE TABLE IF NOT EXISTS academic_periods (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_campus_id BIGINT NOT NULL REFERENCES course_campus(id) ON DELETE RESTRICT,
  period_id BIGINT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELED', 'TRANSFERRED')),
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  schedule_info VARCHAR(240),
  notes VARCHAR(500),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, course_campus_id, period_id)
);

ALTER TABLE enrollments
ADD COLUMN IF NOT EXISTS schedule_info VARCHAR(240);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enrollments_status_check'
  ) THEN
    ALTER TABLE enrollments
    DROP CONSTRAINT enrollments_status_check;
  END IF;

  ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELED', 'TRANSFERRED'));
END
$$;

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id BIGSERIAL PRIMARY KEY,
  teacher_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_campus_id BIGINT NOT NULL REFERENCES course_campus(id) ON DELETE CASCADE,
  period_id BIGINT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  schedule_info VARCHAR(240),
  campus_override_reason VARCHAR(300),
  campus_override_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  campus_override_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_user_id, course_campus_id, period_id)
);

ALTER TABLE teacher_assignments
ADD COLUMN IF NOT EXISTS campus_override_reason VARCHAR(300);

ALTER TABLE teacher_assignments
ADD COLUMN IF NOT EXISTS campus_override_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE teacher_assignments
ADD COLUMN IF NOT EXISTS campus_override_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS teacher_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  teacher_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id BIGINT REFERENCES teacher_assignments(id) ON DELETE SET NULL,
  course_campus_id BIGINT REFERENCES course_campus(id) ON DELETE SET NULL,
  title VARCHAR(150) NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  classroom VARCHAR(120),
  notes VARCHAR(300),
  status VARCHAR(20) NOT NULL DEFAULT 'PROGRAMADA' CHECK (status IN ('PROGRAMADA', 'CANCELADA', 'REPROGRAMADA')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS course_forum_topics (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
  course_campus_id BIGINT REFERENCES course_campus(id) ON DELETE SET NULL,
  period_id BIGINT REFERENCES academic_periods(id) ON DELETE SET NULL,
  author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_forum_comments (
  id BIGSERIAL PRIMARY KEY,
  topic_id BIGINT NOT NULL REFERENCES course_forum_topics(id) ON DELETE CASCADE,
  author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_library_resources (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
  course_campus_id BIGINT NOT NULL REFERENCES course_campus(id) ON DELETE CASCADE,
  period_id BIGINT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(500),
  file_name VARCHAR(220) NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (file_size_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS course_practices (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
  course_campus_id BIGINT NOT NULL REFERENCES course_campus(id) ON DELETE CASCADE,
  period_id BIGINT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1 AND max_attempts <= 20),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS course_practice_questions (
  id BIGSERIAL PRIMARY KEY,
  practice_id BIGINT NOT NULL REFERENCES course_practices(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  points NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (points > 0),
  image_name VARCHAR(180),
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_practice_options (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES course_practice_questions(id) ON DELETE CASCADE,
  option_text VARCHAR(500) NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_course_practice_options_question_sort UNIQUE (question_id, sort_order)
);

CREATE TABLE IF NOT EXISTS course_practice_attempts (
  id BIGSERIAL PRIMARY KEY,
  practice_id BIGINT NOT NULL REFERENCES course_practices(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'CANCELED')),
  score NUMERIC(8,2),
  max_score NUMERIC(8,2),
  percentage NUMERIC(6,2),
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_course_practice_attempts_unique UNIQUE (practice_id, student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS course_practice_attempt_answers (
  id BIGSERIAL PRIMARY KEY,
  attempt_id BIGINT NOT NULL REFERENCES course_practice_attempts(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES course_practice_questions(id) ON DELETE CASCADE,
  selected_option_id BIGINT REFERENCES course_practice_options(id) ON DELETE SET NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  points_awarded NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_course_practice_attempt_answers_unique UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS attendances (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PRESENTE', 'AUSENTE', 'FALTO', 'TARDE', 'JUSTIFICADO')),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrollment_id, attendance_date)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendances_status_check'
  ) THEN
    ALTER TABLE attendances
    DROP CONSTRAINT attendances_status_check;
  END IF;

  ALTER TABLE attendances
  ADD CONSTRAINT attendances_status_check
  CHECK (status IN ('PRESENTE', 'AUSENTE', 'FALTO', 'TARDE', 'JUSTIFICADO'));
END $$;

CREATE TABLE IF NOT EXISTS assessments (
  id BIGSERIAL PRIMARY KEY,
  course_campus_id BIGINT NOT NULL REFERENCES course_campus(id) ON DELETE CASCADE,
  period_id BIGINT NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
  title VARCHAR(120) NOT NULL,
  assessment_date DATE NOT NULL,
  weight NUMERIC(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grades (
  id BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 20),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, student_id)
);

CREATE TABLE IF NOT EXISTS payment_concepts (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payment_concepts (name, description)
VALUES
  ('MATRICULA', 'Pago de matrícula'),
  ('MENSUALIDAD', 'Pago mensual del curso'),
  ('EXAMEN', 'Derecho de examen'),
  ('OTRO', 'Otros conceptos')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS installments (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  concept_id BIGINT NOT NULL REFERENCES payment_concepts(id) ON DELETE RESTRICT,
  description VARCHAR(160),
  due_date DATE NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (paid_amount <= total_amount)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  amount_received NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  overpayment_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (overpayment_amount >= 0),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method VARCHAR(30) NOT NULL CHECK (method IN ('YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO')),
  reference_code VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')),
  processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes VARCHAR(400),
  evidence_name VARCHAR(180),
  evidence_url TEXT,
  no_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_token TEXT NOT NULL,
  receipt_token_hash VARCHAR(64) NOT NULL UNIQUE,
  receipt_document_type VARCHAR(30) NOT NULL DEFAULT 'BOLETA'
    CHECK (receipt_document_type IN ('BOLETA', 'FACTURA', 'RECIBO_INTERNO')),
  billing_name VARCHAR(180),
  billing_document VARCHAR(20),
  billing_address VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_details (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  installment_id BIGINT NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, installment_id)
);

CREATE TABLE IF NOT EXISTS payment_audit (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  old_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  method VARCHAR(30),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  notes VARCHAR(400)
);

CREATE TABLE IF NOT EXISTS receipt_snapshots (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(30) NOT NULL DEFAULT 'PAYMENT_PREVIEW' CHECK (source IN ('PAYMENT_PREVIEW')),
  payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  payload_html TEXT NOT NULL,
  receipt_token TEXT NOT NULL,
  receipt_token_hash VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id) ON DELETE SET NULL,
  guardian_id BIGINT REFERENCES guardians(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
  recipient VARCHAR(160) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error_message VARCHAR(1000),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_transfer_requests (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source_enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  source_campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  target_campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  allow_without_target_offering BOOLEAN NOT NULL DEFAULT FALSE,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_enrollment_id BIGINT REFERENCES enrollments(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED')),
  request_notes VARCHAR(500),
  review_notes VARCHAR(500),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_campus_id <> target_campus_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(60) NOT NULL,
  action VARCHAR(60) NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role_id ON user_roles(user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_users_base_campus_id ON users(base_campus_id);
CREATE INDEX IF NOT EXISTS idx_users_created_at_desc ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_lower_name ON users(LOWER(first_name), LOWER(last_name));
CREATE INDEX IF NOT EXISTS idx_course_campus_course_id ON course_campus(course_id);
CREATE INDEX IF NOT EXISTS idx_course_campus_campus_id ON course_campus(campus_id);
CREATE INDEX IF NOT EXISTS idx_course_campus_course_campus ON course_campus(course_id, campus_id);
CREATE INDEX IF NOT EXISTS idx_course_campus_modality ON course_campus(modality);
CREATE INDEX IF NOT EXISTS idx_courses_created_at_desc ON courses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_lower_name ON courses(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_students_document_number ON students(document_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_document_number_normalized
  ON users ((UPPER(REGEXP_REPLACE(document_number, '\s+', '', 'g'))))
  WHERE document_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_created_by ON students(created_by);
CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_assigned_campus_id ON students(assigned_campus_id);
CREATE INDEX IF NOT EXISTS idx_student_guardian_guardian_id ON student_guardian(guardian_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_campus_id ON enrollments(course_campus_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_period_id ON enrollments(period_id);
CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_source_status_created
  ON student_transfer_requests(source_campus_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_target_status_created
  ON student_transfer_requests(target_campus_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_student_created
  ON student_transfer_requests(student_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_transfer_requests_pending_source_enrollment
  ON student_transfer_requests(source_enrollment_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_status_created
  ON teacher_assignments(teacher_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_course ON teacher_assignments(course_campus_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_course_period_status
  ON teacher_assignments(course_campus_id, period_id, status);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_period ON teacher_assignments(period_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_status ON teacher_assignments(status);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_override_by ON teacher_assignments(campus_override_by);
CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_teacher_date ON teacher_calendar_events(teacher_user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_assignment ON teacher_calendar_events(assignment_id);
CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_course_campus ON teacher_calendar_events(course_campus_id);
CREATE INDEX IF NOT EXISTS idx_course_forum_topics_assignment ON course_forum_topics(assignment_id);
CREATE INDEX IF NOT EXISTS idx_course_forum_topics_created ON course_forum_topics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_forum_comments_topic ON course_forum_comments(topic_id);
CREATE INDEX IF NOT EXISTS idx_course_forum_comments_created ON course_forum_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_library_resources_assignment_created
  ON course_library_resources(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_library_resources_course_period
  ON course_library_resources(course_campus_id, period_id);
CREATE INDEX IF NOT EXISTS idx_course_library_resources_uploaded_by
  ON course_library_resources(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_course_practices_assignment_created
  ON course_practices(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_practices_course_period
  ON course_practices(course_campus_id, period_id);
CREATE INDEX IF NOT EXISTS idx_course_practice_questions_practice_sort
  ON course_practice_questions(practice_id, sort_order ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_course_practice_options_question_sort
  ON course_practice_options(question_id, sort_order ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_course_practice_attempts_practice_student
  ON course_practice_attempts(practice_id, student_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_course_practice_attempts_submitted
  ON course_practice_attempts(practice_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_practice_attempt_answers_attempt
  ON course_practice_attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_attendances_enrollment_date ON attendances(enrollment_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_assessments_course_period ON assessments(course_campus_id, period_id);
CREATE INDEX IF NOT EXISTS idx_grades_assessment_student ON grades(assessment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_installments_enrollment_id ON installments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_installments_status_due_date ON installments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_enrollment_id ON payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, payment_date);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_receipt_token_hash ON payments(receipt_token_hash);
CREATE INDEX IF NOT EXISTS idx_payment_details_payment_id ON payment_details(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_details_installment_id ON payment_details(installment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_payment_date ON payment_audit(payment_id, changed_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receipt_snapshots_token_hash ON receipt_snapshots(receipt_token_hash);
CREATE INDEX IF NOT EXISTS idx_receipt_snapshots_created_at ON receipt_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_notifications_status_scheduled ON notifications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_desc ON notifications(scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date_desc ON payments(payment_date DESC);

CREATE OR REPLACE VIEW vw_student_balance AS
SELECT
  s.id AS student_id,
  CONCAT(s.first_name, ' ', s.last_name) AS student_name,
  s.document_number,
  COALESCE(SUM(i.total_amount), 0)::NUMERIC(12,2) AS total_amount,
  COALESCE(SUM(i.paid_amount), 0)::NUMERIC(12,2) AS total_paid,
  COALESCE(SUM(i.total_amount - i.paid_amount), 0)::NUMERIC(12,2) AS balance_pending
FROM students s
LEFT JOIN enrollments e ON e.student_id = s.id
LEFT JOIN installments i ON i.enrollment_id = e.id
GROUP BY s.id, s.first_name, s.last_name, s.document_number;

CREATE OR REPLACE VIEW vw_payments_with_campus AS
SELECT
  p.id AS payment_id,
  p.payment_date,
  p.total_amount,
  p.status AS payment_status,
  cp.id AS campus_id,
  cp.name AS campus_name,
  c.id AS course_id,
  c.name AS course_name,
  p.student_id
FROM payments p
JOIN enrollments e ON e.id = p.enrollment_id
JOIN course_campus cc ON cc.id = e.course_campus_id
JOIN campuses cp ON cp.id = cc.campus_id
JOIN courses c ON c.id = cc.course_id;

COMMIT;
