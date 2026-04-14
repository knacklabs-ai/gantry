import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

import { Home } from './pages/Home';
import { PlanView } from './pages/PlanView';

const START_PARAM_PLAN_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function isValidStartParamPlanId(value: string | null | undefined): boolean {
  if (!value) return false;
  return START_PARAM_PLAN_ID_PATTERN.test(value);
}

function StartParamRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    // When opened via t.me/bot/app?startapp=planId, Telegram passes planId
    // as start_param. Redirect to the plan view.
    const webApp = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } })
      .Telegram?.WebApp;
    const startParam = webApp?.initDataUnsafe?.start_param;
    if (isValidStartParamPlanId(startParam)) {
      navigate(`/plans/${startParam}`, { replace: true });
      return;
    }
    // Also check tgWebAppStartParam from URL hash/search
    for (const source of [window.location.hash, window.location.search]) {
      if (!source) continue;
      const params = new URLSearchParams(source.replace(/^[#?]/, ''));
      const param = params.get('tgWebAppStartParam');
      if (isValidStartParamPlanId(param)) {
        navigate(`/plans/${param}`, { replace: true });
        return;
      }
    }
  }, [navigate]);
  return <Home />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<StartParamRedirect />} />
      <Route path="/plans/:planId" element={<PlanView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
