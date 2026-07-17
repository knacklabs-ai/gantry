import { Workflow } from 'lucide-react';

import { PageHeader } from '../../../ui/compositions/page-header';
import { PageState } from '../../../ui/compositions/page-state';

export function WorkflowsRoute() {
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader
        eyebrow="Automation"
        title="Workflow definitions"
        description="Versioned workflow administration is reserved for the separately reviewed workflow rollout."
      />
      <PageState
        description="No workflow schema, definition API, runner, scheduler, or browser authority is enabled in the local UI linkage rollout."
        icon={<Workflow size={18} aria-hidden="true" />}
        kind="empty"
        title="Workflow definitions are not available yet"
      />
    </div>
  );
}
