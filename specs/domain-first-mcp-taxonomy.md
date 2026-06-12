# Domain-first MCP taxonomy

Allowed tool families are Weave domains: `identity`, `admin_health`, `spaces`, `chat`, `files`, `calendar`, `boards`, `meetings`, `documents`, `decisions`, `weaver`.

Examples:

- `calendar.search_events`, `calendar.create_event`, `calendar.link_meeting_thread`
- `files.search_items`, `files.share_item`, `files.prepare_upload`
- `chat.search_messages`, `chat.send_message`
- `boards.create_task`, `decisions.record_decision`

Disallowed public MCP names include provider/adapter families such as `nextcloud.*`, `caldav.*`, `matrix.*`, `wopi.*`, or `forgejo.*`. Those may appear only as redacted provider evidence behind domain facades.
