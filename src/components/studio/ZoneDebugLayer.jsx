import { ZONE_REGISTRY } from "../../studio/zones.js";

/** 开发用：分区边框，后续可接关卡编辑器或关闭 */
export default function ZoneDebugLayer({ visible = false }) {
  if (!visible) return null;

  return (
    <div className="zone-debug-layer" aria-hidden>
      {ZONE_REGISTRY.map((z) => (
        <div
          key={z.id}
          className="zone-debug-rect"
          style={{
            left: `${z.bounds.x}%`,
            top: `${z.bounds.y}%`,
            width: `${z.bounds.w}%`,
            height: `${z.bounds.h}%`,
          }}
          title={z.label}
        />
      ))}
    </div>
  );
}
