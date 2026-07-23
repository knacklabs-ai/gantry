import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { rootRoute } from '../root-route';

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workflows',
  component: lazyRouteComponent(
    () => import('../../features/workflows/routes/workflows-route'),
    'WorkflowsRoute',
  ),
});

export const workflowRoutes = [workflowsRoute];
