import { useEffect, useState } from 'react';
import { getTelegramInitData } from '../lib/telegram';

export function useAuth(): { initData?: string } {
  const [initData, setInitData] = useState<string | undefined>(() =>
    getTelegramInitData(),
  );

  useEffect(() => {
    if (initData) return;

    let attempts = 0;
    const maxAttempts = 40; // 10 seconds at 250ms intervals
    const timer = window.setInterval(() => {
      const next = getTelegramInitData();
      if (next) {
        setInitData(next);
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [initData]);

  return {
    ...(initData ? { initData } : {}),
  };
}
