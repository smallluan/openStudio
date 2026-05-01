import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useTheme } from "../context/ThemeContext.jsx";
import UserSettingsStrip from "../components/shell/UserSettingsStrip.jsx";
import ModalCloseButton from "../ui/ModalCloseButton.jsx";
import Select from "../ui/Select.jsx";
import Switch from "../ui/Switch.jsx";
import { cn } from "../ui/cn.js";

const SECTIONS = [
  { id: "general", label: "通用设置" },
  { id: "usage", label: "用量统计" },
  { id: "skills", label: "技能管理" },
  { id: "remote", label: "远控通道" },
  { id: "connection", label: "连接与 Gateway" },
  { id: "about", label: "关于我们" },
];

const THEME_OPTIONS = [
  { value: "light", label: "浅色模式" },
  { value: "dark", label: "深色模式" },
];

export default function SettingsPage() {
  const { onClose } = useOutletContext() ?? {};
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState("general");

  const appearanceLabel = theme === "light" ? "浅色模式" : "深色模式";

  return (
    <div className="flex min-h-[min(520px,70vh)] w-full max-w-full flex-col sm:min-h-[min(640px,82vh)] sm:flex-row">
      <aside className="settings-sheet__aside flex shrink-0 flex-col border-b border-[var(--os-border)] sm:w-[212px] sm:border-b-0 sm:border-r">
        <div className="flex flex-col gap-3 px-2 py-4 sm:px-3">
          <p className="hidden px-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--os-text-faint)] sm:block">
            设置
          </p>
          <nav className="flex gap-1 overflow-x-auto pb-1 sm:flex-col sm:pb-0" aria-label="设置分类">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  "settings-sheet__nav-btn whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-[0.8125rem] font-semibold transition-[background,box-shadow,border-color,color] duration-150 sm:w-full",
                  section === s.id ? "settings-sheet__nav-btn--active" : "settings-sheet__nav-btn--idle",
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--os-border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h1 id="settings-modal-title" className="truncate text-lg font-semibold tracking-tight">
              {SECTIONS.find((x) => x.id === section)?.label ?? "设置"}
            </h1>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--os-text-muted)]">
              偏好与连接配置集中管理；后续模型相关选项也会出现在这里。
            </p>
          </div>
          <ModalCloseButton onClick={onClose} aria-label="关闭设置" />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {section === "general" ? (
            <div className="mx-auto flex max-w-xl flex-col gap-6">
              <div className="flex items-center gap-4 rounded-xl border border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-3">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[var(--os-border)] bg-[var(--os-bg-elevated)] text-2xl"
                  aria-hidden
                >
                  🐾
                </div>
                <div className="min-w-0">
                  <div className="text-[0.75rem] text-[var(--os-text-muted)]">头像</div>
                  <div className="truncate text-[0.9rem] font-medium">本地账户</div>
                </div>
              </div>

              <div className="space-y-1 rounded-xl border border-[var(--os-border)] px-4 py-1">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] py-3 text-[0.875rem] last:border-b-0">
                  <span className="font-medium text-[var(--os-text-muted)]">外观</span>
                  <Select
                    id="theme-appearance"
                    ariaLabel="外观模式"
                    value={theme}
                    onChange={(v) => setTheme(v)}
                    options={THEME_OPTIONS}
                  />
                </div>
                <p className="px-0 pb-3 text-[0.72rem] leading-relaxed text-[var(--os-text-faint)]">
                  当前：{appearanceLabel}。主题与全局语义色绑定，组件库只依赖这套 token。
                </p>
              </div>

              <div className="divide-y divide-[var(--os-border)] rounded-xl border border-[var(--os-border)] px-4">
                <Switch id="sw-lobster" label="龙虾管家（占位）" checked={false} onCheckedChange={() => {}} />
                <Switch id="sw-sleep" label="休眠阻止（占位）" checked={false} onCheckedChange={() => {}} />
                <Switch id="sw-sync" label="云端同步（占位）" checked={false} onCheckedChange={() => {}} />
              </div>

              <div>
                <h2 className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--os-text-faint)]">
                  高级功能设置
                </h2>
                <div className="rounded-xl border border-[var(--os-border)] px-4">
                  <Switch id="sw-memory" label="记忆增强（占位）" checked={false} onCheckedChange={() => {}} />
                </div>
              </div>
            </div>
          ) : null}

          {section === "connection" ? (
            <div className="mx-auto max-w-xl">
              <UserSettingsStrip />
            </div>
          ) : null}

          {section !== "general" && section !== "connection" ? (
            <div className="mx-auto max-w-xl rounded-xl border border-dashed border-[var(--os-border)] bg-[var(--os-bg-subtle)] px-4 py-8 text-center text-[0.875rem] text-[var(--os-text-muted)]">
              「{SECTIONS.find((x) => x.id === section)?.label}」页面建设中。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
