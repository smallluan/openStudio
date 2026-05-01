export default function LobsterManagementPage() {
  return (
    <div className="route-page route-page--plain">
      <header className="route-page__header">
        <h1 className="route-page__title">龙虾管理</h1>
        <p className="route-page__desc muted">
          管理龙虾相关配置与状态的入口页面，具体内容后续接入。
        </p>
      </header>
      <div className="route-page__placeholder">
        <p className="muted">此处可放置龙虾列表、投喂计划、或与 OpenClaw 联动的控制台。</p>
      </div>
    </div>
  );
}
