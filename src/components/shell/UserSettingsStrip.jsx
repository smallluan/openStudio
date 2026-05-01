import { useEffect, useState } from "react";

export default function UserSettingsStrip() {
  const [gateway, setGateway] = useState("http://127.0.0.1:18789");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await window.studioBridge?.getUserConfig?.();
        if (!cancelled && c) {
          setGateway(c.openclaw?.gatewayBaseUrl ?? gateway);
          setHasKey(Boolean(c.credentials?.hasProviderApiKey));
        }
      } catch {
        /* preload 未就绪时忽略 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaved(null);
    try {
      const patch = {
        openclaw: { gatewayBaseUrl: gateway.trim() },
      };
      if (apiKey.trim() !== "") {
        patch.credentials = { providerApiKey: apiKey.trim() };
      }
      await window.studioBridge?.setUserConfig?.(patch);
      setApiKey("");
      const c = await window.studioBridge?.getUserConfig?.();
      setHasKey(Boolean(c?.credentials?.hasProviderApiKey));
      setSaved("已保存（密钥仅存在于主进程 userData 配置文件，界面不展示明文）");
    } catch (e) {
      setSaved(`保存失败：${e?.message ?? e}`);
    }
  };

  return (
    <div className="settings-strip">
      <label className="settings-strip__field">
        <span>Gateway URL</span>
        <input
          value={gateway}
          onChange={(e) => setGateway(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="settings-strip__field">
        <span>Provider API Key {hasKey ? "（已保存，留空不改）" : ""}</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
        />
      </label>
      <button type="button" className="btn-primary" onClick={save}>
        保存配置
      </button>
      {saved ? <span className="settings-strip__hint">{saved}</span> : null}
    </div>
  );
}
