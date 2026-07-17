import * as Dialog from '@radix-ui/react-dialog';
import { Bot, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../../ui/primitives/button';
import { IconButton } from '../../../ui/primitives/icon-button';
import type { AgentOption, ConversationView } from '../conversation-api';
import { useReplaceConversationInstall } from '../use-conversations';

export function ConversationInstallDialog({
  agents,
  conversation,
  open,
  onOpenChange,
}: {
  agents: AgentOption[];
  conversation: ConversationView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useReplaceConversationInstall();
  const [agentId, setAgentId] = useState(conversation.agentId ?? '');

  useEffect(() => {
    if (open) setAgentId(conversation.agentId ?? '');
  }, [conversation.agentId, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutation.mutateAsync({
      conversation,
      currentAgentId: conversation.agentId,
      nextAgentId: agentId || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface p-5 shadow-popover">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 flex items-center gap-2 text-base font-semibold text-text">
                <Bot size={17} aria-hidden="true" /> Agent installation
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 mb-0 text-sm leading-6 text-text-secondary">
                Choose the agent that handles eligible messages in{' '}
                {conversation.name}.
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
              Installed agent
              <select
                className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-normal text-text"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                <option value="">No installed agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.status}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 text-xs leading-5 text-text-secondary">
              Removing an installation stops this agent from receiving new
              eligible messages from the conversation.
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
                {mutation.isPending ? 'Saving' : 'Save installation'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
