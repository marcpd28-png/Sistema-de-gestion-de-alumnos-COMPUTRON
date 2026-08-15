const { query } = require('../config/db');
const env = require('../config/env');
const { sendMail } = require('./email.service');

const REMINDER_JOB_TYPE = 'REMINDERS';
const MAX_STORED_JOBS = 300;
const jobs = new Map();
const queue = [];
let workerCount = 0;
let sequence = 1;

const createJobId = () => `${Date.now()}-${sequence++}`;

const toJobView = (job) => ({
  id: job.id,
  type: job.type,
  status: job.status,
  requested_by: job.requestedBy,
  created_at: job.createdAt,
  started_at: job.startedAt,
  finished_at: job.finishedAt,
  summary: job.summary,
  error_message: job.errorMessage,
});

const trimStoredJobs = () => {
  if (jobs.size <= MAX_STORED_JOBS) {
    return;
  }

  const ordered = [...jobs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const staleJob of ordered.slice(MAX_STORED_JOBS)) {
    jobs.delete(staleJob.id);
  }
};

const runWithConcurrency = async (items, limit, worker) => {
  const maxLimit = Math.max(1, limit);
  const active = new Set();

  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    active.add(task);

    task.finally(() => {
      active.delete(task);
    });

    if (active.size >= maxLimit) {
      await Promise.race(active);
    }
  }

  await Promise.all(active);
};

const buildRecipientsByStudent = (guardianRows = []) => {
  const recipientsByStudent = new Map();

  for (const guardian of guardianRows) {
    const studentId = String(guardian.student_id);
    if (!recipientsByStudent.has(studentId)) {
      recipientsByStudent.set(studentId, []);
    }

    recipientsByStudent.get(studentId).push({
      email: guardian.email,
      guardian_id: guardian.guardian_id,
    });
  }

  return recipientsByStudent;
};

const normalizeRecipientEmail = (value) => (value || '').trim().toLowerCase();

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const executeReminderJob = async (requestedBy) => {
  const dueInstallments = await query(
    `SELECT
       i.id AS installment_id,
       i.due_date,
       i.total_amount,
       i.paid_amount,
       (i.total_amount - i.paid_amount) AS pending_amount,
       s.id AS student_id,
       s.first_name AS student_first_name,
       s.last_name AS student_last_name,
       s.email AS student_email,
       e.id AS enrollment_id,
       c.name AS course_name,
       cp.name AS campus_name
     FROM installments i
     JOIN enrollments e ON e.id = i.enrollment_id
     JOIN students s ON s.id = e.student_id
     JOIN course_campus cc ON cc.id = e.course_campus_id
     JOIN courses c ON c.id = cc.course_id
     JOIN campuses cp ON cp.id = cc.campus_id
     WHERE i.status IN ('PENDING', 'PARTIAL')
       AND i.due_date = CURRENT_DATE + INTERVAL '4 day'
     ORDER BY i.due_date`,
  );

  if (dueInstallments.rowCount === 0) {
    return { due_installments: 0, sent: 0, simulated: 0, failed: 0 };
  }

  const studentIds = [...new Set(dueInstallments.rows.map((row) => Number(row.student_id)))];
  const guardianResult = await query(
    `SELECT
       sg.student_id,
       g.id AS guardian_id,
       g.email
     FROM student_guardian sg
     JOIN guardians g ON g.id = sg.guardian_id
     WHERE sg.student_id = ANY($1::bigint[])
       AND g.email IS NOT NULL`,
    [studentIds],
  );

  const recipientsByStudent = buildRecipientsByStudent(guardianResult.rows);
  const tasks = [];

  for (const installment of dueInstallments.rows) {
    const recipients = [];
    const uniqueRecipientMap = new Map();

    if (installment.student_email) {
      recipients.push({ email: installment.student_email, guardian_id: null });
    }

    const guardianRecipients = recipientsByStudent.get(String(installment.student_id)) || [];
    recipients.push(...guardianRecipients);

    for (const recipient of recipients) {
      const normalizedEmail = normalizeRecipientEmail(recipient.email);
      if (!normalizedEmail) continue;
      if (!uniqueRecipientMap.has(normalizedEmail)) {
        uniqueRecipientMap.set(normalizedEmail, {
          email: normalizedEmail,
          guardian_id: recipient.guardian_id,
        });
      }
    }

    const pendingAmount = String(installment.pending_amount ?? '');
    const dueDate = String(installment.due_date ?? '');
    const courseName = String(installment.course_name ?? '');
    const campusName = String(installment.campus_name ?? '');
    const subject = `Recordatorio de pago - ${courseName} (${campusName})`;
    const text = `Hola, tienes una cuota pendiente de ${pendingAmount} con vencimiento el ${dueDate}.`;
    const html = `<p>Hola,</p><p>Tienes una cuota pendiente de <strong>${escapeHtml(
      pendingAmount,
    )}</strong>.</p><p>Curso: ${escapeHtml(courseName)}</p><p>Sede: ${escapeHtml(
      campusName,
    )}</p><p>Vence el: ${escapeHtml(dueDate)}</p>`;

    for (const recipient of uniqueRecipientMap.values()) {
      tasks.push({
        studentId: installment.student_id,
        guardianId: recipient.guardian_id,
        recipient: recipient.email,
        subject,
        text,
        html,
      });
    }
  }

  let sent = 0;
  let simulated = 0;
  let failed = 0;

  await runWithConcurrency(tasks, env.notificationWorkerConcurrency, async (task) => {
    try {
      const result = await sendMail({
        to: task.recipient,
        subject: task.subject,
        text: task.text,
        html: task.html,
      });

      if (result.simulated) {
        simulated += 1;
      } else {
        sent += 1;
      }

      await query(
        `INSERT INTO notifications (
          student_id,
          guardian_id,
          channel,
          recipient,
          subject,
          body,
          status,
          sent_at,
          created_by
         )
         VALUES ($1, $2, 'EMAIL', $3, $4, $5, 'SENT', NOW(), $6)`,
        [task.studentId, task.guardianId, task.recipient, task.subject, task.text, requestedBy],
      );
    } catch (error) {
      failed += 1;

      await query(
        `INSERT INTO notifications (
          student_id,
          guardian_id,
          channel,
          recipient,
          subject,
          body,
          status,
          error_message,
          created_by
         )
         VALUES ($1, $2, 'EMAIL', $3, $4, $5, 'FAILED', $6, $7)`,
        [
          task.studentId,
          task.guardianId,
          task.recipient,
          task.subject,
          task.text,
          String(error.message || 'Error enviando correo').slice(0, 900),
          requestedBy,
        ],
      );
    }
  });

  return {
    due_installments: dueInstallments.rowCount,
    sent,
    simulated,
    failed,
  };
};

const processNextJob = async () => {
  if (workerCount >= env.notificationWorkerConcurrency || queue.length === 0) {
    return;
  }

  const jobId = queue.shift();
  const job = jobs.get(jobId);

  if (!job || job.status !== 'PENDING') {
    setImmediate(processNextJob);
    return;
  }

  workerCount += 1;
  job.status = 'PROCESSING';
  job.startedAt = new Date();

  try {
    job.summary = await executeReminderJob(job.requestedBy);
    job.status = 'COMPLETED';
  } catch (error) {
    job.status = 'FAILED';
    job.errorMessage = String(error.message || 'Error inesperado').slice(0, 900);
  } finally {
    job.finishedAt = new Date();
    workerCount -= 1;
    trimStoredJobs();
    setImmediate(processNextJob);
  }
};

const queueReminderJob = ({ requestedBy }) => {
  if (queue.length >= env.notificationWorkerMaxQueue) {
    const overloadError = new Error('La cola de notificaciones alcanzó su capacidad máxima.');
    overloadError.statusCode = 429;
    throw overloadError;
  }

  const job = {
    id: createJobId(),
    type: REMINDER_JOB_TYPE,
    status: 'PENDING',
    requestedBy,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    summary: null,
    errorMessage: null,
  };

  jobs.set(job.id, job);
  queue.push(job.id);
  setImmediate(processNextJob);

  return toJobView(job);
};

const getReminderJob = (jobId) => {
  const job = jobs.get(String(jobId));
  return job ? toJobView(job) : null;
};

const listReminderJobs = (limit = 25) => {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 25, 100));

  return [...jobs.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, boundedLimit)
    .map(toJobView);
};

module.exports = {
  queueReminderJob,
  getReminderJob,
  listReminderJobs,
};
