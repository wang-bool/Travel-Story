# GitHub 信息与社区投递

## GitHub About

在仓库的 About 区域填写以下内容。

**Description**

`Self-hosted trip planner that turns itineraries, photos, and map animations into local travel movies.`

**Topics**

`open-source`, `self-hosted`, `travel-planner`, `trip-planner`, `travel-journal`, `travel-video`, `maplibre`, `map-animation`, `webcodecs`, `ffmpeg`, `nextjs`, `typescript`, `personal-software`

**Website**

没有公开演示站时留空。项目是本地单用户应用，填一个无法体验的落地页没有价值。

**Social preview**

上传 `public/readme/cover.png`。它会出现在 GitHub、社区帖和聊天软件的链接预览中。

## npm 发布

仓库已配置为 npm 初始化器包 `@wang-bool/create-travel-story`。发布账号必须拥有 `@wang-bool` scope。

```bash
npm login
npm run check
npm publish
```

发布完成后，用户可以运行：

```bash
npx @wang-bool/create-travel-story my-travel-story
```

## 社区链接

| 社区 | 链接 | 适合提交的时间 |
| --- | --- | --- |
| r/selfhosted | https://www.reddit.com/r/selfhosted/ | 现在。选择当周 New Project Megathread。 |
| Gitee Community | https://gitee.com/gitee-community | 现在。同步 GitHub 仓库后推荐项目。 |
| HelloGitHub | https://github.com/521xueweihan/HelloGitHub/issues/271 | 现在。先按审核标准检查文档和构建。 |
| Product Hunt | https://www.producthunt.com/launch | 有公开体验入口后。 |
| Show HN | https://news.ycombinator.com/submit | 有公开体验入口或一键可跑的演示后。 |
| awesome-selfhosted | https://github.com/awesome-selfhosted/awesome-selfhosted-data | 首个正式 release 满四个月后。 |

## 投递文案

### 中文

Travel Story 是一个单用户本地部署的旅行规划和旅行影片工具。按天安排地点和交通方式，补充照片或视频后，它会把地图路线、镜头、载具和字幕合成为 MP4。项目使用 Next.js、MapLibre、WebCodecs 和 FFmpeg，数据默认保存在你自己的设备上。

仓库：https://github.com/wang-bool/Travel-Story

### English

Travel Story is a self-hosted, single-user travel planner and travel-movie maker. Plan stops and transport by day, add photos or video, then render map routes, camera moves, vehicle markers, and captions to MP4. It uses Next.js, MapLibre, WebCodecs, and FFmpeg. Data stays on the machine running the app.

Repository: https://github.com/wang-bool/Travel-Story

### Show HN 标题

`Show HN: Travel Story, a self-hosted planner that renders map-based travel movies`
