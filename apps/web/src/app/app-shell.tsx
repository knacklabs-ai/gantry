import * as Dialog from '@radix-ui/react-dialog';
import { Link, Outlet } from '@tanstack/react-router';
import { LayoutDashboard, Menu, Moon, Settings2, Sun, X } from 'lucide-react';
import { useState } from 'react';

import { ConnectionState } from '../ui/compositions/connection-state';
import { IconButton } from '../ui/primitives/icon-button';
import { usePreferences } from '../features/preferences/preferences-provider';

const navigation = [
  { to: '/profile', label: 'Profile', icon: Settings2 },
] as const;

const NAV_ITEM_CLASS_NAME =
  'flex min-h-9 items-center gap-2.5 rounded-md border border-transparent px-2.5 text-[13px] font-medium text-text-secondary no-underline hover:bg-surface-muted hover:text-text';
const NAV_ITEM_ACTIVE_CLASS_NAME =
  'border-border-strong bg-surface-strong text-text';

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { effectiveTheme, setTheme } = usePreferences();
  const nextTheme = effectiveTheme === 'dark' ? 'light' : 'dark';

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[232px_minmax(0,1fr)]">
      <a
        className="absolute top-[-48px] left-3 z-30 bg-ink px-3 py-2 text-sm text-ink-on focus-visible:top-3"
        href="#main-content"
      >
        Skip to content
      </a>
      <aside
        aria-label="Primary navigation"
        className="hidden min-h-dvh border-r border-border bg-surface px-3 pt-[18px] pb-4 lg:block"
      >
        <Navigation />
      </aside>
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-20 bg-black/35 lg:hidden" />
          <Dialog.Content
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-[21] w-[min(284px,calc(100vw-32px))] border-r border-border bg-surface px-3 pt-[18px] pb-4 shadow-drawer lg:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton
                aria-label="Close navigation"
                className="absolute top-[14px] right-[14px]"
                title="Close navigation"
              >
                <X size={18} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
            <Navigation onNavigate={() => setDrawerOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="grid min-w-0 grid-rows-[64px_minmax(0,1fr)]">
        <header className="relative flex min-w-0 items-center justify-between border-b border-border bg-canvas/90 px-4 after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[3px] after:bg-status-idle sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lg:hidden">
              <IconButton
                aria-label="Open navigation"
                title="Open navigation"
                onClick={() => setDrawerOpen(true)}
              >
                <Menu size={18} aria-hidden="true" />
              </IconButton>
            </div>
            <ConnectionState />
          </div>
          <IconButton
            aria-label={`Switch to ${nextTheme} theme`}
            title={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
          >
            {effectiveTheme === 'dark' ? (
              <Sun size={17} aria-hidden="true" />
            ) : (
              <Moon size={17} aria-hidden="true" />
            )}
          </IconButton>
        </header>
        <main id="main-content" className="min-w-0 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link
        className="inline-flex min-h-10 items-center gap-2.5 px-2 text-[17px] font-semibold text-text no-underline"
        to="/"
        onClick={onNavigate}
      >
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-ink font-mono text-xs font-bold text-ink-on">
          G
        </span>
        <span>Gantry</span>
      </Link>
      <nav className="mt-7 grid gap-1">
        <Link
          activeOptions={{ exact: true }}
          activeProps={{ className: NAV_ITEM_ACTIVE_CLASS_NAME }}
          className={NAV_ITEM_CLASS_NAME}
          to="/"
          onClick={onNavigate}
        >
          <LayoutDashboard size={17} aria-hidden="true" />
          <span>Home</span>
        </Link>
        {navigation.map(({ to, label, icon: Icon }) => (
          <Link
            activeProps={{ className: NAV_ITEM_ACTIVE_CLASS_NAME }}
            key={to}
            className={NAV_ITEM_CLASS_NAME}
            to={to}
            onClick={onNavigate}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
