import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Radio, Textarea, Typography } from "tdesign-react";
import { useI18n } from "../../context/I18nContext.jsx";
import { isAgentAvatarImageSrc } from "../../studio/agents.js";
import Avatar from "../../ui/Avatar.jsx";
import { cn } from "../../ui/cn.js";

/** @typedef {{ displayName: string; avatar: string; gender: "male" | "female"; userMd: string }} UserProfileForm */

const EMPTY_PROFILE = /** @type {UserProfileForm} */ ({
  displayName: "",
  avatar: "",
  gender: "male",
  userMd: "",
});

/** @param {unknown} gender */
function normalizeGender(gender) {
  return gender === "female" ? "female" : "male";
}

/** @param {unknown} raw */
function profileFromConfig(raw) {
  const p = typeof raw === "object" && raw !== null ? raw : {};
  return {
    displayName: typeof p.displayName === "string" ? p.displayName : "",
    avatar: typeof p.avatar === "string" ? p.avatar : "",
    gender: normalizeGender(p.gender),
    userMd: typeof p.userMd === "string" ? p.userMd : "",
  };
}

/**
 * @param {{ title: string; children: import("react").ReactNode; stacked?: boolean }} props
 */
function ProfileSettingRow({ title, children, stacked = false }) {
  return (
    <div className={cn("general-setting-row", stacked && "general-setting-row--stacked")}>
      <Typography.Text className="general-setting-row__label">{title}</Typography.Text>
      <div
        className={cn(
          "general-setting-row__control",
          stacked && "general-setting-row__control--full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** User profile fields persisted in studio-user-config.json and injected as USER.md. */
export default function UserProfileSettingsSection() {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const profileRef = useRef(profile);
  const loadedRef = useRef(false);
  const persistTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bridge?.getUserConfig?.();
        if (!cancelled && c && typeof c === "object") {
          const next = profileFromConfig(c.userProfile);
          setProfile(next);
          profileRef.current = next;
          loadedRef.current = true;
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const persistProfile = useCallback(
    async (patch) => {
      const next = { ...profileRef.current, ...patch };
      setProfile(next);
      profileRef.current = next;
      try {
        await bridge?.setUserConfig?.({ userProfile: next });
        window.dispatchEvent(new CustomEvent("openstudio-user-config-changed"));
      } catch {
        try {
          const c = await bridge?.getUserConfig?.();
          const restored = profileFromConfig(c?.userProfile);
          setProfile(restored);
          profileRef.current = restored;
        } catch {
          /* ignore */
        }
      }
    },
    [bridge],
  );

  const queuePersist = useCallback((patch) => {
    const next = { ...profileRef.current, ...patch };
    setProfile(next);
    profileRef.current = next;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void persistProfile({});
    }, 300);
  }, [persistProfile]);

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    return persistProfile({});
  }, [persistProfile]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (!loadedRef.current) return;
      void bridge?.setUserConfig?.({ userProfile: profileRef.current });
    };
  }, [bridge]);

  const handleAvatarUpload = useCallback(
    /** @param {File} file */
    (file) => {
      if (!file.type.startsWith("image/")) return;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = /** @type {string} */ (e.target?.result);
          if (dataUrl) void persistProfile({ avatar: dataUrl });
          resolve();
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
    },
    [persistProfile],
  );

  const handleAvatarClear = useCallback(() => {
    void persistProfile({ avatar: "" });
  }, [persistProfile]);

  const avatarSrc = isAgentAvatarImageSrc(profile.avatar) ? profile.avatar : "";

  return (
    <div className="general-settings w-full">
      <ProfileSettingRow title={t("settings.profile.avatar")}>
        <Avatar
          src={avatarSrc}
          name={profile.displayName || t("settings.profile.defaultName")}
          size="lg"
          shape="circle"
          editable
          onUpload={handleAvatarUpload}
          onDelete={profile.avatar ? handleAvatarClear : undefined}
        />
      </ProfileSettingRow>

      <ProfileSettingRow title={t("settings.profile.displayName")}>
        <Input
          borderless
          value={profile.displayName}
          placeholder={t("settings.profile.displayNamePlaceholder")}
          onChange={(v) => queuePersist({ displayName: String(v ?? "") })}
          onBlur={() => void flushPersist()}
          className="settings-profile-input"
        />
      </ProfileSettingRow>

      <ProfileSettingRow title={t("settings.profile.gender")}>
        <Radio.Group
          value={profile.gender}
          onChange={(v) => {
            void persistProfile({ gender: normalizeGender(v) });
          }}
        >
          <Radio value="male">{t("settings.profile.genderMale")}</Radio>
          <Radio value="female">{t("settings.profile.genderFemale")}</Radio>
        </Radio.Group>
      </ProfileSettingRow>

      <ProfileSettingRow title={t("settings.profile.userMd")} stacked>
        <Textarea
          value={profile.userMd}
          placeholder={t("settings.profile.userMdPlaceholder")}
          autosize={{ minRows: 4, maxRows: 12 }}
          onChange={(v) => queuePersist({ userMd: String(v ?? "") })}
          onBlur={() => void flushPersist()}
          className="settings-profile-textarea"
        />
        <Typography.Text theme="secondary" className="settings-profile-hint">
          {t("settings.profile.userMdHint")}
        </Typography.Text>
      </ProfileSettingRow>
    </div>
  );
}
