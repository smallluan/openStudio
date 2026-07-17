import { createContext, useCallback, useContext, useState } from "react";
import { Dialog } from "tdesign-react";
import { cn } from "./cn.js";

export const ModalCloseContext = createContext(null);

/** Prefer this over raw `onClose` for buttons inside {@link Modal}. */
export function useModalRequestClose() {
  return useContext(ModalCloseContext);
}

/**
 * App modal shell backed by TDesign Dialog.
 * Mount to show; dismiss plays TDesign exit animation, then calls onClose.
 */
export default function Modal({ children, className, labelledBy, onClose, width = "920px" }) {
  const [visible, setVisible] = useState(true);

  const requestClose = useCallback(() => {
    setVisible(false);
  }, []);

  const handleClosed = useCallback(() => {
    onClose?.();
  }, [onClose]);

  return (
    <ModalCloseContext.Provider value={requestClose}>
      <Dialog
        visible={visible}
        attach="body"
        placement="center"
        header={false}
        footer={false}
        closeBtn={false}
        closeOnOverlayClick
        closeOnEscKeydown
        destroyOnClose={false}
        width={width}
        zIndex={2500}
        dialogClassName={cn("os-modal-dialog", className)}
        onClose={requestClose}
        onClosed={handleClosed}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className="os-modal-panel relative flex max-h-[min(92vh,840px)] w-full overflow-hidden rounded-2xl text-[var(--os-text)]"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </Dialog>
    </ModalCloseContext.Provider>
  );
}
