import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { openSecureFile } from '../utils/secureFiles';

const ACCEPTED_RESOURCE_TYPES =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.jpg,.jpeg,.png,.webp';

const createUploadDefaults = () => ({
  title: '',
  description: '',
  file: null,
});

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatFileSize = (bytes) => {
  const numericValue = Number(bytes || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '0 KB';
  if (numericValue < 1024) return `${numericValue} B`;
  if (numericValue < 1024 * 1024) return `${(numericValue / 1024).toFixed(1)} KB`;
  return `${(numericValue / (1024 * 1024)).toFixed(2)} MB`;
};

export default function CourseResourcesPanel({
  assignmentId,
  title = 'Biblioteca del aula virtual',
  description = 'Consulta los archivos compartidos para este salon.',
  canUpload = false,
  canDelete = false,
  emptyMessage = 'Aun no hay archivos cargados para este salon.',
}) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploadForm, setUploadForm] = useState(createUploadDefaults);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadResources = useCallback(async () => {
    if (!assignmentId) {
      setResources([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/course-library/assignments/${assignmentId}/resources`);
      setResources(response.data?.items || []);
    } catch (requestError) {
      setResources([]);
      setError(requestError.response?.data?.message || 'No se pudieron cargar los archivos del aula virtual.');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const resetUploadForm = () => {
    setUploadForm(createUploadDefaults());
    setFileInputKey((current) => current + 1);
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!assignmentId || !canUpload) return;
    if (!uploadForm.file) {
      setError('Selecciona un archivo antes de cargarlo.');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadForm.file);
    formData.append('title', uploadForm.title);
    formData.append('description', uploadForm.description);

    setUploading(true);
    setMessage('');
    setError('');
    try {
      await api.post(`/course-library/assignments/${assignmentId}/resources`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMessage('Archivo cargado correctamente.');
      resetUploadForm();
      await loadResources();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo cargar el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (resource) => {
    if (!assignmentId || !canDelete || !resource?.id) return;

    const confirmed = window.confirm(`Se eliminara el archivo "${resource.title}". ¿Continuar?`);
    if (!confirmed) return;

    setDeletingId(resource.id);
    setMessage('');
    setError('');
    try {
      await api.delete(`/course-library/assignments/${assignmentId}/resources/${resource.id}`);
      setMessage('Archivo eliminado.');
      await loadResources();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo eliminar el archivo.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenResource = async (resource, { download = false } = {}) => {
    if (!assignmentId || !resource?.id) return;

    setOpeningId(`${resource.id}:${download ? 'download' : 'view'}`);
    setError('');
    try {
      await openSecureFile({
        url: `/course-library/assignments/${assignmentId}/resources/${resource.id}/file`,
        filename: resource.file_name || resource.title || 'archivo',
        download,
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudo abrir el archivo.');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <article className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
          <p className="text-sm text-primary-700">{description}</p>
        </div>
        <button
          type="button"
          onClick={loadResources}
          disabled={loading}
          className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-xs font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {message ? <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {canUpload ? (
        <form onSubmit={handleUpload} className="panel-soft space-y-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <label className="space-y-1 text-sm text-primary-800">
              <span className="font-medium">Titulo</span>
              <input
                className="app-input"
                placeholder="Guia, separata, indicaciones..."
                value={uploadForm.title}
                onChange={(event) =>
                  setUploadForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-primary-800">
              <span className="font-medium">Descripcion</span>
              <input
                className="app-input"
                placeholder="Detalle opcional del archivo"
                value={uploadForm.description}
                onChange={(event) =>
                  setUploadForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-primary-800">
              Archivo
              <input
                key={fileInputKey}
                type="file"
                accept={ACCEPTED_RESOURCE_TYPES}
                className="mt-1 block w-full text-xs"
                onChange={(event) =>
                  setUploadForm((current) => ({ ...current, file: event.target.files?.[0] || null }))
                }
              />
            </label>
            <p className="text-xs text-primary-700">
              Permitidos: PDF, Office, TXT, ZIP e imagenes. Maximo 15 MB.
            </p>
          </div>

          {uploadForm.file ? (
            <p className="text-xs text-primary-700">
              Seleccionado: {uploadForm.file.name} ({formatFileSize(uploadForm.file.size)})
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={uploading}
              className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? 'Cargando...' : 'Cargar archivo'}
            </button>
            <button
              type="button"
              onClick={resetUploadForm}
              className="rounded-xl border border-primary-300 bg-white px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50"
            >
              Limpiar
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <p className="text-sm text-primary-700">Cargando archivos...</p> : null}

      {!loading && resources.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {resources.map((resource) => (
            <div key={resource.id} className="rounded-2xl border border-primary-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold text-primary-900">{resource.title}</p>
                  {resource.description ? (
                    <p className="mt-1 text-sm text-primary-700">{resource.description}</p>
                  ) : null}
                </div>
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[11px] font-semibold text-primary-800">
                  {formatFileSize(resource.file_size_bytes)}
                </span>
              </div>

              <div className="mt-3 space-y-1 text-xs text-primary-600">
                <p>Archivo: {resource.file_name}</p>
                <p>Subido por: {resource.uploaded_by_name || 'Usuario del sistema'}</p>
                <p>Fecha: {formatDateTime(resource.created_at)}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenResource(resource)}
                  disabled={openingId === `${resource.id}:view`}
                  className="rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-800"
                >
                  {openingId === `${resource.id}:view` ? 'Abriendo...' : 'Ver archivo'}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenResource(resource, { download: true })}
                  disabled={openingId === `${resource.id}:download`}
                  className="rounded-lg border border-primary-300 bg-white px-3 py-2 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                >
                  {openingId === `${resource.id}:download` ? 'Descargando...' : 'Descargar'}
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(resource)}
                    disabled={deletingId === resource.id}
                    className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === resource.id ? 'Eliminando...' : 'Eliminar'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !resources.length ? <p className="text-sm text-primary-700">{emptyMessage}</p> : null}
    </article>
  );
}
