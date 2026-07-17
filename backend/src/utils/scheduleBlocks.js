const ApiError = require('./apiError');

const normalizeScheduleInfo = (value) => {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return normalized || null;
};

const getScheduleBlocks = (scheduleInfo) =>
  String(scheduleInfo || '')
    .split('|')
    .map(normalizeScheduleInfo)
    .filter(Boolean);

const resolveEnrollmentScheduleInfo = (offeringScheduleInfo, requestedScheduleInfo) => {
  const blocks = getScheduleBlocks(offeringScheduleInfo);
  const requested = normalizeScheduleInfo(requestedScheduleInfo);

  if (blocks.length === 0) {
    return null;
  }

  if (!requested) {
    if (blocks.length === 1) {
      return blocks[0];
    }

    throw new ApiError(400, 'Selecciona el bloque horario para esta matrícula.');
  }

  const requestedKey = requested.toUpperCase();
  const matchedBlock = blocks.find((block) => block.toUpperCase() === requestedKey);
  if (!matchedBlock) {
    throw new ApiError(400, 'El bloque horario seleccionado no pertenece al curso elegido.');
  }

  return matchedBlock;
};

module.exports = {
  getScheduleBlocks,
  normalizeScheduleInfo,
  resolveEnrollmentScheduleInfo,
};
