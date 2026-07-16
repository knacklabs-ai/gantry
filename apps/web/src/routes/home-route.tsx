import { RadioTower } from 'lucide-react';

import { PageState } from '../ui/compositions/page-state';

export function HomeRoute() {
  return (
    <section className="grid max-w-[960px] gap-8" aria-labelledby="home-title">
      <div>
        <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
          Gantry
        </span>
        <h1
          className="mt-2 mb-0 text-[26px] leading-[1.2] font-semibold"
          id="home-title"
        >
          Operator shell
        </h1>
      </div>
      <PageState
        description="Runtime access is not configured for this browser."
        icon={<RadioTower size={22} aria-hidden="true" />}
        kind="offline"
        title="Not connected"
      />
    </section>
  );
}
