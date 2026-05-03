import { createContext } from "react";

/** @type {React.Context<{ registerSessionAnchor: (sessionId: string, node: HTMLElement | null) => void; attachNestedScrollRoot: (node: HTMLElement | null) => (() => void) | undefined } | null>} */
export const FluidNavHighlightApi = createContext(null);
