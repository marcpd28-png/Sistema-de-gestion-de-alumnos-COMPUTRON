import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { getCampusScopeId, setCampusScopeId } from '../utils/campusScope';

export default function useDashboardState({
  canViewDashboard,
  canSelectCampus,
  allowGlobalCampusScope,
  fallbackCampusId,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [campuses, setCampuses] = useState([]);
  const [showCampusSelector, setShowCampusSelector] = useState(false);
  const [campusScopeId, setCampusScopeIdState] = useState(() => getCampusScopeId());
  const [campusDraftId, setCampusDraftId] = useState(() => String(getCampusScopeId() || ''));
  const [summary, setSummary] = useState({
    totals: {
      students: 0,
      courses: 0,
      payments: 0,
      income: '0.00',
    },
    recent_payments: [],
    morosity: [],
    charts: {
      payment_status: [],
      payment_methods: [],
      payments_by_day: [],
      morosity_by_campus: [],
    },
    cash_register: {
      today: {
        completed_count: 0,
        voided_count: 0,
        total_completed: '0.00',
        total_voided: '0.00',
        cash_received: '0.00',
        cash_net: '0.00',
        digital_received: '0.00',
        change_given: '0.00',
      },
      open_session: {
        open_count: 0,
        first_session_id: null,
        opening_amount: '0.00',
        expected_cash_amount: '0.00',
        opened_at: null,
      },
      recent_transactions: [],
    },
    visibility: {
      students: false,
      courses: false,
      payments: false,
      reports: false,
      cash_register: false,
    },
  });

  useEffect(() => {
    if (!canViewDashboard) {
      setLoading(false);
      return;
    }

    const loadSummary = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get('/dashboard/summary');
        setSummary(response.data || {});
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'No se pudo cargar el dashboard.');
      } finally {
        setLoading(false);
      }
    };

    loadSummary();
  }, [canViewDashboard, campusScopeId]);

  useEffect(() => {
    if (!canSelectCampus) {
      setCampuses([]);
      return;
    }

    const loadCampuses = async () => {
      try {
        const response = await api.get('/auth/campuses', { _skipCampusScope: true });
        setCampuses(response.data.items || []);
      } catch {
        setCampuses([]);
      }
    };

    loadCampuses();
  }, [canSelectCampus]);

  useEffect(() => {
    setCampusDraftId(String(campusScopeId || ''));
  }, [campusScopeId]);

  const selectedCampusName = useMemo(() => {
    if (!campusScopeId) return allowGlobalCampusScope ? 'Todas las sedes' : 'Sede asignada';
    return campuses.find((campus) => Number(campus.id) === Number(campusScopeId))?.name || `Sede #${campusScopeId}`;
  }, [allowGlobalCampusScope, campusScopeId, campuses]);

  const toggleCampusSelector = () => {
    setShowCampusSelector((current) => !current);
  };

  const applyCampusScope = () => {
    const nextValue = campusDraftId
      ? Number(campusDraftId)
      : allowGlobalCampusScope
        ? null
        : Number(fallbackCampusId) || null;
    setCampusScopeId(nextValue);
    setCampusScopeIdState(nextValue);
    setShowCampusSelector(false);
  };

  const clearCampusScope = () => {
    const nextValue = allowGlobalCampusScope ? null : Number(fallbackCampusId) || null;
    setCampusScopeId(nextValue);
    setCampusScopeIdState(nextValue);
    setCampusDraftId(String(nextValue || ''));
    setShowCampusSelector(false);
  };

  return {
    loading,
    error,
    summary,
    campuses,
    showCampusSelector,
    campusDraftId,
    selectedCampusName,
    setCampusDraftId,
    toggleCampusSelector,
    applyCampusScope,
    clearCampusScope,
  };
}
