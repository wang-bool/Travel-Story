import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Story — 你的旅行计划，本身就是纪录片脚本",
  description:
    "旅行前规划路线，旅行后上传照片与视频，系统自动把行程、地图动画和你的素材组合成一部旅行纪录片。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
