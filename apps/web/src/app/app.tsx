import { RouterProvider } from '@tanstack/react-router';

import { PreferencesProvider } from '../features/preferences/preferences-provider';
import { router } from './router';

export function App() {
  return (
    <PreferencesProvider>
      <RouterProvider router={router} />
    </PreferencesProvider>
  );
}
