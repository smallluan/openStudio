export default function App() {
  const title = window.appInfo?.name ?? "Open Studio";

  return (
    <main className="app">
      <h1>{title}</h1>
      <p>
        React + Vite 已就绪。开发请运行 <code>npm run dev</code>。
      </p>
    </main>
  );
}
