import * as Dialog from '@radix-ui/react-dialog';
import { UserRoundCheck, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../../ui/primitives/button';
import { IconButton } from '../../../ui/primitives/icon-button';
import { useReplaceConversationApprovers } from '../use-conversations';

export function ConversationApproversDialog({
  approverIds,
  conversationId,
  conversationName,
  open,
  onOpenChange,
}: {
  approverIds: string[];
  conversationId: string;
  conversationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useReplaceConversationApprovers();
  const [value, setValue] = useState(approverIds.join('\n'));

  useEffect(() => {
    if (open) setValue(approverIds.join('\n'));
  }, [approverIds, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userIds = [
      ...new Set(
        value
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    await mutation.mutateAsync({ conversationId, userIds });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface p-5 shadow-popover">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 flex items-center gap-2 text-base font-semibold text-text">
                <UserRoundCheck size={17} aria-hidden="true" /> Control
                approvers
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 mb-0 text-sm leading-6 text-text-secondary">
                Verified members who can answer permission prompts in{' '}
                {conversationName}.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="Close" title="Close">
                <X size={16} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          <form className="mt-5 grid gap-4" onSubmit={submit}>
            <label className="grid gap-1.5 text-xs font-semibold text-text">
              Provider user IDs
              <textarea
                className="min-h-36 resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-xs leading-5 text-text"
                placeholder="One provider user ID per line"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <p className="m-0 text-xs leading-5 text-text-secondary">
              Gantry verifies membership before replacing the allowlist. An
              empty list removes all control approvers.
            </p>
            {mutation.isError ? (
              <p className="m-0 text-xs text-status-danger">
                {mutation.error.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? 'Saving' : 'Save approvers'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
