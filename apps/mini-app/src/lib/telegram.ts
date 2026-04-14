type TelegramBackButton = {
  show?: () => void;
  hide?: () => void;
  onClick?: (handler: () => void) => void;
  offClick?: (handler: () => void) => void;
};

type TelegramHapticFeedback = {
  impactOccurred?: (
    style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft',
  ) => void;
  selectionChanged?: () => void;
  notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
};

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
  themeParams?: {
    bg_color?: string;
    text_color?: string;
    button_color?: string;
  };
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
};

export function getTelegramWebApp(): TelegramWebApp | undefined {
  const candidate = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
    .Telegram?.WebApp;
  return candidate;
}

function getInitDataFromLaunchParams(): string | undefined {
  const sources = [window.location.search, window.location.hash];
  for (const source of sources) {
    if (!source) continue;
    const normalized = source.startsWith('?') || source.startsWith('#')
      ? source.slice(1)
      : source;
    if (!normalized) continue;
    const params = new URLSearchParams(normalized);
    const tgData = params.get('tgWebAppData');
    if (typeof tgData === 'string' && tgData.trim()) return tgData.trim();
    const initData = params.get('initData');
    if (typeof initData === 'string' && initData.trim()) return initData.trim();
  }
  return undefined;
}

export function getTelegramInitData(): string | undefined {
  const webApp = getTelegramWebApp();
  if (typeof webApp?.initData === 'string' && webApp.initData.trim()) {
    return webApp.initData.trim();
  }
  return getInitDataFromLaunchParams();
}

export function impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred?.(style);
}

export function selectionChanged(): void {
  getTelegramWebApp()?.HapticFeedback?.selectionChanged?.();
}

export function notification(type: 'error' | 'success' | 'warning'): void {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred?.(type);
}

export function bindBackButton(onBack: () => void): VoidFunction {
  const button = getTelegramWebApp()?.BackButton;
  if (!button) return () => undefined;

  button.show?.();
  button.onClick?.(onBack);

  return () => {
    button.offClick?.(onBack);
    button.hide?.();
  };
}
