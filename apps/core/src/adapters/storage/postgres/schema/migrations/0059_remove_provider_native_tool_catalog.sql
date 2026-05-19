UPDATE permission_decisions
SET tool_id = NULL
WHERE tool_id IN (
  SELECT id
  FROM tool_catalog
  WHERE kind = 'anthropic_sdk'
     OR provider = 'anthropic'
     OR id IN (
       'tool:Agent',
       'tool:Bash',
       'tool:Edit',
       'tool:Read',
       'tool:Write',
       'tool:Glob',
       'tool:Grep',
       'tool:LS',
       'tool:MultiEdit',
       'tool:NotebookEdit',
       'tool:ToolSearch',
       'tool:Skill',
       'tool:WebFetch',
       'tool:WebSearch',
       'tool:AskUserQuestion',
       'tool:SendMessage',
       'tool:CronCreate',
       'tool:CronDelete',
       'tool:RemoteTrigger',
       'tool:ScheduleWakeup',
       'tool:PushNotification',
       'tool:TeamCreate',
       'tool:TeamDelete',
       'tool:Task',
       'tool:TaskOutput',
       'tool:TaskStop',
       'tool:EnterPlanMode',
       'tool:ExitPlanMode',
       'tool:EnterWorktree',
       'tool:ExitWorktree',
       'tool:Monitor',
       'tool:TodoWrite',
       'tool:ListMcpResources',
       'tool:ReadMcpResource'
     )
);

DELETE FROM agent_tool_bindings
WHERE tool_id IN (
  SELECT id
  FROM tool_catalog
  WHERE kind = 'anthropic_sdk'
     OR provider = 'anthropic'
     OR id IN (
       'tool:Agent',
       'tool:Bash',
       'tool:Edit',
       'tool:Read',
       'tool:Write',
       'tool:Glob',
       'tool:Grep',
       'tool:LS',
       'tool:MultiEdit',
       'tool:NotebookEdit',
       'tool:ToolSearch',
       'tool:Skill',
       'tool:WebFetch',
       'tool:WebSearch',
       'tool:AskUserQuestion',
       'tool:SendMessage',
       'tool:CronCreate',
       'tool:CronDelete',
       'tool:RemoteTrigger',
       'tool:ScheduleWakeup',
       'tool:PushNotification',
       'tool:TeamCreate',
       'tool:TeamDelete',
       'tool:Task',
       'tool:TaskOutput',
       'tool:TaskStop',
       'tool:EnterPlanMode',
       'tool:ExitPlanMode',
       'tool:EnterWorktree',
       'tool:ExitWorktree',
       'tool:Monitor',
       'tool:TodoWrite',
       'tool:ListMcpResources',
       'tool:ReadMcpResource'
     )
);

DELETE FROM tool_catalog
WHERE kind = 'anthropic_sdk'
   OR provider = 'anthropic'
   OR id IN (
     'tool:Agent',
     'tool:Bash',
     'tool:Edit',
     'tool:Read',
     'tool:Write',
     'tool:Glob',
     'tool:Grep',
     'tool:LS',
     'tool:MultiEdit',
     'tool:NotebookEdit',
     'tool:ToolSearch',
     'tool:Skill',
     'tool:WebFetch',
     'tool:WebSearch',
     'tool:AskUserQuestion',
     'tool:SendMessage',
     'tool:CronCreate',
     'tool:CronDelete',
     'tool:RemoteTrigger',
     'tool:ScheduleWakeup',
     'tool:PushNotification',
     'tool:TeamCreate',
     'tool:TeamDelete',
     'tool:Task',
     'tool:TaskOutput',
     'tool:TaskStop',
     'tool:EnterPlanMode',
     'tool:ExitPlanMode',
     'tool:EnterWorktree',
     'tool:ExitWorktree',
     'tool:Monitor',
     'tool:TodoWrite',
     'tool:ListMcpResources',
     'tool:ReadMcpResource'
   );
