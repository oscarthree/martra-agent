# 实现 Kimi 风格天气工作区

- Type: `wayfinder:spec`
- Status: `ready-for-agent`
- Labels: `ready-for-agent`
- Parent map: [Kimi 风格天气工作区](../maps/kimi-style-weather-workspace.md)
- Blocking decisions:
  - [确认 CopilotChat 消息快照恢复能力](confirm-chat-snapshot-recovery.md)
  - [定义浏览器工作区持久化模型](define-workspace-persistence.md)
  - [定义会话与项目生命周期](define-session-project-lifecycle.md)
  - [定义 Kimi 风格工作区视觉契约](define-kimi-workspace-visual-contract.md)

## Problem Statement

Weather Copilot 当前只有一个介绍面板和一个非受控聊天组件。用户不能在浏览器中管理项目、创建和切换会话、查看会话历史或恢复某个会话的完整聊天上下文。现有聊天界面也没有表达 Active Project、Active Session 和 Session History 的工作区层级，无法承载持续的天气咨询和旅行规划任务。

同时，现有 `/api/copilotkit`、Mastra Agent、Tool、Workflow、流式响应链路和 Resource Identity 已经稳定工作。前端改造必须补齐工作区能力，而不能通过修改后端线程协议或把前端项目/会话 ID 混入 Mastra Memory 身份来解决问题。

## Solution

将前端改造成一个浅色的 Kimi 风格天气工作区：桌面端使用约 `240px` 侧栏和顶部 Project Context Selector，移动端使用侧栏抽屉；主区域使用受控的 `CopilotChatView` 展示和编辑 Active Session 的 Message Snapshot。

使用一个版本化的浏览器 Workspace 状态作为唯一前端持久化边界，统一管理 Project、Session、Active Project、Active Session 和完整 AG-UI 消息快照。新建、切换、重命名、删除、筛选和恢复都通过这个边界完成。聊天请求继续经过现有 `CopilotKit` 到 `/api/copilotkit`，并继续使用独立的 Resource Identity。

## User Stories

1. As a Weather Copilot user, I want to see a recognizable workspace shell, so that I understand where projects, sessions, and the current conversation belong.
2. As a Weather Copilot user, I want to see my projects in the left sidebar, so that I can organize related weather questions and travel plans.
3. As a Weather Copilot user, I want to create a new session, so that I can start a separate weather task without losing previous work.
4. As a Weather Copilot user, I want a new session to belong to the Active Project, so that newly created work is organized predictably.
5. As a Weather Copilot user, I want the current session to be saved before a new session is created, so that I do not lose messages while navigating.
6. As a Weather Copilot user, I want an empty session to remain out of Session History until its first message, so that the history list stays useful.
7. As a Weather Copilot user, I want the first user message to generate a session title, so that I can recognize the session later.
8. As a Weather Copilot user, I want to rename a session, so that its title reflects the task more accurately.
9. As a Weather Copilot user, I want to delete a session with confirmation, so that accidental deletion is unlikely.
10. As a Weather Copilot user, I want to open a session from history, so that I can continue an earlier weather or travel task.
11. As a Weather Copilot user, I want the selected session's complete message history restored, so that the conversation context remains visible.
12. As a Weather Copilot user, I want Session History grouped by today, yesterday, and earlier dates, so that I can scan recent work quickly.
13. As a Weather Copilot user, I want sessions in each history group sorted by update time, so that the most recently active work is easiest to find.
14. As a Weather Copilot user, I want to view all sessions across projects, so that I can find work without remembering its project.
15. As a Weather Copilot user, I want to select an Active Project, so that the workspace reflects the context I am working in.
16. As a Weather Copilot user, I want project selection to filter the visible history, so that unrelated sessions do not dominate the sidebar.
17. As a Weather Copilot user, I want changing the Active Project not to move the current session, so that project context changes do not silently alter ownership.
18. As a Weather Copilot user, I want changing the Active Project not to force another session open, so that my current conversation remains stable.
19. As a Weather Copilot user, I want later new sessions to use the newly selected Active Project, so that project context affects future work predictably.
20. As a Weather Copilot user, I want to create a project from the sidebar or Project Context Selector, so that I can organize work without leaving the chat.
21. As a Weather Copilot user, I want a newly created project to become active immediately, so that I know where my next session will be created.
22. As a Weather Copilot user, I want a new project to start without sample history, so that the project reflects only my own work.
23. As a Weather Copilot user, I want to rename a project, so that the workspace vocabulary matches my task.
24. As a Weather Copilot user, I want to delete a project with confirmation, so that destructive actions are deliberate.
25. As a Weather Copilot user, I want deleting a project to preserve its sessions as Unclassified Sessions, so that project cleanup never deletes conversation work.
26. As a Weather Copilot user, I want Unclassified Sessions to remain unclassified when I switch projects, so that ownership changes happen only through an explicit move operation.
27. As a Weather Copilot user, I want to continue an Unclassified Session, so that deleting an organizational project does not make its conversations unusable.
28. As a Weather Copilot user, I want a default Weather Copilot project to exist when no project remains, so that the workspace always has a valid Active Project.
29. As a Weather Copilot user, I want an empty project to show a welcome state and suggested prompts, so that I can start a useful weather task immediately.
30. As a Weather Copilot user, I want the input area to remain available in empty and error states, so that I can recover without navigating away.
31. As a Weather Copilot user, I want to send a weather question through the existing streaming chat path, so that the workspace retains current assistant behavior.
32. As a Weather Copilot user, I want a failed send to appear inline with a retry action, so that a transient failure does not hide the conversation.
33. As a Weather Copilot user, I want the browser workspace to survive a page reload, so that projects, sessions, and messages remain available locally.
34. As a Weather Copilot user, I want malformed or unavailable browser storage to recover to a valid default workspace, so that a storage problem does not leave the UI unusable.
35. As a Weather Copilot user, I want a storage failure to preserve the current in-memory state for the current page, so that I can continue working while receiving a lightweight warning.
36. As a Weather Copilot user, I want my Mastra Resource Identity to remain independent from projects and sessions, so that backend memory continuity is not reset by workspace navigation.
37. As a desktop user, I want the full sidebar to show brand, new session, workspace navigation, projects, recent sessions, and local workspace status, so that common actions remain discoverable.
38. As a desktop user, I want the sidebar to be about `240px` wide, so that it remains readable without crowding the chat.
39. As a desktop user, I want the main conversation to have a constrained readable width, so that long weather answers remain easy to scan.
40. As a mobile user, I want the sidebar to become a drawer, so that the chat has enough horizontal space.
41. As a mobile user, I want the drawer to close after navigation or by tapping the backdrop, so that I can return to the conversation quickly.
42. As a keyboard user, I want to operate the project selector, menus, dialogs, and drawer with the keyboard, so that pointer input is not required.
43. As a keyboard user, I want a visible focus ring, so that I can see the active control.
44. As a screen-reader user, I want icon-only controls to have accessible names, so that their actions are understandable.
45. As a user with motion sensitivity, I want nonessential motion to be disabled when reduced motion is requested, so that the workspace remains comfortable to use.
46. As a Weather Copilot user, I want the workspace to use a restrained magenta interaction color, so that the product has its own identity without copying Kimi branding.
47. As a Weather Copilot user, I want weather status colors to remain distinguishable from the magenta interaction color, so that weather meaning is not confused with selection or action state.
48. As a Weather Copilot maintainer, I want the frontend change to leave `/api/copilotkit`, Mastra agents, tools, workflows, and server memory untouched, so that the established chat integration keeps working.

## Implementation Decisions

- The frontend will have one Workspace state boundary that owns the browser Workspace state and exposes operations for project, session, selection, history, snapshot, and persistence behavior. UI components will consume this boundary rather than independently mutating localStorage or duplicating lifecycle rules.
- The browser state is a single versioned workspace document containing projects, sessions, `activeProjectId`, and `activeSessionId`. Projects contain identity, name, and timestamps. Sessions contain identity, nullable project ownership, title, complete AG-UI `Message[]` snapshots, and timestamps.
- The storage key is `weather-copilot-workspace-v1`. First load creates a default project named “天气助手” and one empty session. Empty sessions are not rendered in history until the first user message exists.
- State is persisted after relevant project, session, selection, and message changes with lightweight write throttling. Invalid JSON, invalid schema, unsupported version, or a failed write triggers recovery behavior without discarding the current in-memory state for the active page.
- `mastra-resource-id` remains an independent browser identity. It is sent as the existing `x-mastra-resource-id` request header and is neither derived from nor replaced by `projectId` or `sessionId`.
- The current non-controlled chat component will be replaced by the controlled `CopilotChatView` path required for loading and saving Message Snapshots. The component will receive the Active Session snapshot and report message changes to the Workspace state boundary.
- The existing `CopilotKit` provider continues to use `/api/copilotkit` and `weatherAgent`. No new backend thread endpoint, server-side project model, or server-side session persistence is introduced.
- Session changes save the outgoing Active Session before loading the selected session snapshot. Loading a history item changes Active Session only; it does not change the session's Project ownership.
- Changing Active Project changes the current context and default history filter only. It does not move the Active Session or automatically open another session. A separate all-history view can show sessions across projects.
- New session creates an empty session in the Active Project. New project creates a project, selects it, and creates an empty session. Project deletion moves owned sessions to the Unclassified Session state rather than deleting them.
- Project and session deletion require confirmation. Deleting the Active Project selects the first remaining project, or recreates and selects “天气助手” when none remains. Deleting the Active Session opens the most recently updated alternative in the same project, or creates an empty session when none exists.
- Session titles are generated from the first user message by removing line breaks and taking the first 24 characters. Manual renaming remains available.
- History groups are “今天、昨天、更早”, each sorted by `updatedAt` descending. The project-filtered view shows sessions belonging to the Active Project; the all-history view preserves cross-project discovery.
- The desktop shell uses a roughly `240px` sidebar, a `64px` top bar, and a chat content maximum width of roughly `780px`. The desktop composition uses Variant A's readable navigation with Variant C's project section treatment.
- The responsive breakpoint is `720px`. Below it, the desktop sidebar becomes a drawer of `min(280px, 86vw)`, opened by a top-bar menu button and closed after navigation or backdrop selection. The mobile top bar is roughly `60px` high.
- The visual system is light-only. Kimi-inspired decisions are limited to light surfaces, restrained borders, compact navigation, contextual top-bar selection, and whitespace. Kimi logos, names, protected assets, copy, and proprietary branding are not copied.
- Weather Copilot's interaction accent is restrained magenta `#C43D86`, with a darker hover value, a pale selected background, and a translucent focus ring. It is used for primary actions, selection, links, and focus. Weather meaning continues to use distinct supporting colors.
- The Project Context Selector is a top-bar dropdown. It lists the current project, other projects, Unclassified, a new-project action, and project rename/delete actions. On mobile it may use a bottom-oriented action panel to stay within the viewport.
- Empty projects and empty sessions show the welcome state and suggested prompts without fabricated history. Input remains available in all empty and error states.
- Project-name validation errors stay inside the creation dialog. Send failures appear inline with retry. Storage failures use a lightweight notification and preserve current in-memory state. Error styling uses warm red or deep red rather than magenta.
- Icon buttons use `lucide-react` icons with accessible names and tooltips. Menus and dialogs support keyboard operation, and mobile drawer focus is trapped while open and returned to the menu button on close.
- Motion is limited to short functional transitions for initial content, drawers, menus, dialogs, hover, and focus. Nonessential motion is disabled under reduced-motion preferences.
- The existing backend files and server contracts are outside the implementation surface for this feature.

## Testing Decisions

- Tests assert externally observable workspace behavior through the Workspace state boundary. They should not assert React implementation details, CSS selectors as an internal architecture, or direct localStorage calls when the same behavior can be observed through the boundary.
- The primary unit-level test seam is the Workspace state boundary. Tests cover default initialization, versioned serialization, malformed storage recovery, write failure behavior, project and session lifecycle, title generation, project filtering, all-history grouping, Unclassified transitions, active selection rules, and Message Snapshot replacement.
- Message snapshots are tested as complete message objects rather than text-only projections, ensuring tool and workflow state needed by the controlled chat view is retained.
- Existing Vitest conventions in the repository use focused `describe` blocks, direct behavior assertions, and parameterized invalid-input cases. New workspace tests should follow this style and use deterministic timestamps and IDs.
- Browser acceptance tests cover the highest-value cross-module behavior: desktop sidebar rendering, creating and selecting projects, creating and switching sessions, restoring a snapshot, opening and closing the mobile drawer, dialog validation, and a real message submission through `/api/copilotkit` when the required environment is available.
- Visual acceptance uses desktop and mobile screenshots at the agreed responsive boundary, checks that the sidebar, top bar, chat content, input area, project menu, dialogs, empty state, and error state do not overlap, and verifies that the magenta focus and selection states remain readable.
- Accessibility acceptance checks keyboard navigation, focus visibility, dialog and drawer focus behavior, accessible names for icon controls, reduced-motion behavior, and non-color-only state communication.
- Validation remains `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm client:build`, followed by browser acceptance against the backend and Vite proxy when those processes are running.

## Out of Scope

- Changes to `/api/copilotkit`, the Mastra Agent, Tool, Workflow, server-side Memory, or Resource Identity semantics.
- Backend thread persistence, durable server-side session storage, cross-browser synchronization, cross-device synchronization, account-level synchronization, or conflict merging beyond the agreed browser storage behavior.
- Attachments, knowledge bases, project-level system prompts, model selection, model configuration, batch session management, or collaborative workspaces.
- Dark mode, theme switching, custom user palettes, or broad visual customization.
- Copying Kimi logos, brand names, proprietary assets, protected copy, or a pixel-for-pixel reproduction of Kimi's interface.
- Replacing the current weather domain behavior, workflow logic, retry policy, or weather data provider.
- A full design-system refactor beyond the controls and tokens needed by this workspace.

## Further Notes

- The standalone prototype is the primary visual reference for the A+C composition and the mobile drawer behavior. It is a decision aid, not production code.
- The domain vocabulary in `CONTEXT.md` is normative: Workspace, Project, Session, Session History, Message Snapshot, Unclassified Session, Resource Identity, Active Project, Active Session, and Project Context Selector must retain their agreed meanings during implementation.
- The local repository has no external issue tracker or native `ready-for-agent` label. The metadata at the top of this document records the intended tracker status for the implementation handoff.
- The next workflow step is to split this spec into blocking implementation tickets before code changes begin.
