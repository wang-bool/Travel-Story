<div align="center">

<img src="./public/readme/cover.png" alt="Travel Story" width="100%" />

# 🧳 Travel Story

**把你的旅行，变成一部带地图动画与字幕的纪录片。**

一次旅行，一颗星球 —— 从一个想法，到一条路线，再到一部影片。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![self-hosted](https://img.shields.io/badge/self--hosted-brightgreen.svg)](.)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Last commit](https://img.shields.io/github/last-commit/wang-bool/Travel-Story)](.)

</div>

> ⭐ 如果这个项目对你有用，欢迎 **Star**，让更多旅行者看到它。

---

**Travel Story** 是一个面向个人的旅行规划与旅行影片生成工具：出发前按天安排地点与交通方式，旅行结束后为地点补上照片与视频，再让地图镜头、路线、载具与字幕沿时间线自动合成一段旅行影片。

它以**单用户自部署**方式运行，适合跑在自己的电脑、家庭服务器或可信局域网里。

---

## 📸 项目展示

<div align="center">
  <img src="./public/readme/story-movie.gif" alt="旅行影片：地图镜头沿时间线播放" width="85%" />
  <br />
  <sub>一次旅行，一部影片 —— 地图镜头、路线与字幕沿时间线自动播放</sub>
</div>

<table>
  <tr>
    <td align="center">
      <img src="./public/readme/plan-timeline.png" alt="旅行规划：按天的时间线与地图路线" width="100%" />
      <br /><sub>规划 · 按天排行程，选交通方式</sub>
    </td>
    <td align="center">
      <img src="./public/readme/story-export.png" alt="旅行影片：选择画幅、分辨率和帧率" width="100%" />
      <br /><sub>成片 · 输出画幅、分辨率与帧率</sub>
    </td>
  </tr>
</table>

---

## ✨ 核心功能

### 🗺️ Plan · 旅行规划

- 创建 / 编辑 / 删除旅行，按天维护 Day 与地点
- 高德 + LocationIQ 国内外地点搜索
- 汽车 · 步行 · 自行车 · 火车 · 飞机 · 轮船，多交通方式
- 道路 / 步行 / 骑行 / 大圆航线，国内外底图切换
- 全球足迹一览

### 📷 Record · 旅行记录

- 为每个地点上传照片与视频
- 素材保存在部署机器本地 `data/media/`，浏览器即传即看

### 🎬 Story · 旅行成片

- 地图镜头 + 路线 + 载具 + 字幕按行程顺序播放
- 照片 / 视频 / 字幕自动合成到画布
- 横屏 16:9 · 竖屏 9:16
- 720p · 1080p，30 / 60 FPS
- MediaRecorder 实时录制
- WebCodecs / JPEG 帧离线渲染，FFmpeg 合成 MP4
- 支持 NVIDIA NVENC，失败自动回退 libx264

---

## 🛠️ 技术栈

**Next.js 15 · React 19 · TypeScript · MapLibre GL · Turf.js · FFmpeg**

地图与地点数据来自高德、LocationIQ、OpenFreeMap 与 OSRM。

---

## 🚀 快速开始

```bash
npm install
cp .env.example .env.local      # 至少配置一个地点搜索密钥，否则搜索无结果
npm run dev                     # 打开 http://localhost:3000
```

生产模式：`npm run build && npm start`　·　类型检查：`npm run typecheck`

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `GAODE_KEY` | 国内地点搜索、逆地理编码、国内步行与骑行路线 | 未配置 |
| `LOCATIONIQ_KEY` | 国外地点搜索与逆地理编码 | 未配置 |
| `MAX_MEDIA_UPLOAD_MB` | 单个地点素材上传上限 | 250 MB |
| `MAX_RECORDING_UPLOAD_MB` | 单个完整录像上传上限 | 512 MB |
| `MAX_FRAME_BATCH_MB` | 单批 JPEG 帧上传上限 | 64 MB |
| `MAX_TRIPS_BODY_MB` | 行程 JSON 写入上限 | 10 MB |

> 密钥只写进 `.env.local`，不要给服务端密钥加 `NEXT_PUBLIC_` 前缀。

---

## 🛡️ 部署与边界

- 需要 **Node.js 20+**、npm、可用的 `ffmpeg` 命令、支持 WebGL 的现代浏览器；不生成影片时没有 FFmpeg 也不影响规划与地图预览。
- 应用数据默认写在项目根目录的 `data/`（行程、媒体、录像），国际地图瓦片缓存在 `tile-cache/`；升级、迁移或清理前请备份 `data/` 与自己的 `.env.local`，这两处都被 Git 忽略。
- 所有业务 API 没有登录校验，只要能访问服务即可读写行程、上传或删除素材、提交录像和触发 FFmpeg。建议只监听本机地址或放入可信局域网；需要暴露公网时，应在反向代理或应用层补充身份验证、HTTPS、速率限制与独立备份。

**当前状态**：足迹元数据、地图预热、WebCodecs / FFmpeg / NVENC 等能力依赖浏览器、显卡与外部地图服务；账号系统、AI 规划行程、数据库、公开分享、多端同步、协作编辑等属于后续路线图，尚未实现。

---

## 📜 开源许可

项目使用 [MIT License](./LICENSE)。

---

## 💬 关注与交流

对本项目有任何疑问或想法，都欢迎进群探讨。

如果你对 **AI**、**AI Coding** 或 **Agent** 感兴趣，欢迎关注公众号、进群一起交流。

<table>
  <tr>
    <td align="center">
      <img src="./public/readme/wechat-official-account.jpg" width="240" alt="王不二丶bOol 公众号二维码" />
      <br />公众号
    </td>
    <td align="center">
      <img src="./public/readme/wechat-group.png" width="240" alt="AI / AI Coding / Agent 交流群二维码" />
      <br />交流群
    </td>
  </tr>
</table>

> 如果群二维码过期，可以关注微信公众号获取入群方式，或添加作者微信：`wang_bool`。
