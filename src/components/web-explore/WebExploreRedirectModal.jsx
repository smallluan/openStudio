import { useCallback, useId, useMemo } from "react";
import { ArrowUpDown, Plus, X } from "lucide-react";
import { Button, Input } from "@open-studio/udesign";
import { Switch } from "tdesign-react";
import { useI18n } from "../../context/I18nContext.jsx";
import Modal from "../../ui/Modal.jsx";
import ModalCloseButton from "../../ui/ModalCloseButton.jsx";
import { cn } from "../../ui/cn.js";
import {
  createExploreRedirectGroup,
  createExploreRedirectRuleId,
  hasActiveExploreRedirectRules,
} from "../../web-explore/exploreRedirectOverride.js";

/**
 * @typedef {import("../../web-explore/exploreRedirectOverride.js").ExploreRedirectGroup} ExploreRedirectGroup
 * @typedef {import("../../web-explore/exploreRedirectOverride.js").ExploreRedirectRule} ExploreRedirectRule
 *
 * @typedef {{
 *   open: boolean;
 *   groups: ExploreRedirectGroup[];
 *   inElectron: boolean;
 *   onChange: (groups: ExploreRedirectGroup[]) => void;
 *   onClose: () => void;
 * }} WebExploreRedirectModalProps
 */

/**
 * @param {ExploreRedirectGroup[]} groups
 * @param {string} groupId
 * @param {(group: ExploreRedirectGroup) => ExploreRedirectGroup} updater
 */
function updateGroup(groups, groupId, updater) {
  return groups.map((group) => (group.id === groupId ? updater(group) : group));
}

/**
 * @param {WebExploreRedirectModalProps} props
 */
export default function WebExploreRedirectModal({ open, groups, inElectron, onChange, onClose }) {
  const { t } = useI18n();
  const titleId = useId();
  const active = useMemo(() => hasActiveExploreRedirectRules(groups), [groups]);

  const handleAddGroup = useCallback(() => {
    onChange([...groups, createExploreRedirectGroup(t("webExplorePage.redirectDefaultGroupName"))]);
  }, [groups, onChange, t]);

  /** @param {string} groupId */
  const handleRemoveGroup = useCallback(
    (groupId) => {
      onChange(groups.filter((group) => group.id !== groupId));
    },
    [groups, onChange],
  );

  /**
   * @param {string} groupId
   * @param {Partial<ExploreRedirectGroup>} patch
   */
  const patchGroup = useCallback(
    (groupId, patch) => {
      onChange(updateGroup(groups, groupId, (group) => ({ ...group, ...patch })));
    },
    [groups, onChange],
  );

  /** @param {string} groupId */
  const handleAddRule = useCallback(
    (groupId) => {
      onChange(
        updateGroup(groups, groupId, (group) => ({
          ...group,
          rules: [
            ...group.rules,
            {
              id: createExploreRedirectRuleId(),
              from: "",
              to: "",
              enabled: true,
            },
          ],
        })),
      );
    },
    [groups, onChange],
  );

  /**
   * @param {string} groupId
   * @param {string} ruleId
   */
  const handleRemoveRule = useCallback(
    (groupId, ruleId) => {
      onChange(
        updateGroup(groups, groupId, (group) => ({
          ...group,
          rules: group.rules.filter((rule) => rule.id !== ruleId),
        })),
      );
    },
    [groups, onChange],
  );

  /**
   * @param {string} groupId
   * @param {string} ruleId
   * @param {Partial<ExploreRedirectRule>} patch
   */
  const patchRule = useCallback(
    (groupId, ruleId, patch) => {
      onChange(
        updateGroup(groups, groupId, (group) => ({
          ...group,
          rules: group.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
        })),
      );
    },
    [groups, onChange],
  );

  if (!open) return null;

  return (
    <Modal onClose={onClose} labelledBy={titleId} width="min(960px, calc(100vw - 2rem))">
      <div className="web-explore-redirect-modal flex w-full min-w-0 flex-col bg-[var(--os-bg-modal)]">
        <div className="flex items-start justify-between gap-3 border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--os-text-primary)]">
              {t("webExplorePage.redirectTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--os-text-muted)]">
              {inElectron
                ? t("webExplorePage.redirectHintElectron")
                : t("webExplorePage.redirectHintBrowser")}
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="web-explore-redirect-modal__body min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="web-explore-redirect-modal__empty">{t("webExplorePage.redirectEmptyGroups")}</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.id} className="web-explore-redirect-modal__group">
              <div className="web-explore-redirect-modal__group-head">
                <label className="web-explore-redirect-modal__field-label">
                  {t("webExplorePage.redirectGroupName")}
                  <Input
                    block
                    size="small"
                    className="web-explore-redirect-modal__group-name"
                    value={group.name}
                    onChange={(value) => patchGroup(group.id, { name: value })}
                    placeholder={t("webExplorePage.redirectDefaultGroupName")}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  className="web-explore-redirect-modal__add-rule"
                  onClick={() => handleAddRule(group.id)}
                >
                  {t("webExplorePage.redirectAddRule")}
                </Button>
                <div className="web-explore-redirect-modal__group-toggle">
                  <span className="web-explore-redirect-modal__toggle-label">
                    {group.enabled ? t("webExplorePage.redirectOn") : t("webExplorePage.redirectOff")}
                  </span>
                  <Switch
                    size="small"
                    value={group.enabled}
                    onChange={(value) => patchGroup(group.id, { enabled: Boolean(value) })}
                    aria-label={t("webExplorePage.redirectGroupToggleAria", {
                      name: group.name || t("webExplorePage.redirectDefaultGroupName"),
                    })}
                  />
                </div>
                <Button
                  type="button"
                  variant="text"
                  shape="square"
                  size="small"
                  className="web-explore-redirect-modal__remove-group"
                  title={t("webExplorePage.redirectDeleteGroup")}
                  aria-label={t("webExplorePage.redirectDeleteGroup")}
                  onClick={() => handleRemoveGroup(group.id)}
                >
                  <X size={15} strokeWidth={2.1} aria-hidden />
                </Button>
              </div>

              <div className="web-explore-redirect-modal__rules">
                {group.rules.length === 0 ? (
                  <p className="web-explore-redirect-modal__empty">{t("webExplorePage.redirectEmptyRules")}</p>
                ) : (
                  group.rules.map((rule) => (
                    <div key={rule.id} className="web-explore-redirect-modal__rule">
                      <span className="web-explore-redirect-modal__drag" aria-hidden>
                        <ArrowUpDown size={14} strokeWidth={2} />
                      </span>
                      <label className="web-explore-redirect-modal__field-label web-explore-redirect-modal__field-label--from">
                        {t("webExplorePage.redirectFrom")}
                        <Input
                          block
                          size="small"
                          spellCheck={false}
                          value={rule.from}
                          onChange={(value) => patchRule(group.id, rule.id, { from: value })}
                          placeholder={t("webExplorePage.redirectFromPlaceholder")}
                        />
                      </label>
                      <label className="web-explore-redirect-modal__field-label web-explore-redirect-modal__field-label--to">
                        {t("webExplorePage.redirectTo")}
                        <Input
                          block
                          size="small"
                          spellCheck={false}
                          value={rule.to}
                          onChange={(value) => patchRule(group.id, rule.id, { to: value })}
                          placeholder={t("webExplorePage.redirectToPlaceholder")}
                        />
                      </label>
                      <div className="web-explore-redirect-modal__rule-toggle">
                        <span className="web-explore-redirect-modal__toggle-label">
                          {rule.enabled ? t("webExplorePage.redirectOn") : t("webExplorePage.redirectOff")}
                        </span>
                        <Switch
                          size="small"
                          value={rule.enabled}
                          onChange={(value) => patchRule(group.id, rule.id, { enabled: Boolean(value) })}
                          aria-label={t("webExplorePage.redirectRuleToggleAria")}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="text"
                        shape="square"
                        size="small"
                        className="web-explore-redirect-modal__remove-rule"
                        title={t("webExplorePage.redirectDeleteRule")}
                        aria-label={t("webExplorePage.redirectDeleteRule")}
                        onClick={() => handleRemoveRule(group.id, rule.id)}
                      >
                        <X size={14} strokeWidth={2.1} aria-hidden />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}

          <Button
            type="button"
            variant="outline"
            size="small"
            className="web-explore-redirect-modal__add-group"
            onClick={handleAddGroup}
          >
            <Plus size={14} strokeWidth={2.1} className="mr-1 inline" aria-hidden />
            {t("webExplorePage.redirectAddGroup")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
          <p
            className={cn(
              "text-xs",
              active ? "text-[var(--os-accent,#2563eb)]" : "text-[var(--os-text-muted)]",
            )}
          >
            {active ? t("webExplorePage.redirectActiveCount") : t("webExplorePage.redirectInactive")}
          </p>
          <Button type="button" variant="primary" size="small" onClick={onClose}>
            {t("webExplorePage.redirectDone")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
