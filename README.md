# Travel Story

Travel Story 是一个面向个人使用的旅行规划与旅行纪录片生成工具。你可以先按天安排地点和交通方式，旅行回来后为地点补充照片与视频，再让地图动画、字幕和素材合成一段旅行影片。

项目按单用户自部署方式开发。它没有账号系统，也没有多用户数据隔离，适合运行在自己的电脑、家庭服务器或可信局域网中。

## 项目截图

README 预留以下截图。截图文件补齐后放入 `public/readme/`，建议使用 1600 × 900 像素，并使用不含私人信息的演示行程。

| 文件名 | 内容 |
| --- | --- |
| `01-home.png` | 首页首屏、地球和主要入口 |
| `02-trip-list.png` | 三至四条演示行程 |
| `03-trip-planner.png` | 时间线、地点和地图路线 |
| `04-story-playback.png` | 地图动画、路线和字幕 |
| `05-story-export.png` | 录制或导出选项，可选 |

新截图尚未加入仓库，因此这里不引用不存在的图片。

## 已实现功能

### Plan 旅行规划

- 创建、编辑和删除旅行
- 按日期维护 Day 和地点
- 使用高德与 LocationIQ 搜索国内外地点
- 选择汽车、步行、自行车、火车、飞机、轮船等交通方式
- 计算道路路线、步行路线、骑行路线和大圆航线
- 在国内与国际底图之间切换
- 查看全球足迹

### Record 旅行记录

- 为每个地点上传照片和视频
- 将素材保存在部署机器的 `data/media/`
- 在浏览器中预览地点素材
- 对视频请求提供 Range 响应

### Story 旅行影片

- 按行程顺序播放地图镜头、路线和载具动画
- 将地图、地点字幕、照片和视频合成到画布
- 输出横屏 16:9 或竖屏 9:16
- 选择 720p 或 1080p
- 选择 30 FPS 或 60 FPS
- 使用浏览器 MediaRecorder 实时录制
- 使用 WebCodecs 或 JPEG 帧序列进行离线渲染
- 通过 FFmpeg 转码或合成 MP4
- 在支持的 NVIDIA 环境中尝试 NVENC 编码，失败后回退到 libx264

## 运行环境

- Node.js 20 或更高版本
- npm
- FFmpeg，并确保 `ffmpeg` 可以从命令行直接运行
- 支持 WebGL 的现代浏览器
- 可选的 WebCodecs 支持
- 可选的 NVIDIA GPU 与可用的 FFmpeg NVENC 编码器

不生成影片时，缺少 FFmpeg 不影响行程规划和地图预览。

## 安装与启动

安装依赖。

```bash
npm install
```

复制环境变量模板。

```bash
cp .env.example .env.local
```

按需填写地点搜索密钥。至少配置一个地点服务，搜索功能才能返回结果。

开发模式。

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

生产模式。

```bash
npm run build
npm start
```

类型检查。

```bash
npm run typecheck
```

## 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `GAODE_KEY` | 国内地点搜索、逆地理编码、国内步行和骑行路线 | 未配置 |
| `LOCATIONIQ_KEY` | 国外地点搜索和逆地理编码 | 未配置 |
| `MAX_MEDIA_UPLOAD_MB` | 单个地点素材上传上限 | 250 MB |
| `MAX_RECORDING_UPLOAD_MB` | 单个完整录像上传上限 | 512 MB |
| `MAX_FRAME_BATCH_MB` | 单批 JPEG 帧上传上限 | 64 MB |
| `MAX_TRIPS_BODY_MB` | 行程 JSON 写入上限 | 10 MB |

密钥只应写入 `.env.local`。不要给服务端密钥添加 `NEXT_PUBLIC_` 前缀。

## 地图与第三方服务

- 国内底图使用高德地图
- 国际矢量底图来自 OpenFreeMap，并经 `/api/tiles` 缓存代理
- 驾车等道路路线使用 OSRM 公共演示服务
- 国内步行与骑行路线使用高德 Web 服务
- 国外地点搜索使用 LocationIQ
- 页面字体从 Google Fonts 加载，网络不可用时会使用系统字体

OpenFreeMap、OSRM、Google Fonts、高德和 LocationIQ 都依赖外部网络与各自的服务条款。公开服务的可用性和请求额度不由本项目保证。

## 本地数据与备份

应用数据默认写在项目根目录的 `data/`。

```text
data/
├── trips.json
├── media/
└── recordings/
```

国际地图瓦片缓存在 `tile-cache/`。持续浏览地图或下载离线瓦片后，该目录可能占用较多磁盘空间。

升级、迁移或清理项目以前，请备份 `data/` 和自己的 `.env.local`。这两个目录都已被 Git 忽略。

## 自部署边界

所有业务 API 都没有登录校验。只要能访问服务，就能读取或改写行程、上传素材、删除素材和生成影片。

建议只监听本机地址，或者把服务放在可信局域网中。需要暴露到公网时，应在反向代理或应用层增加身份验证、HTTPS、请求速率限制和独立的数据备份。

当前地理编码与路线接口使用单进程内存限流。多进程或多实例部署不会共享这份计数。

## 已知问题

- 2026 年 8 月 26 日运行 `npm audit --registry=https://registry.npmjs.org` 时，报告包含 3 个高危项，涉及 Next.js 及其间接依赖 PostCSS 和 sharp。本轮开源清理按项目约束保留现有依赖版本。
- `mp4-muxer@5.2.2` 已被上游标记为停止维护。当前离线 MP4 路径仍依赖它。
- 项目没有 ESLint 依赖，Next.js 构建配置会跳过 lint。当前使用 TypeScript 类型检查、未使用代码检查和生产构建做基础验证。
- 首页和地图页面的首次加载代码约为 435 KB 至 449 KB，主要来自 MapLibre 与地图功能。进一步拆包会影响地图初始化流程，本轮没有改动。
- WebCodecs、MediaRecorder、硬件编码和 Canvas 录制能力随浏览器、操作系统与显卡驱动变化。
- 新 README 截图需要项目维护者按“项目截图”一节补充。

## 开源许可

项目使用 [MIT License](./LICENSE)。

## 关注与交流

<table>
  <tr>
    <td align="center">
      <img src="./public/readme/wechat-official-account.jpg" width="240" alt="王不二丶bOol 公众号二维码" />
      <br />
      公众号
    </td>
    <td align="center">
      <img src="./public/readme/wechat-group.png" width="240" alt="Travel Story 交流群二维码" />
      <br />
      交流群
    </td>
  </tr>
</table>

当前群二维码图片标注的有效期截止到 2026 年 8 月 21 日，现已过期。请通过公众号获取新的入群方式，替换 `public/readme/wechat-group.png` 后 README 会自动显示新图。
