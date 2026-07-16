import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { AppShell } from './app-shell';
import { HomeRoute } from '../routes/home-route';
import { NotFoundRoute } from '../routes/not-found-route';
import { PreferencesRoute } from '../features/preferences/preferences-route';

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'profile',
  component: PreferencesRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, profileRoute]);

export const router = createRouter({
  basepath: '/ui',
  defaultPreload: 'intent',
  routeTree,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
