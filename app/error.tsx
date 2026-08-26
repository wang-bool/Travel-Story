"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[travel-story] 页面错误", error);
  }, [error]);

  return (
    <main className="notfound">
      <p className="font-mono kicker">OOPS</p>
      <h1 className="font-display" style={{ fontSize: 40, margin: 0 }}>
        出了点小状况
      </h1>
      <p style={{ color: "var(--muted)", maxWidth: 420 }}>
        页面渲染遇到一个错误。你的数据都安全保存在本地，重试即可。
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn" onClick={() => reset()}>
          重试
        </button>
        <a className="btn btn-ghost" href="/">
          返回首页
        </a>
      </div>
    </main>
  );
}
