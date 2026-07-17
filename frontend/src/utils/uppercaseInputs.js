const SKIPPED_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'email',
  'file',
  'hidden',
  'image',
  'month',
  'number',
  'password',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'url',
  'week',
]);

const shouldUppercaseElement = (element) => {
  if (!element || element.readOnly || element.disabled) return false;
  if (element.dataset?.preserveCase === 'true') return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;

  const type = String(element.type || 'text').toLowerCase();
  return !SKIPPED_INPUT_TYPES.has(type);
};

const uppercaseElementValue = (element) => {
  if (!shouldUppercaseElement(element)) return false;

  const currentValue = element.value;
  const nextValue = currentValue.toLocaleUpperCase('es-PE');
  if (currentValue === nextValue) return false;

  const selectionStart = element.selectionStart;
  const selectionEnd = element.selectionEnd;
  element.value = nextValue;

  if (
    document.activeElement === element &&
    typeof selectionStart === 'number' &&
    typeof selectionEnd === 'number'
  ) {
    element.setSelectionRange(selectionStart, selectionEnd);
  }

  return true;
};

const normalizeInputEvent = (event) => {
  if (event.isComposing) return;
  uppercaseElementValue(event.target);
};

const normalizeCompositionEnd = (event) => {
  if (uppercaseElementValue(event.target)) {
    event.target.dispatchEvent(new Event('input', { bubbles: true }));
  }
};

export const installUppercaseInputs = () => {
  window.__computronUppercaseInputsCleanup?.();

  document.addEventListener('input', normalizeInputEvent, true);
  document.addEventListener('compositionend', normalizeCompositionEnd, true);

  window.__computronUppercaseInputsCleanup = () => {
    document.removeEventListener('input', normalizeInputEvent, true);
    document.removeEventListener('compositionend', normalizeCompositionEnd, true);
    window.__computronUppercaseInputsCleanup = null;
  };

  return window.__computronUppercaseInputsCleanup;
};
