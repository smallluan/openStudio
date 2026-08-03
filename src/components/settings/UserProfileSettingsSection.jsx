import { useCallback, useEffect, useRef, useState } from "react";
import { Input, RadioGroup, Textarea } from "tdesign-react";
import { useI18n } from "../../context/I18nContext.jsx";
import { isAgentAvatarImageSrc } from "../../studio/agents.js";
import { Camera, LockKeyhole, Mars, Pencil, Venus } from "lucide-react";

/** @typedef {{ displayName: string; avatar: string; gender: "male" | "female" | "secret"; userMd: string }} UserProfileForm */

const EMPTY_PROFILE = /** @type {UserProfileForm} */ ({
  displayName: "",
  avatar: "",
  gender: "male",
  userMd: "",
});

/** @param {unknown} gender */
function normalizeGender(gender) {
  return gender === "female" || gender === "secret" ? gender : "male";
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
      if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) return;
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

  const avatarSrc = isAgentAvatarImageSrc(profile.avatar) ? profile.avatar : "";
  const nameInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const handleAvatarInputChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file) void handleAvatarUpload(file);
      event.target.value = "";
    },
    [handleAvatarUpload],
  );

  return (
    <div className="user-profile-settings">
      <section className="user-profile-card user-profile-card--basic">
        <h2 className="user-profile-card__title">{t("settings.profile.basicInfo")}</h2>
        <div className="user-profile-basic">
          <div className="user-profile-avatar-block">
            <button
              type="button"
              className="user-profile-avatar"
              onClick={() => avatarInputRef.current?.click()}
              aria-label={t("settings.profile.changeAvatar")}
            >
              {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{(profile.displayName || t("settings.profile.defaultName")).slice(0, 1)}</span>}
              <span className="user-profile-avatar__camera"><Camera size={18} /></span>
            </button>
            <input
              ref={avatarInputRef}
              className="user-profile-avatar-input"
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleAvatarInputChange}
            />
          </div>
          <div className="user-profile-basic-fields">
            <div className="user-profile-field">
              <label htmlFor="settings-profile-display-name">{t("settings.profile.displayName")}</label>
              <Input
                ref={nameInputRef}
                id="settings-profile-display-name"
                size="large"
                value={profile.displayName}
                placeholder={t("settings.profile.displayNamePlaceholder")}
                onChange={(v) => queuePersist({ displayName: String(v ?? "") })}
                onBlur={() => void flushPersist()}
                suffix={<Pencil size={19} aria-label={t("settings.profile.editName")} />}
              />
            </div>
            <div className="user-profile-field user-profile-field--gender">
              <span className="user-profile-field__label">{t("settings.profile.gender")}</span>
              <RadioGroup
                value={profile.gender}
                theme="button"
                variant="outline"
                onChange={(value) => void persistProfile({ gender: normalizeGender(value) })}
                options={[
                  { value: "male", label: <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", whiteSpace: "nowrap" }}><Mars size={18} />{t("settings.profile.genderMale")}</span> },
                  { value: "female", label: <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", whiteSpace: "nowrap" }}><Venus size={18} />{t("settings.profile.genderFemale")}</span> },
                  { value: "secret", label: <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", whiteSpace: "nowrap" }}><LockKeyhole size={18} />{t("settings.profile.genderSecret")}</span> },
                ]}
              />
            </div>
          </div>
        </div>
      </section>
      <section className="user-profile-card user-profile-card--about">
        <h2 className="user-profile-card__title">{t("settings.profile.userMd")}</h2>
        <p className="user-profile-card__description">{t("settings.profile.aboutDescription")}</p>
        <div className="user-profile-about-input">
          <Textarea
            value={profile.userMd}
            maxLength={500}
            placeholder={t("settings.profile.userMdPlaceholder")}
            onChange={(v) => queuePersist({ userMd: String(v ?? "") })}
            onBlur={() => void flushPersist()}
          />
          <span>{profile.userMd.length} / 500</span>
        </div>
      </section>
    </div>
  );
}
