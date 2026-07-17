import { useContext } from "react";
import { useI18n } from "../context/I18nContext.jsx";
import { Button } from "@open-studio/udesign";
import { cn } from "./cn.js";
import { ModalCloseContext } from "./Modal.jsx";

function CloseGlyph({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ModalCloseButton({ onClick, "aria-label": ariaLabel, className }) {
  const { t } = useI18n();
  const requestClose = useContext(ModalCloseContext);
  const label = ariaLabel ?? t("modalClose.close");
  const handleClick = requestClose ?? onClick;
  return (
    <Button
      type="button"
      variant="text"
      shape="square"
      size="small"
      aria-label={label}
      onClick={handleClick}
      className={cn("os-modal-close shrink-0", className)}
    >
      <CloseGlyph />
    </Button>
  );
}
