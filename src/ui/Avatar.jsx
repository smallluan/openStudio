import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, Trash2, User, X } from "lucide-react";
import { cn } from "./cn.js";

/** @typedef {"xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"} AvatarSize */
/** @typedef {"circle" | "square" | "rounded"} AvatarShape */
/** @typedef {"idle" | "loading" | "loaded" | "error"} AvatarStatus */

/**
 * @typedef {{
 *   src?: string | null;
 *   alt?: string;
 *   name?: string;
 *   fallback?: import("react").ReactNode;
 *   size?: AvatarSize;
 *   shape?: AvatarShape;
 *   className?: string;
 *   imgClassName?: string;
 *   loading?: "lazy" | "eager";
 *   onLoad?: () => void;
 *   onError?: () => void;
 *   onClick?: (e: import("react").MouseEvent) => void;
 *   status?: AvatarStatus;
 *   showStatus?: boolean;
 *   statusColor?: "online" | "offline" | "busy" | "away";
 *   editable?: boolean;
 *   onUpload?: (file: File) => void | Promise<void>;
 *   onDelete?: () => void | Promise<void>;
 *   accept?: string;
 *   maxSize?: number;
 * }} AvatarProps
 */

/**
 * @typedef {{
 *   src?: string | null;
 *   alt?: string;
 *   name?: string;
 *   size?: AvatarSize;
 *   shape?: AvatarShape;
 *   className?: string;
 * }} AvatarGroupItemProps
 */

/**
 * @typedef {{
 *   children: import("react").ReactNode;
 *   max?: number;
 *   size?: AvatarSize;
 *   shape?: AvatarShape;
 *   className?: string;
 * }} AvatarGroupProps
 */

// ============================================================================
// Constants
// ============================================================================

const SIZE_MAP = /** @type {const} */ ({
  xs: { container: 24, text: 10, icon: 12, status: 6, group: -2 },
  sm: { container: 32, text: 12, icon: 16, status: 8, group: -3 },
  md: { container: 40, text: 14, icon: 20, status: 10, group: -4 },
  lg: { container: 48, text: 16, icon: 24, status: 12, group: -5 },
  xl: { container: 64, text: 20, icon: 32, status: 14, group: -6 },
  "2xl": { container: 80, text: 24, icon: 40, status: 16, group: -8 },
  "3xl": { container: 96, text: 28, icon: 48, status: 18, group: -10 },
});

const SHAPE_MAP = /** @type {const} */ ({
  circle: "rounded-full",
  square: "rounded-none",
  rounded: "rounded-lg",
});

const STATUS_COLORS = /** @type {const} */ ({
  online: "bg-green-500",
  offline: "bg-gray-400",
  busy: "bg-red-500",
  away: "bg-yellow-500",
});

const DEFAULT_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-emerald-500",
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate initials from a name
 * @param {string} name
 * @returns {string}
 */
function getInitials(name) {
  if (!name) return "";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/**
 * Generate a deterministic color based on name
 * @param {string} name
 * @returns {string}
 */
function getColorFromString(name) {
  if (!name) return DEFAULT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

/**
 * Format file size for display
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Status indicator dot
 * @param {{ size: number; color: string; className?: string }} props
 */
function StatusDot({ size, color, className }) {
  return (
    <span
      className={cn(
        "absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--os-bg-panel)]",
        STATUS_COLORS[color],
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={`Status: ${color}`}
    />
  );
}

/**
 * Edit overlay for upload action (delete button moved to top-right corner)
 * @param {{
 *   size: AvatarSize;
 *   onUpload: () => void;
 *   uploading: boolean;
 *   visible: boolean;
 * }} props
 */
function EditOverlay({ size, onUpload, uploading, visible }) {
  const iconSize = SIZE_MAP[size].icon;
  const containerSize = SIZE_MAP[size].container;
  const showActions = containerSize >= 48;

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center rounded-[inherit]",
        "bg-black/50 transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
    >
      {uploading ?
        <div className="os-image__spinner" />
      : showActions ?
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUpload();
          }}
          className="rounded-lg bg-white/20 p-1.5 backdrop-blur-sm transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Upload avatar"
        >
          <Camera size={iconSize * 0.6} className="text-white" />
        </button>
      : (
        <Camera size={iconSize * 0.6} className="text-white" />
      )}
    </div>
  );
}

/**
 * Delete button in top-right corner
 * @param {{
 *   size: AvatarSize;
 *   onDelete: () => void;
 * }} props
 */
function DeleteButton({ size, onDelete }) {
  const iconSize = SIZE_MAP[size].icon;
  const containerSize = SIZE_MAP[size].container;
  const buttonSize = Math.max(16, containerSize * 0.25);
  const offset = containerSize * 0.05;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className={cn(
        "absolute flex items-center justify-center z-20",
        "rounded-full bg-[var(--os-bg-panel)] text-[var(--os-text-muted)]",
        "shadow-sm ring-1 ring-[var(--os-border)]",
        "transition-colors hover:bg-red-50 hover:text-red-500 hover:ring-red-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
      )}
      style={{
        width: buttonSize,
        height: buttonSize,
        top: -offset,
        right: -offset,
        fontSize: buttonSize * 0.5,
      }}
      aria-label="Delete avatar"
    >
      <X size={buttonSize * 0.6} />
    </button>
  );
}

/**
 * Avatar group overflow indicator
 * @param {{ count: number; size: AvatarSize; shape: AvatarShape; className?: string }} props
 */
function AvatarOverflow({ count, size, shape, className }) {
  const { container: containerSize, text: textSize } = SIZE_MAP[size];

  return (
    <div
      className={cn(
        "flex items-center justify-center border-2 border-[var(--os-bg-panel)] bg-[var(--os-bg-subtle)] text-[var(--os-text-muted)]",
        SHAPE_MAP[shape],
        className,
      )}
      style={{
        width: containerSize,
        height: containerSize,
        fontSize: textSize,
      }}
      aria-label={`${count} more`}
    >
      +{count}
    </div>
  );
}

// ============================================================================
// Main Avatar Component
// ============================================================================

/**
 * @param {AvatarProps} props
 */
export default function Avatar({
  src,
  alt = "",
  name,
  fallback,
  size = "md",
  shape = "circle",
  className,
  imgClassName,
  loading = "lazy",
  onLoad,
  onError,
  onClick,
  status: externalStatus,
  showStatus = false,
  statusColor = "online",
  editable = false,
  onUpload,
  onDelete,
  accept = "image/*",
  maxSize = 5 * 1024 * 1024, // 5MB
}) {
  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [internalStatus, setInternalStatus] = useState(/** @type {AvatarStatus} */ ("idle"));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const prevSrcRef = useRef(src);

  const status = externalStatus ?? internalStatus;

  // Overlay state management for editable mode
  const [showOverlay, setShowOverlay] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const overlayTimeoutRef = useRef(/** @type {number | null} */ (null));

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current != null) {
        clearTimeout(overlayTimeoutRef.current);
      }
    };
  }, []);

  // Show overlay when hovering (editable mode)
  useEffect(() => {
    if (!editable) return;
    if (isHovering && !uploading) {
      setShowOverlay(true);
    } else if (!isHovering) {
      // Delay hiding overlay to avoid flickering
      overlayTimeoutRef.current = setTimeout(() => {
        setShowOverlay(false);
      }, 100);
    }
  }, [editable, isHovering, uploading]);

  // Reset status when src changes
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src;
      setInternalStatus(src ? "loading" : "idle");
      setError(null);
    }
  }, [src]);

  // Set loading state when src is provided
  useEffect(() => {
    if (src && status === "idle") {
      setInternalStatus("loading");
    }
  }, [src, status]);

  const handleLoad = useCallback(() => {
    setInternalStatus("loaded");
    setError(null);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setInternalStatus("error");
    onError?.();
  }, [onError]);

  const handleFileSelect = useCallback(
    /** @param {File} file */
    async (file) => {
      if (!onUpload) return;

      // Validate file type
      if (!file.type.startsWith("image/")) {
        setError("Please select an image file");
        return;
      }

      // Validate file size
      if (file.size > maxSize) {
        setError(`File size must be less than ${formatFileSize(maxSize)}`);
        return;
      }

      setUploading(true);
      setError(null);
      try {
        await onUpload(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [maxSize, onUpload],
  );

  const handleInputChange = useCallback(
    /** @param {import("react").ChangeEvent<HTMLInputElement>} e */
    (e) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
      // Reset input
      e.target.value = "";
      // Restore overlay hover state after file dialog closes
      setTimeout(() => {
        setIsHovering(true);
      }, 100);
    },
    [handleFileSelect],
  );

  const handleInputBlur = useCallback(() => {
    // Restore overlay hover state when file dialog closes (cancel or select)
    setTimeout(() => {
      setIsHovering(true);
    }, 100);
  }, []);

  const handleUploadClick = useCallback(() => {
    // Hide overlay immediately when clicking upload button
    setShowOverlay(false);
    setIsHovering(false);
    fileInputRef.current?.click();
  }, []);

  const handleDeleteClick = useCallback(() => {
    if (onDelete) {
      void onDelete();
    }
  }, [onDelete]);

  // Generate initials and color for text avatar
  const initials = useMemo(() => getInitials(name || ""), [name]);
  const backgroundColor = useMemo(() => getColorFromString(name || ""), [name]);

  // Get size config
  const sizeConfig = SIZE_MAP[size];
  const containerSize = sizeConfig.container;
  const textSize = sizeConfig.text;
  const iconSize = sizeConfig.icon;
  const statusDotSize = sizeConfig.status;

  // Determine what to render
  const hasImage = src && status !== "error";
  const showTextAvatar = !hasImage && initials;
  const showFallback = !hasImage && !initials;

  const clickable = Boolean(onClick);
  const ContainerTag = clickable ? "button" : "div";

  return (
    <ContainerTag
      type={clickable ? "button" : undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-visible align-middle",
        SHAPE_MAP[shape],
        clickable && "cursor-pointer transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)] focus-visible:ring-offset-2",
        editable && "group",
        className,
      )}
      style={{ width: containerSize, height: containerSize }}
      onClick={onClick}
      onMouseEnter={editable ? () => setIsHovering(true) : undefined}
      onMouseLeave={editable ? () => setIsHovering(false) : undefined}
      aria-label={alt || name || "Avatar"}
    >
      {/* Image Avatar */}
      {hasImage && (
        <div className={cn("absolute inset-0 overflow-hidden", SHAPE_MAP[shape])}>
          <img
            src={src}
            alt={alt || name || "Avatar"}
            width={containerSize}
            height={containerSize}
            loading={loading}
            decoding="async"
            className={cn(
              "h-full w-full object-cover",
              status !== "loaded" && "invisible",
              imgClassName,
            )}
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>
      )}

      {/* Loading Spinner */}
      {(status === "loading" || uploading) && (
        <div className={cn("absolute inset-0 flex items-center justify-center bg-[var(--os-bg-subtle)]", SHAPE_MAP[shape])}>
          <div className="os-image__spinner" />
        </div>
      )}

      {/* Text Avatar */}
      {showTextAvatar && (
        <div
          className={cn("absolute inset-0 flex items-center justify-center font-semibold text-white overflow-hidden", SHAPE_MAP[shape], backgroundColor)}
          style={{ fontSize: textSize }}
          aria-hidden
        >
          {initials}
        </div>
      )}

      {/* Fallback Icon */}
      {showFallback && (
        <div
          className={cn("absolute inset-0 flex items-center justify-center bg-[var(--os-bg-subtle)] text-[var(--os-text-muted)] overflow-hidden", SHAPE_MAP[shape])}
          aria-hidden
        >
          {fallback ?? <User size={iconSize} />}
        </div>
      )}

      {/* Delete Button (Top-Right Corner) - Only show on hover */}
      {editable && onDelete && src && !uploading && showOverlay && (
        <DeleteButton size={size} onDelete={handleDeleteClick} />
      )}

      {/* Edit Overlay */}
      {editable && onUpload && (
        <EditOverlay
          size={size}
          onUpload={handleUploadClick}
          uploading={uploading}
          visible={showOverlay}
        />
      )}

      {/* Status Indicator */}
      {showStatus && !editable && (
        <StatusDot size={statusDotSize} color={statusColor} className="z-10" />
      )}

      {/* Hidden File Input */}
      {editable && (
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          className="hidden"
          aria-label="Upload avatar"
        />
      )}
    </ContainerTag>
  );
}

// ============================================================================
// AvatarGroup Component
// ============================================================================

/**
 * Display a group of avatars with overflow indicator
 * @param {AvatarGroupProps} props
 */
export function AvatarGroup({ children, max = 4, size = "md", shape = "circle", className }) {
  const childArray = useMemo(() => {
    return Array.isArray(children) ? children : [children];
  }, [children]);

  const visibleCount = Math.min(max, childArray.length);
  const overflowCount = childArray.length - max;
  const groupOffset = SIZE_MAP[size].group;

  return (
    <div className={cn("flex items-center", className)}>
      {childArray.slice(0, visibleCount).map((child, index) => (
        <div
          key={index}
          className="ring-2 ring-[var(--os-bg-panel)]"
          style={{
            marginLeft: index === 0 ? 0 : groupOffset,
            zIndex: childArray.length - index,
          }}
        >
          {child}
        </div>
      ))}
      {overflowCount > 0 && (
        <div style={{ marginLeft: groupOffset, zIndex: 0 }}>
          <AvatarOverflow count={overflowCount} size={size} shape={shape} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AvatarUpload Component (Full-featured Upload UI)
// ============================================================================

/**
 * @typedef {{
 *   src?: string | null;
 *   name?: string;
 *   onUpload: (file: File) => void | Promise<void>;
 *   onDelete?: () => void | Promise<void>;
 *   size?: AvatarSize;
 *   shape?: AvatarShape;
 *   accept?: string;
 *   maxSize?: number;
 *   className?: string;
 * }} AvatarUploadProps
 */

/**
 * Avatar with full upload UI including preview, edit controls, and drag-drop
 * @param {AvatarUploadProps} props
 */
export function AvatarUpload({
  src,
  name,
  onUpload,
  onDelete,
  size = "xl",
  shape = "circle",
  accept = "image/*",
  maxSize = 5 * 1024 * 1024,
  className,
}) {
  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [preview, setPreview] = useState(/** @type {string | null} */ (null));

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const handleFileSelect = useCallback(
    /** @param {File} file */
    async (file) => {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        setError("Please select an image file");
        return;
      }

      // Validate file size
      if (file.size > maxSize) {
        setError(`File size must be less than ${formatFileSize(maxSize)}`);
        return;
      }

      setUploading(true);
      setError(null);

      // Create preview
      const previewUrl = URL.createObjectURL(file);
      setPreview(previewUrl);

      try {
        await onUpload(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        URL.revokeObjectURL(previewUrl);
        setPreview(null);
      } finally {
        setUploading(false);
      }
    },
    [maxSize, onUpload],
  );

  const handleInputChange = useCallback(
    /** @param {import("react").ChangeEvent<HTMLInputElement>} e */
    (e) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
      e.target.value = "";
    },
    [handleFileSelect],
  );

  const handleDrag = useCallback(
    /** @param {import("react").DragEvent} e */
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "dragenter" || e.type === "dragover") {
        setDragActive(true);
      } else if (e.type === "dragleave") {
        setDragActive(false);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    /** @param {import("react").DragEvent} e */
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      if (preview) {
        URL.revokeObjectURL(preview);
        setPreview(null);
      }
      void onDelete();
    }
  }, [onDelete, preview]);

  const displaySrc = preview || src;
  const sizeConfig = SIZE_MAP[size];
  const containerSize = sizeConfig.container;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          dragActive && "ring-2 ring-[var(--os-accent)] ring-offset-2",
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <Avatar
          src={displaySrc}
          name={name}
          size={size}
          shape={shape}
          status={uploading ? "loading" : "idle"}
          editable
          onUpload={handleUploadClick}
          onDelete={onDelete ? handleDelete : undefined}
          uploading={uploading}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
          aria-label="Upload avatar"
        />

        {dragActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-[var(--os-accent)]/10">
            <Plus size={containerSize / 3} className="text-[var(--os-accent)]" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={uploading}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-[var(--os-accent)] text-white hover:brightness-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {uploading ? "Uploading..." : "Upload Photo"}
        </button>

        {onDelete && displaySrc && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={uploading}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              "bg-[var(--os-bg-subtle)] text-[var(--os-text)] hover:bg-[var(--os-bg-hover)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            Remove
          </button>
        )}
      </div>

      <p className="text-xs text-[var(--os-text-muted)]">
        Max file size: {formatFileSize(maxSize)}
      </p>
    </div>
  );
}