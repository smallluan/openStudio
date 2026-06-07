import { forwardRef, useEffect, useRef, useState } from "react";
import heroAvatarLight from "../../assets/images/hero-avatar-light.png";
import heroAvatarDark from "../../assets/images/hero-avatar-dark.png";
import { useI18n } from "../../context/I18nContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { cn } from "../../ui/cn.js";

/** 首页副标题：淡入淡出轮播（比打字机更稳定，避免多 timer 竞态）。 */
export function HeroPhraseRotator({ phrases, holdMs = 3200, fadeMs = 420 }) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
  const skipEnterOnMountRef = useRef(true);

  useEffect(() => {
    if (!phrases?.length) return;
    if (phrases.length === 1) {
      setIndex(0);
      setLeaving(false);
      return;
    }

    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;

    const schedule = (/** @type {() => void} */ fn, /** @type {number} */ delay) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, delay);
    };

    const cycle = () => {
      setLeaving(true);
      schedule(() => {
        setIndex((prev) => (prev + 1) % phrases.length);
        setLeaving(false);
        schedule(cycle, holdMs);
      }, fadeMs);
    };

    schedule(cycle, holdMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phrases, holdMs, fadeMs]);

  useEffect(() => {
    if (skipEnterOnMountRef.current) {
      skipEnterOnMountRef.current = false;
      return undefined;
    }
    if (leaving) return undefined;
    setEntering(true);
    const raf = requestAnimationFrame(() => setEntering(false));
    return () => cancelAnimationFrame(raf);
  }, [index, leaving]);

  const phrase = phrases[index] ?? "";

  return (
    <span
      className={cn(
        "chat-lab__hero-rotator",
        leaving && "chat-lab__hero-rotator--leaving",
        entering && "chat-lab__hero-rotator--entering",
      )}
    >
      {phrase}
    </span>
  );
}

/**
 * Chat lab landing hero (avatar + greeting + rotating subtitle).
 */
const ChatLabHero = forwardRef(function ChatLabHero({ className, suppressTitleEntrance = false }, ref) {
  const { theme } = useTheme();
  const { t } = useI18n();

  const phrases = [
    t("chatLab.heroPhrase1"),
    t("chatLab.heroPhrase2"),
    t("chatLab.heroPhrase3"),
    t("chatLab.heroPhrase4"),
  ];

  return (
    <div ref={ref} className={cn("chat-lab__hero", className)}>
      <div className="chat-lab__hero-avatar">
        <img
          className="chat-lab__hero-avatar-icon"
          src={theme === "dark" ? heroAvatarDark : heroAvatarLight}
          alt=""
          aria-hidden
        />
      </div>

      <h1 className={cn("chat-lab__hero-title", suppressTitleEntrance && "chat-lab__hero-title--static")}>
        <span className="chat-lab__hero-hi">Hi,</span>{" "}
        <span className="chat-lab__hero-brand">{t("chatLab.heroGreeting", { brand: t("titlebar.appName") })}</span>
      </h1>

      <p className="chat-lab__hero-sub">
        <HeroPhraseRotator phrases={phrases} />
      </p>
    </div>
  );
});

export default ChatLabHero;
