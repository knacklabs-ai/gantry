# Review Instructions

Use these checks before approving large architecture or runtime changes:

1. Run `npm run check:architecture` or `python3 .codex/scripts/check_architecture.py`.
2. Treat any new unexcepted architecture violation as blocking unless the change is explicitly a cleanup that removes more debt than it adds.
3. Review `.codex/architecture-map.json` when a change introduces a new owned layer, adapter family, provider boundary, or package surface.
4. Review `.codex/architecture-exceptions.json` when a change touches a file that already has a capped exception. Do not raise the cap unless the PR also documents why the cleanup cannot happen now.
5. Provider-specific SDKs, channel SDKs, browser automation, Docker, and direct process execution must stay in approved adapter paths. Core domain and application files should not gain exceptions for these.
6. Old architecture terms such as `groupFolder`, `mainGroup`, `registeredGroup`, and Claude-only assumptions should trend down. A file may keep an existing cap, but new files should not introduce them.

When removing debt, delete the matching exception in the same change. If the checker reports that an exception is stale or over-capped, prefer fixing the exception rather than weakening the rule.
