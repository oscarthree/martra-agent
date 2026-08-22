import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  CloudSun,
  FolderKanban,
  History,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  HistoryScope,
  Project,
  Session,
  SessionHistoryGroups,
  WorkspaceState,
} from "./workspace-state";

const FOCUSABLE =
  "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

// Shared keyboard behavior for overlay surfaces: Escape closes, Tab cycles
// focus within the container.
function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, onClose]);
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <CloudSun size={15} aria-hidden />
      </div>
      <span>Weather Copilot</span>
    </div>
  );
}

export type SidebarProps = {
  workspace: WorkspaceState;
  historyScope: HistoryScope;
  groups: SessionHistoryGroups;
  onNewSession: () => void;
  onShowActiveProject: () => void;
  onShowAllHistory: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onRenameSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
};

const GROUP_LABELS: Array<[keyof SessionHistoryGroups, string]> = [
  ["today", "今天"],
  ["yesterday", "昨天"],
  ["earlier", "更早"],
];

export function SidebarContent({
  workspace,
  historyScope,
  groups,
  onNewSession,
  onShowActiveProject,
  onShowAllHistory,
  onSelectProject,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
}: SidebarProps) {
  const projectScopeActive =
    historyScope.kind === "project" &&
    historyScope.projectId === workspace.activeProjectId;

  return (
    <>
      <Brand />
      <button type="button" className="new-chat" onClick={onNewSession}>
        <Plus size={15} aria-hidden />
        <span>新建会话</span>
      </button>

      <div className="nav-title">工作区</div>
      <button
        type="button"
        className={projectScopeActive ? "nav-item active" : "nav-item"}
        onClick={onShowActiveProject}
      >
        <span className="nav-icon"><FolderKanban size={16} aria-hidden /></span>
        <span>项目</span>
      </button>
      <button
        type="button"
        className={historyScope.kind === "all" ? "nav-item active" : "nav-item"}
        onClick={onShowAllHistory}
      >
        <span className="nav-icon"><History size={16} aria-hidden /></span>
        <span>会话历史</span>
      </button>

      <section className="side-section">
        <div className="nav-title">我的项目</div>
        {workspace.projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={
              project.id === workspace.activeProjectId
                ? "project-item active"
                : "project-item"
            }
            onClick={() => onSelectProject(project.id)}
          >
            <span className="project-dot" aria-hidden />
            <span>{project.name}</span>
          </button>
        ))}
      </section>

      <section className="side-section side-section-grow">
        <div className="nav-title">最近会话</div>
        <div className="history-list">
          {GROUP_LABELS.map(([key, label]) =>
            groups[key].length === 0 ? null : (
              <div key={key}>
                <div className="history-date">{label}</div>
                {groups[key].map((session) => (
                  <div
                    key={session.id}
                    className={
                      session.id === workspace.activeSessionId
                        ? "history-item active"
                        : "history-item"
                    }
                  >
                    <button
                      type="button"
                      className="history-open"
                      onClick={() => onOpenSession(session.id)}
                    >
                      <span className="nav-icon">
                        <MessageSquare size={15} aria-hidden />
                      </span>
                      <span className="history-title">{session.title}</span>
                    </button>
                    <span className="history-actions">
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`重命名会话 ${session.title}`}
                        title="重命名会话"
                        onClick={() => onRenameSession(session)}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`删除会话 ${session.title}`}
                        title="删除会话"
                        onClick={() => onDeleteSession(session)}
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      </section>

      <div className="profile">
        <div className="avatar" aria-hidden>W</div>
        <span>本地工作区</span>
      </div>
    </>
  );
}

export type ProjectSelectorProps = {
  workspace: WorkspaceState;
  historyScope: HistoryScope;
  onSelectProject: (projectId: string) => void;
  onSelectUnclassified: () => void;
  onSelectAll: () => void;
  onCreateProject: () => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
};

export function ProjectContextSelector({
  workspace,
  historyScope,
  onSelectProject,
  onSelectUnclassified,
  onSelectAll,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeProject = workspace.projects.find(
    (project) => project.id === workspace.activeProjectId,
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(index + step + items.length) % items.length] ?? items[0];
      next?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (action: () => void) => () => {
    action();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="context-picker-root" ref={rootRef}>
      <button
        type="button"
        className="context-picker"
        ref={triggerRef}
        aria-label="项目上下文选择器"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {activeProject?.name ?? "项目"}
        <ChevronDown size={13} aria-hidden className="context-picker-chevron" />
      </button>
      {open && (
        <div className="context-menu" role="menu">
          {activeProject && (
            <>
              <div className="menu-label">当前项目</div>
              <div className="menu-row">
                <span className="menu-row-title">
                  <Check size={13} aria-hidden />
                  {activeProject.name}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  className="icon-button small"
                  aria-label={`重命名项目 ${activeProject.name}`}
                  title="重命名项目"
                  onClick={pick(() => onRenameProject(activeProject))}
                >
                  <Pencil size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="icon-button small"
                  aria-label={`删除项目 ${activeProject.name}`}
                  title="删除项目"
                  onClick={pick(() => onDeleteProject(activeProject))}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
              <div className="menu-divider" />
            </>
          )}
          {workspace.projects
            .filter((project) => project.id !== workspace.activeProjectId)
            .map((project) => (
              <button
                key={project.id}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={pick(() => onSelectProject(project.id))}
              >
                {project.name}
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={pick(onSelectUnclassified)}
          >
            {historyScope.kind === "unclassified" && (
              <Check size={13} aria-hidden />
            )}
            未分类
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={pick(onSelectAll)}
          >
            {historyScope.kind === "all" && <Check size={13} aria-hidden />}
            全部历史
          </button>
          <div className="menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={pick(onCreateProject)}
          >
            <Plus size={13} aria-hidden />
            新建项目
          </button>
        </div>
      )}
    </div>
  );
}

export function Drawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>(FOCUSABLE)
      ?.focus();
  }, []);

  return (
    <div
      className="drawer"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="工作区导航">
        {children}
      </div>
    </div>
  );
}

export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, onClose);

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function ProjectFormDialog({
  mode,
  initialName = "",
  validate,
  onSubmit,
  onClose,
}: {
  mode: "create" | "rename";
  initialName?: string;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const problem = validate(name);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(name.trim());
    onClose();
  };

  return (
    <Modal label={mode === "create" ? "新建项目" : "重命名项目"} onClose={onClose}>
      <h2>{mode === "create" ? "新建项目" : "重命名项目"}</h2>
      <p>为一组天气咨询和旅行计划创建一个清晰的工作区。</p>
      <input
        ref={inputRef}
        value={name}
        placeholder="例如：秋季旅行"
        aria-label="项目名称"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <div className="field-error" role="alert">
        {error ?? ""}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary" onClick={submit}>
          {mode === "create" ? "创建项目" : "保存"}
        </button>
      </div>
    </Modal>
  );
}

export function SessionRenameDialog({
  initialTitle,
  onSubmit,
  onClose,
}: {
  initialTitle: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (!title.trim()) return;
    onSubmit(title.trim());
    onClose();
  };

  return (
    <Modal label="重命名会话" onClose={onClose}>
      <h2>重命名会话</h2>
      <input
        ref={inputRef}
        value={title}
        aria-label="会话标题"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary" onClick={submit}>
          保存
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <Modal label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="modal-actions">
        <button type="button" ref={cancelRef} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
