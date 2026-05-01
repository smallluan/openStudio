import UserSettingsStrip from "../components/shell/UserSettingsStrip.jsx";

export default function SettingsPage() {
  return (
    <div className="route-page route-page--plain">
      <header className="route-page__header">
        <h1 className="route-page__title">设置</h1>
        <p className="route-page__desc muted">
          Gateway 与密钥等连接配置见下方。后续与模型相关的选项（默认模型、温度、上下文等）都会集中在这里。
        </p>
      </header>
      <section className="route-page__settings">
        <UserSettingsStrip />
      </section>
    </div>
  );
}
