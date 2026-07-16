import { CircleOff } from 'lucide-react';

export function ConnectionState() {
  return (
    <span
      aria-label="Runtime connection: not connected"
      className="inline-flex min-w-0 items-center gap-[7px] font-mono text-[11px] font-medium text-text-secondary"
    >
      <CircleOff
        className="shrink-0 text-status-idle"
        size={15}
        aria-hidden="true"
      />
      <span>Not connected</span>
    </span>
  );
}
