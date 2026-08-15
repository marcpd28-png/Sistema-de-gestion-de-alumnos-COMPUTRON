const { randomBytes } = require('crypto');
const { query } = require('./db');
const { PERMISSION_DEFINITIONS, DEFAULT_ROLE_PERMISSIONS } = require('./permissions');
const {
  hashReceiptToken,
  isReceiptTokenEncrypted,
  encryptReceiptToken,
  decryptReceiptToken,
} = require('../services/receiptTokenCrypto.service');

const CASH_SERVICE_SEED_ITEMS = [
  ['CERTIFICADO DE ESTUDIOS OFICIAL POR CICLO', 'Servicio administrativo', 52.0, 10],
  ['CERTIFICADO POR CURSO', 'Servicio administrativo', 40.0, 20],
  ['CERTIFICACION PROGRESIVA CARRERA', 'Servicio administrativo', 22.0, 30],
  ['CERTIFICADOS DE ESTUDIOS CETPRO', 'Servicio administrativo', 82.0, 40],
  ['CONSTANCIA DE ESTUDIOS', 'Servicio administrativo', 27.0, 50],
  ['CONSTANCIA DE MATRICULA', 'Servicio administrativo', 27.0, 60],
  ['CONSTANCIA DE NO ADEUDO', 'Servicio administrativo', 17.0, 70],
  ['CAMBIO DE TURNO', 'Servicio administrativo', 12.0, 80],
  ['CAMBIO DE CARRERA', 'Servicio administrativo', 12.0, 90],
  ['CAMBIO DE LOCAL', 'Servicio administrativo', 12.0, 100],
  ['CARNET DE MEDIO PASAJE', 'Servicio administrativo', 20.0, 110],
  ['CONVALIDACION', 'Servicio administrativo', 22.0, 120],
];

const ensurePassingGradeColumn = async () => {
  const existsResult = await query(`SELECT to_regclass('public.courses') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS passing_grade NUMERIC(4,2)`);
  await query(`UPDATE courses SET passing_grade = 11 WHERE passing_grade IS NULL`);
  await query(`ALTER TABLE courses ALTER COLUMN passing_grade SET DEFAULT 11`);
  await query(`ALTER TABLE courses ALTER COLUMN passing_grade SET NOT NULL`);
  await query(`
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
  `);
};

const ensureCourseCampusModality = async () => {
  const existsResult = await query(`SELECT to_regclass('public.course_campus') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`ALTER TABLE course_campus ADD COLUMN IF NOT EXISTS modality VARCHAR(20)`);
  await query(`UPDATE course_campus SET modality = 'PRESENCIAL' WHERE modality IS NULL`);
  await query(`ALTER TABLE course_campus ALTER COLUMN modality SET DEFAULT 'PRESENCIAL'`);
  await query(`ALTER TABLE course_campus ALTER COLUMN modality SET NOT NULL`);
  await query(`
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
  `);
};

const ensureStudentsCreatedBy = async () => {
  const existsResult = await query(`SELECT to_regclass('public.students') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(
    `ALTER TABLE students
     ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`,
  );
};

const ensureStudentsUserLink = async () => {
  const existsResult = await query(`SELECT to_regclass('public.students') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(
    `ALTER TABLE students
     ADD COLUMN IF NOT EXISTS user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id)`);
};

const ensureStudentsAssignedCampusColumn = async () => {
  const studentsExistsResult = await query(`SELECT to_regclass('public.students') AS table_name`);
  const campusesExistsResult = await query(`SELECT to_regclass('public.campuses') AS table_name`);
  const enrollmentsExistsResult = await query(`SELECT to_regclass('public.enrollments') AS table_name`);
  const courseCampusExistsResult = await query(`SELECT to_regclass('public.course_campus') AS table_name`);
  const studentsExists = Boolean(studentsExistsResult.rows[0]?.table_name);
  const campusesExists = Boolean(campusesExistsResult.rows[0]?.table_name);
  const enrollmentsExists = Boolean(enrollmentsExistsResult.rows[0]?.table_name);
  const courseCampusExists = Boolean(courseCampusExistsResult.rows[0]?.table_name);

  if (!studentsExists || !campusesExists) {
    return;
  }

  await query(
    `ALTER TABLE students
     ADD COLUMN IF NOT EXISTS assigned_campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_students_assigned_campus_id ON students(assigned_campus_id)`);

  if (!enrollmentsExists || !courseCampusExists) {
    return;
  }

  await query(`
    WITH latest_student_campus AS (
      SELECT
        e.student_id,
        cc.campus_id,
        ROW_NUMBER() OVER (
          PARTITION BY e.student_id
          ORDER BY
            CASE WHEN e.status = 'ACTIVE' THEN 0 ELSE 1 END,
            e.updated_at DESC,
            e.id DESC
        ) AS row_number
      FROM enrollments e
      JOIN course_campus cc ON cc.id = e.course_campus_id
      WHERE e.status <> 'TRANSFERRED'
    )
    UPDATE students s
    SET assigned_campus_id = latest_student_campus.campus_id
    FROM latest_student_campus
    WHERE s.id = latest_student_campus.student_id
      AND latest_student_campus.row_number = 1
      AND s.assigned_campus_id IS NULL
  `);
};

const ensureStudentAndEnrollmentNotes = async () => {
  const studentsExistsResult = await query(`SELECT to_regclass('public.students') AS table_name`);
  const enrollmentsExistsResult = await query(`SELECT to_regclass('public.enrollments') AS table_name`);

  if (studentsExistsResult.rows[0]?.table_name) {
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS notes VARCHAR(500)`);
  }

  if (enrollmentsExistsResult.rows[0]?.table_name) {
    await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS notes VARCHAR(500)`);
  }
};

const ensureEnrollmentScheduleInfo = async () => {
  const enrollmentsExistsResult = await query(`SELECT to_regclass('public.enrollments') AS table_name`);

  if (!enrollmentsExistsResult.rows[0]?.table_name) {
    return;
  }

  await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS schedule_info VARCHAR(240)`);
};

const ensureAlumnoRole = async () => {
  const existsResult = await query(`SELECT to_regclass('public.roles') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`INSERT INTO roles (name) VALUES ('ALUMNO') ON CONFLICT (name) DO NOTHING`);
};

const ensureTeacherBaseCampusColumn = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const campusesExistsResult = await query(`SELECT to_regclass('public.campuses') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);
  const campusesExists = Boolean(campusesExistsResult.rows[0]?.table_name);

  if (!usersExists || !campusesExists) {
    return;
  }

  await query(
    `ALTER TABLE users
     ADD COLUMN IF NOT EXISTS base_campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_users_base_campus_id ON users(base_campus_id)`);
};

const ensureUserCampusesTable = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const campusesExistsResult = await query(`SELECT to_regclass('public.campuses') AS table_name`);
  if (!usersExistsResult.rows[0]?.table_name || !campusesExistsResult.rows[0]?.table_name) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS user_campuses (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, campus_id)
    )
  `);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_user_campuses_primary
     ON user_campuses(user_id)
     WHERE is_primary`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_user_campuses_campus_user
     ON user_campuses(campus_id, user_id)`,
  );
  await query(`
    INSERT INTO user_campuses (user_id, campus_id, is_primary)
    SELECT id, base_campus_id, TRUE
    FROM users
    WHERE base_campus_id IS NOT NULL
    ON CONFLICT (user_id, campus_id) DO NOTHING
  `);
};

const ensureUsersDocumentNumberColumn = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS document_number VARCHAR(30)`);
  await query(
    `UPDATE users
     SET document_number = UPPER(REGEXP_REPLACE(document_number, '\\s+', '', 'g'))
     WHERE document_number IS NOT NULL`,
  );

  const duplicateDocuments = await query(
    `SELECT 1
     FROM users
     WHERE document_number IS NOT NULL
     GROUP BY UPPER(REGEXP_REPLACE(document_number, '\\s+', '', 'g'))
     HAVING COUNT(*) > 1
     LIMIT 1`,
  );

  if (duplicateDocuments.rowCount === 0) {
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_document_number_normalized
       ON users ((UPPER(REGEXP_REPLACE(document_number, '\\s+', '', 'g'))))
       WHERE document_number IS NOT NULL`,
    );
  }
};

const ensureUsersContactColumns = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(240)`);
};

const ensureUsersMustChangePasswordColumn = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN`);
  await query(`UPDATE users SET must_change_password = FALSE WHERE must_change_password IS NULL`);
  await query(`ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT FALSE`);
  await query(`ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL`);
};

const ensureEmailActivationModel = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_required BOOLEAN`);
  await query(`UPDATE users SET activation_required = FALSE WHERE activation_required IS NULL`);
  await query(`ALTER TABLE users ALTER COLUMN activation_required SET DEFAULT FALSE`);
  await query(`ALTER TABLE users ALTER COLUMN activation_required SET NOT NULL`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
  await query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose VARCHAR(40) NOT NULL,
      code_hash TEXT NOT NULL,
      attempts SMALLINT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_active
    ON email_verification_codes(user_id, purpose, expires_at DESC)
    WHERE consumed_at IS NULL
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at
    ON email_verification_codes(expires_at)
  `);
};

const ensureTeacherAssignmentOverrideColumns = async () => {
  const existsResult = await query(`SELECT to_regclass('public.teacher_assignments') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS campus_override_reason VARCHAR(300)`);
  await query(
    `ALTER TABLE teacher_assignments
     ADD COLUMN IF NOT EXISTS campus_override_by BIGINT REFERENCES users(id) ON DELETE SET NULL`,
  );
  await query(`ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS campus_override_at TIMESTAMPTZ`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_teacher_assignments_override_by ON teacher_assignments(campus_override_by)`,
  );
};

const ensureTeacherCalendarEvents = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`
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
    )
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_teacher_date
     ON teacher_calendar_events(teacher_user_id, event_date)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_assignment
     ON teacher_calendar_events(assignment_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_teacher_calendar_events_course_campus
     ON teacher_calendar_events(course_campus_id)`,
  );
};

const ensureAttendanceStatusConstraint = async () => {
  const existsResult = await query(`SELECT to_regclass('public.attendances') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`
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
    END
    $$;
  `);
};

const ensureCourseForumTables = async () => {
  const usersExistsResult = await query(`SELECT to_regclass('public.users') AS table_name`);
  const usersExists = Boolean(usersExistsResult.rows[0]?.table_name);

  if (!usersExists) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS course_forum_topics (
      id BIGSERIAL PRIMARY KEY,
      assignment_id BIGINT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
      course_campus_id BIGINT REFERENCES course_campus(id) ON DELETE SET NULL,
      period_id BIGINT REFERENCES academic_periods(id) ON DELETE SET NULL,
      author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      title VARCHAR(180) NOT NULL,
      content TEXT NOT NULL,
      attachment_name VARCHAR(180),
      attachment_url TEXT,
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      grade_score NUMERIC(4,2),
      grade_feedback VARCHAR(300),
      graded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      graded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS course_forum_comments (
      id BIGSERIAL PRIMARY KEY,
      topic_id BIGINT NOT NULL REFERENCES course_forum_topics(id) ON DELETE CASCADE,
      author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      attachment_name VARCHAR(180),
      attachment_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE course_forum_topics ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(180)`);
  await query(`ALTER TABLE course_forum_topics ADD COLUMN IF NOT EXISTS attachment_url TEXT`);
  await query(`ALTER TABLE course_forum_topics ADD COLUMN IF NOT EXISTS grade_score NUMERIC(4,2)`);
  await query(`ALTER TABLE course_forum_topics ADD COLUMN IF NOT EXISTS grade_feedback VARCHAR(300)`);
  await query(
    `ALTER TABLE course_forum_topics
     ADD COLUMN IF NOT EXISTS graded_by BIGINT REFERENCES users(id) ON DELETE SET NULL`,
  );
  await query(`ALTER TABLE course_forum_topics ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ`);

  await query(`ALTER TABLE course_forum_comments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(180)`);
  await query(`ALTER TABLE course_forum_comments ADD COLUMN IF NOT EXISTS attachment_url TEXT`);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_forum_topics_assignment
     ON course_forum_topics(assignment_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_forum_topics_created
     ON course_forum_topics(created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_forum_comments_topic
     ON course_forum_comments(topic_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_forum_comments_created
     ON course_forum_comments(created_at DESC)`,
  );
};

const ensureCourseLibraryTables = async () => {
  const assignmentsExistsResult = await query(
    `SELECT to_regclass('public.teacher_assignments') AS table_name`,
  );
  const assignmentsExists = Boolean(assignmentsExistsResult.rows[0]?.table_name);

  if (!assignmentsExists) {
    return;
  }

  await query(`
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
    )
  `);

  await query(
    `ALTER TABLE course_library_resources
     ADD COLUMN IF NOT EXISTS uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL`,
  );
  await query(`ALTER TABLE course_library_resources ADD COLUMN IF NOT EXISTS description VARCHAR(500)`);
  await query(`ALTER TABLE course_library_resources ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120)`);
  await query(`ALTER TABLE course_library_resources ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT`);
  await query(`UPDATE course_library_resources SET file_size_bytes = 0 WHERE file_size_bytes IS NULL`);
  await query(`ALTER TABLE course_library_resources ALTER COLUMN file_size_bytes SET DEFAULT 0`);
  await query(`ALTER TABLE course_library_resources ALTER COLUMN file_size_bytes SET NOT NULL`);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_library_resources_assignment_created
     ON course_library_resources(assignment_id, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_library_resources_course_period
     ON course_library_resources(course_campus_id, period_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_library_resources_uploaded_by
     ON course_library_resources(uploaded_by_user_id)`,
  );
};

const ensureCoursePracticesTables = async () => {
  const assignmentsExistsResult = await query(
    `SELECT to_regclass('public.teacher_assignments') AS table_name`,
  );
  const assignmentsExists = Boolean(assignmentsExistsResult.rows[0]?.table_name);

  if (!assignmentsExists) {
    return;
  }

  await query(`
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
      max_attempts INTEGER NOT NULL DEFAULT 1,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (max_attempts >= 1 AND max_attempts <= 20),
      CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS course_practice_questions (
      id BIGSERIAL PRIMARY KEY,
      practice_id BIGINT NOT NULL REFERENCES course_practices(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      points NUMERIC(8,2) NOT NULL DEFAULT 1,
      image_name VARCHAR(180),
      image_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (points > 0),
      CHECK (sort_order > 0)
    )
  `);

  await query(
    `ALTER TABLE course_practice_questions
     ADD COLUMN IF NOT EXISTS image_name VARCHAR(180)`,
  );
  await query(
    `ALTER TABLE course_practice_questions
     ADD COLUMN IF NOT EXISTS image_url TEXT`,
  );

  await query(`
    CREATE TABLE IF NOT EXISTS course_practice_options (
      id BIGSERIAL PRIMARY KEY,
      question_id BIGINT NOT NULL REFERENCES course_practice_questions(id) ON DELETE CASCADE,
      option_text VARCHAR(500) NOT NULL,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (sort_order > 0)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS course_practice_attempts (
      id BIGSERIAL PRIMARY KEY,
      practice_id BIGINT NOT NULL REFERENCES course_practices(id) ON DELETE CASCADE,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
      score NUMERIC(8,2),
      max_score NUMERIC(8,2),
      percentage NUMERIC(6,2),
      graded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (attempt_number > 0),
      CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'CANCELED'))
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS course_practice_attempt_answers (
      id BIGSERIAL PRIMARY KEY,
      attempt_id BIGINT NOT NULL REFERENCES course_practice_attempts(id) ON DELETE CASCADE,
      question_id BIGINT NOT NULL REFERENCES course_practice_questions(id) ON DELETE CASCADE,
      selected_option_id BIGINT REFERENCES course_practice_options(id) ON DELETE SET NULL,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE,
      points_awarded NUMERIC(8,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (points_awarded >= 0)
    )
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ux_course_practice_options_question_sort'
      ) THEN
        ALTER TABLE course_practice_options
        ADD CONSTRAINT ux_course_practice_options_question_sort
        UNIQUE (question_id, sort_order);
      END IF;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ux_course_practice_attempts_unique'
      ) THEN
        ALTER TABLE course_practice_attempts
        ADD CONSTRAINT ux_course_practice_attempts_unique
        UNIQUE (practice_id, student_id, attempt_number);
      END IF;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ux_course_practice_attempt_answers_unique'
      ) THEN
        ALTER TABLE course_practice_attempt_answers
        ADD CONSTRAINT ux_course_practice_attempt_answers_unique
        UNIQUE (attempt_id, question_id);
      END IF;
    END
    $$;
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practices_assignment_created
     ON course_practices(assignment_id, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practices_course_period
     ON course_practices(course_campus_id, period_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practice_questions_practice_sort
     ON course_practice_questions(practice_id, sort_order ASC, id ASC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practice_options_question_sort
     ON course_practice_options(question_id, sort_order ASC, id ASC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practice_attempts_practice_student
     ON course_practice_attempts(practice_id, student_id, attempt_number DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practice_attempts_submitted
     ON course_practice_attempts(practice_id, submitted_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_course_practice_attempt_answers_attempt
     ON course_practice_attempt_answers(attempt_id)`,
  );
};

const ensurePermissionsTables = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id BIGSERIAL PRIMARY KEY,
      code VARCHAR(120) UNIQUE NOT NULL,
      module VARCHAR(50) NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (role_id, permission_id)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id)`);
};

const seedPermissionCatalog = async () => {
  for (const permission of PERMISSION_DEFINITIONS) {
    await query(
      `INSERT INTO permissions (code, module, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code)
       DO UPDATE SET
         module = EXCLUDED.module,
         name = EXCLUDED.name,
         description = EXCLUDED.description`,
      [permission.code, permission.module, permission.name, permission.description || null],
    );
  }
};

const seedDefaultRolePermissionsIfEmpty = async () => {
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM role_permissions');
  const count = rows[0]?.count || 0;

  if (count > 0) {
    return;
  }

  for (const [roleName, permissionCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (!permissionCodes.length) continue;

    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       JOIN permissions p ON p.code = ANY($2::text[])
       WHERE r.name = $1
       ON CONFLICT DO NOTHING`,
      [roleName, permissionCodes],
    );
  }
};

const ensurePermissionsModel = async () => {
  await ensurePermissionsTables();
  await seedPermissionCatalog();
  await seedDefaultRolePermissionsIfEmpty();
};

const ensureUsersPersonalPermissionsModel = async () => {
  const [usersTable, permissionsTable] = await Promise.all([
    query(`SELECT to_regclass('public.users') AS table_name`),
    query(`SELECT to_regclass('public.permissions') AS table_name`),
  ]);

  if (!usersTable.rows[0]?.table_name || !permissionsTable.rows[0]?.table_name) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, permission_id)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_user_permissions_permission_id ON user_permissions(permission_id)`);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_mode VARCHAR(20)`);
  await query(`UPDATE users SET permission_mode = 'ROLE' WHERE permission_mode IS NULL`);
  await query(`ALTER TABLE users ALTER COLUMN permission_mode SET DEFAULT 'ROLE'`);
  await query(`ALTER TABLE users ALTER COLUMN permission_mode SET NOT NULL`);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_permission_mode_check'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_permission_mode_check
        CHECK (permission_mode IN ('ROLE', 'PERSONAL'));
      END IF;
    END
    $$;
  `);
};

const ensurePaymentsEvidenceColumns = async () => {
  const existsResult = await query(`SELECT to_regclass('public.payments') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_received NUMERIC(10,2)`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS overpayment_amount NUMERIC(10,2)`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_name VARCHAR(180)`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS evidence_url TEXT`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS no_evidence BOOLEAN`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_token TEXT`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_token_hash VARCHAR(64)`);
  await query(
    `ALTER TABLE payments
     ADD COLUMN IF NOT EXISTS receipt_document_type VARCHAR(30) NOT NULL DEFAULT 'BOLETA'`,
  );
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_name VARCHAR(180)`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_document VARCHAR(20)`);
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_address VARCHAR(240)`);
  await query(`ALTER TABLE payments ALTER COLUMN receipt_token TYPE TEXT`);

  await query(`UPDATE payments SET amount_received = total_amount WHERE amount_received IS NULL`);
  await query(`UPDATE payments SET overpayment_amount = 0 WHERE overpayment_amount IS NULL`);
  await query(`UPDATE payments SET no_evidence = FALSE WHERE no_evidence IS NULL`);

  const paymentTokensResult = await query(
    `SELECT id, receipt_token, receipt_token_hash
     FROM payments
     ORDER BY id ASC`,
  );

  for (const row of paymentTokensResult.rows) {
    const paymentId = Number(row.id);
    const storedToken = String(row.receipt_token || '').trim();
    const storedHash = String(row.receipt_token_hash || '')
      .trim()
      .toLowerCase();

    if (storedToken && storedHash && isReceiptTokenEncrypted(storedToken)) {
      try {
        const decrypted = decryptReceiptToken(storedToken);
        if (hashReceiptToken(decrypted) === storedHash) {
          continue;
        }
      } catch (_error) {
        // Continua para regenerar token cifrado/hash en este registro.
      }
    }

    let rawToken = '';
    if (storedToken) {
      try {
        rawToken = decryptReceiptToken(storedToken);
      } catch (_error) {
        rawToken = '';
      }
    }

    if (!rawToken) {
      rawToken = randomBytes(16).toString('hex');
    }

    const nextHash = hashReceiptToken(rawToken);
    const nextEncryptedToken = encryptReceiptToken(rawToken);
    await query(
      `UPDATE payments
       SET receipt_token = $1,
           receipt_token_hash = $2
       WHERE id = $3`,
      [nextEncryptedToken, nextHash, paymentId],
    );
  }

  await query(`ALTER TABLE payments ALTER COLUMN amount_received SET DEFAULT 0`);
  await query(`ALTER TABLE payments ALTER COLUMN amount_received SET NOT NULL`);
  await query(`ALTER TABLE payments ALTER COLUMN overpayment_amount SET DEFAULT 0`);
  await query(`ALTER TABLE payments ALTER COLUMN overpayment_amount SET NOT NULL`);
  await query(`ALTER TABLE payments ALTER COLUMN no_evidence SET DEFAULT FALSE`);
  await query(`ALTER TABLE payments ALTER COLUMN no_evidence SET NOT NULL`);
  await query(`ALTER TABLE payments ALTER COLUMN receipt_token SET NOT NULL`);
  await query(`ALTER TABLE payments ALTER COLUMN receipt_token_hash SET NOT NULL`);

  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_receipt_token
     ON payments(receipt_token)`,
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_receipt_token_hash
     ON payments(receipt_token_hash)`,
  );

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_amount_received_check'
      ) THEN
        ALTER TABLE payments
        ADD CONSTRAINT payments_amount_received_check
        CHECK (amount_received >= 0);
      END IF;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_overpayment_amount_check'
      ) THEN
        ALTER TABLE payments
        ADD CONSTRAINT payments_overpayment_amount_check
        CHECK (overpayment_amount >= 0);
      END IF;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_method_check'
      ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_method_check;
      END IF;

      ALTER TABLE payments
      ADD CONSTRAINT payments_method_check
      CHECK (method IN ('YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_receipt_document_type_check'
      ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_receipt_document_type_check;
      END IF;

      ALTER TABLE payments
      ADD CONSTRAINT payments_receipt_document_type_check
      CHECK (receipt_document_type IN ('BOLETA', 'FACTURA', 'RECIBO_INTERNO'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);
};

const ensureReceiptSnapshotsTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS receipt_snapshots (
      id BIGSERIAL PRIMARY KEY,
      source VARCHAR(30) NOT NULL DEFAULT 'PAYMENT_PREVIEW'
        CHECK (source IN ('PAYMENT_PREVIEW')),
      payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
      payload_html TEXT NOT NULL,
      receipt_token TEXT NOT NULL,
      receipt_token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_receipt_snapshots_token_hash
     ON receipt_snapshots(receipt_token_hash)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_receipt_snapshots_created_at
     ON receipt_snapshots(created_at DESC)`,
  );
};

const ensureCashRegisterRolePermissions = async () => {
  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM roles r
     JOIN permissions p ON p.code = ANY($2::text[])
     WHERE r.name = ANY($1::text[])
     ON CONFLICT DO NOTHING`,
    [
      ['DIRECTOR', 'SECRETARIADO'],
      ['cash_register.view', 'cash_register.manage'],
    ],
  );
};

const ensureCashRegisterTables = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS cash_service_items (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(140) UNIQUE NOT NULL,
      description VARCHAR(240),
      default_price NUMERIC(10,2) NOT NULL CHECK (default_price >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const [name, description, defaultPrice, sortOrder] of CASH_SERVICE_SEED_ITEMS) {
    await query(
      `INSERT INTO cash_service_items (name, description, default_price, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING`,
      [name, description, defaultPrice, sortOrder],
    );
  }

  await query(`
    CREATE TABLE IF NOT EXISTS cash_register_sessions (
      id BIGSERIAL PRIMARY KEY,
      campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
      opening_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
      opened_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closing_amount NUMERIC(10,2) CHECK (closing_amount IS NULL OR closing_amount >= 0),
      expected_cash_amount NUMERIC(10,2),
      difference_amount NUMERIC(10,2),
      closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      closed_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
      notes VARCHAR(400),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cash_transactions (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES cash_register_sessions(id) ON DELETE RESTRICT,
      campus_id BIGINT NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
      student_id BIGINT REFERENCES students(id) ON DELETE SET NULL,
      customer_name VARCHAR(180) NOT NULL,
      customer_document VARCHAR(20),
      customer_address VARCHAR(240),
      total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
      amount_received NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
      change_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
      method VARCHAR(30) NOT NULL CHECK (method IN ('YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO', 'MIXTO')),
      reference_code VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
      receipt_document_type VARCHAR(30) NOT NULL DEFAULT 'BOLETA'
        CHECK (receipt_document_type IN ('BOLETA', 'FACTURA', 'RECIBO_INTERNO')),
      billing_name VARCHAR(180),
      billing_document VARCHAR(20),
      billing_address VARCHAR(240),
      receipt_token TEXT NOT NULL,
      receipt_token_hash VARCHAR(64) NOT NULL UNIQUE,
      notes VARCHAR(400),
      processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cash_transactions_method_check'
      ) THEN
        ALTER TABLE cash_transactions
        DROP CONSTRAINT cash_transactions_method_check;
      END IF;

      ALTER TABLE cash_transactions
      ADD CONSTRAINT cash_transactions_method_check
      CHECK (method IN ('YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO', 'MIXTO'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cash_transaction_items (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES cash_transactions(id) ON DELETE CASCADE,
      service_item_id BIGINT REFERENCES cash_service_items(id) ON DELETE SET NULL,
      description VARCHAR(180) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
      total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cash_transaction_payments (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES cash_transactions(id) ON DELETE CASCADE,
      method VARCHAR(30) NOT NULL CHECK (method IN ('YAPE', 'PLIN', 'TRANSFERENCIA', 'QR', 'TARJETA', 'CANJE', 'EFECTIVO', 'OTRO')),
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      reference_code VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS cash_transaction_audit (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES cash_transactions(id) ON DELETE CASCADE,
      old_status VARCHAR(20),
      new_status VARCHAR(20) NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      notes VARCHAR(400)
    )
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_register_sessions_open_campus
    ON cash_register_sessions(campus_id)
    WHERE status = 'OPEN'
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_register_sessions_campus_opened
     ON cash_register_sessions(campus_id, opened_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_service_items_active_sort
     ON cash_service_items(is_active, sort_order, name)`,
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_cash_transactions_session_id ON cash_transactions(session_id)`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_transactions_campus_created
     ON cash_transactions(campus_id, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_transactions_status_method
     ON cash_transactions(status, method)`,
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_transactions_receipt_token_hash
     ON cash_transactions(receipt_token_hash)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_transaction_items_transaction_id
     ON cash_transaction_items(transaction_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_transaction_payments_transaction_id
     ON cash_transaction_payments(transaction_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_cash_transaction_audit_transaction_date
     ON cash_transaction_audit(transaction_id, changed_at DESC)`,
  );
};

const ensureElectronicDocumentSubmissionTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS electronic_document_submissions (
      id BIGSERIAL PRIMARY KEY,
      source_type VARCHAR(40) NOT NULL CHECK (source_type IN ('CASH_TRANSACTION', 'PAYMENT')),
      source_id BIGINT NOT NULL,
      receipt_document_type VARCHAR(30) NOT NULL CHECK (receipt_document_type IN ('BOLETA', 'FACTURA')),
      sunat_document_type VARCHAR(2) NOT NULL CHECK (sunat_document_type IN ('01', '03')),
      sunat_api_document_id VARCHAR(80),
      sunat_series VARCHAR(8),
      sunat_document_number VARCHAR(40),
      sunat_status VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE',
      sunat_message TEXT,
      sunat_error_code VARCHAR(80),
      request_payload JSONB,
      create_response JSONB,
      send_response JSONB,
      submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_type, source_id)
    )
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_electronic_document_submissions_source
     ON electronic_document_submissions(source_type, source_id)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_electronic_document_submissions_status
     ON electronic_document_submissions(sunat_status, created_at DESC)`,
  );
};

const ensureEnrollmentTransferStatus = async () => {
  const existsResult = await query(`SELECT to_regclass('public.enrollments') AS table_name`);
  const tableExists = Boolean(existsResult.rows[0]?.table_name);

  if (!tableExists) {
    return;
  }

  await query(`
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
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);
};

const ensureCertificateLibraryTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS certificate_library (
      id BIGSERIAL PRIMARY KEY,
      certificate_code VARCHAR(120),
      student_name VARCHAR(180) NOT NULL,
      student_document VARCHAR(60),
      course_name VARCHAR(180),
      hours_academic INTEGER,
      modality VARCHAR(40),
      start_date DATE,
      end_date DATE,
      issue_date DATE,
      city VARCHAR(120),
      organization VARCHAR(180),
      campus_id BIGINT REFERENCES campuses(id) ON DELETE SET NULL,
      validation_token VARCHAR(64) UNIQUE,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE certificate_library ADD COLUMN IF NOT EXISTS validation_token VARCHAR(64) UNIQUE`);
  const certificatesWithoutToken = await query(
    `SELECT id
     FROM certificate_library
     WHERE validation_token IS NULL`,
  );
  for (const row of certificatesWithoutToken.rows) {
    await query(
      `UPDATE certificate_library
       SET validation_token = $1
       WHERE id = $2
         AND validation_token IS NULL`,
      [randomBytes(24).toString('hex'), row.id],
    );
  }
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_certificate_library_token
    ON certificate_library(validation_token)
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'certificate_library_hours_academic_check'
      ) THEN
        ALTER TABLE certificate_library
        ADD CONSTRAINT certificate_library_hours_academic_check
        CHECK (hours_academic IS NULL OR hours_academic > 0);
      END IF;
    END
    $$;
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_certificate_library_created_at_desc
     ON certificate_library(created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_certificate_library_campus_created
     ON certificate_library(campus_id, created_at DESC)`,
  );
};

const ensureStudentTransferRequestsTable = async () => {
  await query(`
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
    )
  `);
  await query(
    `ALTER TABLE student_transfer_requests
     ADD COLUMN IF NOT EXISTS allow_without_target_offering BOOLEAN NOT NULL DEFAULT FALSE`,
  );

  await query(
    `CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_source_status_created
     ON student_transfer_requests(source_campus_id, status, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_target_status_created
     ON student_transfer_requests(target_campus_id, status, created_at DESC)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_student_transfer_requests_student_created
     ON student_transfer_requests(student_id, created_at DESC)`,
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_student_transfer_requests_pending_source_enrollment
     ON student_transfer_requests(source_enrollment_id)
     WHERE status = 'PENDING'`,
  );
};

const ensurePerformanceIndexes = async () => {
  const [
    refreshTokensTable,
    paymentsTable,
    notificationsTable,
    usersTable,
    userRolesTable,
    teacherAssignmentsTable,
    courseCampusTable,
    coursesTable,
  ] = await Promise.all([
    query(`SELECT to_regclass('public.refresh_tokens') AS table_name`),
    query(`SELECT to_regclass('public.payments') AS table_name`),
    query(`SELECT to_regclass('public.notifications') AS table_name`),
    query(`SELECT to_regclass('public.users') AS table_name`),
    query(`SELECT to_regclass('public.user_roles') AS table_name`),
    query(`SELECT to_regclass('public.teacher_assignments') AS table_name`),
    query(`SELECT to_regclass('public.course_campus') AS table_name`),
    query(`SELECT to_regclass('public.courses') AS table_name`),
  ]);

  if (refreshTokensTable.rows[0]?.table_name) {
    await query(
      `DELETE FROM refresh_tokens old_rt
       USING refresh_tokens newer_rt
       WHERE old_rt.token_hash = newer_rt.token_hash
         AND old_rt.id < newer_rt.id`,
    );
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
       ON refresh_tokens(token_hash)`,
    );
  }

  if (paymentsTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_payments_payment_date_desc
       ON payments(payment_date DESC)`,
    );
  }

  if (notificationsTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_desc
       ON notifications(scheduled_at DESC)`,
    );
  }

  if (usersTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_users_created_at_desc
       ON users(created_at DESC)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_users_lower_name
       ON users(LOWER(first_name), LOWER(last_name))`,
    );
  }

  if (userRolesTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role_id
       ON user_roles(user_id, role_id)`,
    );
  }

  if (teacherAssignmentsTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_status_created
       ON teacher_assignments(teacher_user_id, status, created_at DESC)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_teacher_assignments_course_period_status
       ON teacher_assignments(course_campus_id, period_id, status)`,
    );
  }

  if (courseCampusTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_course_campus_course_campus
       ON course_campus(course_id, campus_id)`,
    );
  }

  if (coursesTable.rows[0]?.table_name) {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_courses_created_at_desc
       ON courses(created_at DESC)`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_courses_lower_name
       ON courses(LOWER(name))`,
    );
  }
};

const runBootMigrations = async () => {
  await ensurePassingGradeColumn();
  await ensureCourseCampusModality();
  await ensureStudentsCreatedBy();
  await ensureStudentsUserLink();
  await ensureStudentsAssignedCampusColumn();
  await ensureStudentAndEnrollmentNotes();
  await ensureEnrollmentScheduleInfo();
  await ensureAlumnoRole();
  await ensureTeacherBaseCampusColumn();
  await ensureUserCampusesTable();
  await ensureUsersDocumentNumberColumn();
  await ensureUsersContactColumns();
  await ensureUsersMustChangePasswordColumn();
  await ensureEmailActivationModel();
  await ensureTeacherAssignmentOverrideColumns();
  await ensureTeacherCalendarEvents();
  await ensureCourseForumTables();
  await ensureCourseLibraryTables();
  await ensureCoursePracticesTables();
  await ensureAttendanceStatusConstraint();
  await ensurePermissionsModel();
  await ensureCashRegisterRolePermissions();
  await ensureUsersPersonalPermissionsModel();
  await ensurePaymentsEvidenceColumns();
  await ensureReceiptSnapshotsTable();
  await ensureCashRegisterTables();
  await ensureElectronicDocumentSubmissionTable();
  await ensureEnrollmentTransferStatus();
  await ensureCertificateLibraryTable();
  await ensureStudentTransferRequestsTable();
  await ensurePerformanceIndexes();
};

module.exports = { runBootMigrations };
