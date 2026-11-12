# Travel Story MCP（本地 V2）

同一个行程库支持网页手动编辑和外部 Agent 调用。界面是独立 Web 应用，优先由 Agent 的内置交互浏览器打开，便于在对话中查看；没有内置浏览器或其无法访问本地服务时，降级为电脑系统浏览器。是否以标签页或面板呈现取决于 AI 客户端，不是 MCP 自带的嵌入界面。本版本提供 stdio MCP，不是将 `/api/mcp` 作为远程 MCP URL 直接填写。

## 启动与连接

使用 Node.js 22.18+，依赖需预先安装。推荐统一的一命令入口：

```bash
node "/absolute/path/to/Travel Story/mcp/start.mjs"
```

该入口连接 stdio MCP，同时自动检查并按需启动网页服务；已有认证通过的服务会复用。客户端仍需一次性接入此入口：在终端后台运行 stdio 服务器，不代表另一个 Agent 能自动发现它。地图搜索仍需在实际应用目录 `.env.local` 配置高德或 LocationIQ；国外地点搜索需要 LocationIQ。

在支持 stdio 的 MCP 客户端中添加以下服务。将路径替换成实际绝对路径；路径含空格时仍作为一个 args 数组元素。

```json
{
  "mcpServers": {
    "travel-story": {
      "command": "node",
      "args": ["/absolute/path/to/Travel Story/mcp/start.mjs"],
      "env": {
        "TRAVEL_STORY_URL": "http://localhost:3000"
      }
    }
  }
}
```

请使用 `node` 直接启动入口，避免 npm 的普通日志混入协议标准输出。项目目录内可用 `npm --silent run agent` 作为开发便捷别名；客户端配置仍推荐上面的 node 入口。各客户端配置入口不同；本项目不修改客户端配置文件。已有的客户端工具授权规则仍然生效。入口不自动安装依赖；退出 MCP 保留已启动的网页进程供浏览器继续使用。

以下描述服务生命周期协议；执行旅行规划 Skill 时，先 get_status 检查服务，未启动用 ensure_service 启动；然后必须实际打开内置浏览器并核验 UI 与连接，行程写入前不得跳过页面门槛。统一入口已完成启动检查时通常直接复用；`node mcp/index.mjs` 保留为按需启动模式，可在应用未启动时连接，再调用工具启动服务。`get_status` 返回 SERVICE_UNAVAILABLE 时，调用 `ensure_service({})`：已有认证通过的本地服务会被复用；没有服务时，启动已安装的应用并等待可用。有生产构建则运行 `next start`，否则 `next dev`。不自动安装依赖，不改变端口或终止占用进程。应用进程独立运行，关闭 MCP 不会自动退出应用。

同一个 MCP 进程内并发启动请求合并；启动超时后再次调用会检查同一存活进程，避免反复启动。地址和数据目录不匹配、依赖缺失或其他程序占用端口时返回错误。启动日志在数据目录 `service.log`，不写入 MCP 协议 stdout。开发时想看最新源码仍可手动 `npm run dev`；已有服务不会被 MCP 重启。

默认数据目录是项目内 `data/`。使用自定义目录时，必须给应用和 MCP 启动进程设置**同一个绝对路径** `TRAVEL_STORY_DATA_DIR`。自定义端口同时修改 `TRAVEL_STORY_URL`。MCP 入口按脚本位置定位默认数据目录，不依赖客户端的工作目录。

本地服务在首次桥接访问时生成 `data/mcp-token`，MCP 进程读取它进行认证。不要分享或提交该文件。默认开发/生产启动仅监听 127.0.0.1；网页业务接口校验 Host/Origin，MCP 桥接接口还要求令牌。

## 默认可见执行

创建行程、修改行程、编辑地点/日期和计算路线时，MCP 默认联动浏览器，不需要 Agent 额外调用打开/定位工具：

1. 复用当前应用窗口：无论停在首页、另一个行程还是播放页，先在同一窗口切到目标行程的规划页。没有窗口连接时才请求系统启动。
2. 页面刷新到本次修改后的版本，选中并滚动到相关地点/日期，移动地图镜头，短暂高亮卡片并显示操作提示。
3. 页面实际执行后回传回执。元数据更新保留镜头，后续路线刷新也不会抢走当前定位。

成功写入结果增加 `presentation`：`completed` 表示页面已确认；`pending` 携带 commandId，可通过 get_command 继续检查；`failed` 表示展示失败，数据仍已保存，不能因此重新执行添加操作；`skipped` 表示主动选择后台模式。

所有相关写工具可增加 `presentation: {"mode":"none"}` 关闭自动展示。多个应用窗口无法确定目标时，增加 `presentation: {"viewId":"实际窗口ID"}`。优先选择唯一获得焦点或可见的页面，不随意操作多个标签页。删除行程不会再打开已删除的行程。

```json
{
  "tripId": "trip_...",
  "expectedRevision": 3,
  "requestId": "唯一请求ID",
  "operations": [{"op":"add_stop","dayId":"day_...","candidateId":"candidate_..."}]
}
```

以上调用默认完成保存和展示。批量编辑仍然原子保存，通过一次提示与最后有效地点/日期聚焦展示结果，不模拟逐次点击。完整计划默认使用 apply_plan：一次提交由服务端逐步保存，每步等真实页面回执后继续，并推送进度；edit_itinerary 的原子批量能力继续用于局部修改。

页面实时通知之外，还会通过约每秒一次的版本心跳补偿漏掉的更新。应用与网页、MCP 客户端都需加载新版本；更新代码后重启本地服务、刷新网页，并在客户端重新加载 MCP 工具。浏览器是否允许窗口切到前台取决于系统行为。

## 推荐使用流程

当前客户端已暴露工具时直接调用下列短名；只有命名空间前缀不同时，按短名一次匹配并沿用。不回仓库重新找服务器、不重复 listTools、不重新安装。工具未接入时才按上文做一次客户端配置。精简参数表及完整的两地点独立调用示例见 [MCP 工具速查](../skills/travel-story-planner/references/mcp-quickstart.md)。

1. **一次 bootstrap**：`get_status({})` 返回 `url/search/views`，在线时复用；只有 SERVICE_UNAVAILABLE 才 ensure_service 并取状态。不为取地址重复启动，不在每个业务调用前预检。独立管理网页可用 `node scripts/service.mjs check` 或 `node scripts/service.mjs ensure`；MCP 客户端仍使用 mcp/start.mjs。
2. **实际打开浏览器**：内置浏览器 navigate(url) 后 snapshot 确认真实 UI，再按需 get_view_state 核验本次 viewId、ready 和新鲜心跳。无内置浏览器或本地访问受限时可降级系统浏览器，仍须验证。服务在线、connectedViews>0 不能替代页面门槛。
3. 首版日程无关键缺口时同轮录入展示；首次展示后的修改等本版确认。复用有效候选 ID，缺少时 search_places 并核验，传 viewId 在目标页面显示搜索浮层。
4. **完整计划走 apply_plan**：一次提交候选、日期、顺序和交通，服务端逐步保存并等待真实页面回执，推送进度，默认最后算路并开始播放。Agent 不必逐地点调用、每步截图或短间隔查询。
5. `get_plan_task({taskId,waitMs:20000})` 长轮询，running 才继续；失败先读 error/resumable；仅 resumable:true 才修复后同 requestId、相同计划恢复，可更换 viewId；resumable:false 先核验实际错误和数据，停止自动重试。不要另建任务、重建行程或重加已保存地点。
6. completed 后 get_trip 对照保存内容和路线质量，再做最终浏览器 snapshot；失败现场也需浏览器核验。旧工具用于局部修改及明确删除，保存与播放分别按真实回执报告。

## 旅行规划与录入展示 Skill

仓库内提供 [`skills/travel-story-planner/SKILL.md`](../skills/travel-story-planner/SKILL.md)，包含两部分：旅行规划，以及既定计划的 MCP 录入与播放。已有计划时直接进入第二部分，检查/必要时启动服务，匹配真实地点、保存日期顺序与交通、核验后再播放。MCP 本身也可独立使用。

将整个 `travel-story-planner` 文件夹（包括 `references/`）提供给支持 Skill 的 AI 客户端，按该客户端的加载方式接入。文件不依赖仓库绝对路径或其他外部 Skill；首次使用先检查/启动服务并检查搜索 Key，再实际打开内置浏览器确认渲染与连接，缺配置时引导用户自行申请并填入应用的 `.env.local`；文字攻略可独立继续，录入展示需要连接本项目 MCP 和可用搜索源。首版日程无关键缺口时必须同一轮执行展示，不能停在文字计划等待确认；之后的修改等用户确认本版再同步展示，用户明确只要文字或要求边改边展示时按其要求。get_status/ensure_service 可先检查和启动服务；行程写入前必须实际打开内置浏览器并核验 UI 渲染和本次页面 ready，完整计划交给 apply_plan 逐步展示，Agent 长轮询任务并在最后核验；后续通过 `presentation.viewId` / `viewId` 指向该页面，避免工具默认启动系统浏览器。客户端仍需具备联网能力才能核验天气和攻略；无权限/无法读取的资料必须如实说明。

本轮仅在仓库内维护，没有自动修改 Trae 等客户端配置。当前项目内可直接让能读文件的 Agent 使用：

> 请读取 skills/travel-story-planner/SKILL.md，按其中流程帮我规划旅行，先补充了解尚缺的用户信息。

已有计划可说：

> 请按 skills/travel-story-planner/SKILL.md 的第二部分，把上面已定的计划录入 Travel Story，服务没启动就先启动，填齐地点和交通后播放给我看。

Skill 文件夹已加入 npm 包文件清单及项目生成器。未来桌面安装包仍需单独提供 Skill 的导出/加载入口，不能仅将文件藏在应用内部就认为客户端能发现。

## 工具契约

精确输入校验位于 `mcp/tools.mjs`，可运行 `node scripts/export-mcp-schemas.mjs` 查看所有工具 JSON Schema（输出到 stdout，不写文件）。`?` 表示可选。

| 工具 | 输入 | 主要输出 |
| --- | --- | --- |
| ensure_service | 无 | status(running/started)、url、launched、pid?/logPath? |
| get_status | 无 | url、version、search、views、connectedViews、capabilities |
| list_trips | query?、limit?(1–100)、cursor? | trips 摘要、nextCursor |
| get_trip | tripId | trip、tripId、revision、url；不返回路线几何 |
| search_places | query、countryCode?(两位代码)、city?、language?、near?{latitude,longitude}、limit?(1–20)、viewId? | status、candidates、providerStatus、searchContext、expiresAt、contextHandling |
| get_weather | {latitude、longitude} 或 city?，startDate、endDate(单次≤16天) | location、timezone、days(逐日 label/low/high/effect、降水、风速)、source、attribution、cached；超范围截断附 note 或报 OUT_OF_FORECAST_RANGE |
| create_trip | name、startDate、endDate、origin?、region?、description?、requestId | tripId、revision、trip、url |
| update_trip | tripId、expectedRevision、patch、requestId | tripId、revision、trip、url |
| edit_itinerary | tripId、expectedRevision、operations(1–100)、requestId | tripId、revision、results、invalidatedSegmentIds、trip、url |
| delete_trip | tripId、expectedRevision、requestId | tripId、deleted、revision |
| calculate_routes | tripId、expectedRevision、segmentIds?(最多100)、requestId | tripId、revision、routes 摘要 |
| open_trip | tripId、viewId?、page?(plan/play)、dayId? 或 stopId? | url、commandId、status、error? |
| get_view_state | viewId? | views：页面、行程、ready、selection、mapState、playback、lastSeen |
| control_view | viewId、action、dayId?/stopId? | 命令回执：commandId、status、expiresAt 等 |
| get_command | commandId | 命令状态、错误；打开回执包含连接到的 viewId |
| apply_plan | requestId、viewId、trip、days、review(新任务必填)、tripId?、expectedRevision?、finish?(plan/play，默认play)、calculateRoutes?(默认true) | taskId、status、progress、resumable、tripId?/revision?/url?/error? |
| get_plan_task | taskId、waitMs?(0–20000，默认15000) | 同 apply_plan 的紧凑任务状态；可长轮询 |

所有时间为 Unix 毫秒，搜索候选 expiresAt 为 ISO 时间。日期为 YYYY-MM-DD，距离米、时长秒；坐标 WGS84。来源没有提供的字段会缺失。

### 完整计划任务

`apply_plan.trip` 为 `{name,startDate,endDate,origin?,region?,description?}`；`days` 为 `[{date,stops:[{candidateId?,stopId?,transportToNext?}]}]`。每个 stop 恰有 candidateId 或 stopId 之一；新建用已核验 candidateId，服务端开始前冻结候选快照。最多100地点、366天。按每日顺序扁平排列，所有非最后地点必须指定 transportToNext（含跨日衔接），最后地点不能有。

新任务必须提交 `review:{spatialNotes,days:[{date,availableMinutes,travelMinutes,visitMinutes,mealRestMinutes,bufferMinutes,basis}]}`。spatialNotes 说明区域组合与住宿/天气/预约等必要往返理由；basis 说明可用窗口、主要景区游览范围/时长来源、交通接驳和估算。逐日日期必须与输入 days 一一对应，四类用时之和不能超过 availableMinutes；分钟数为0–1440的整数，可用窗口至少1分钟。此校验只核对结构与算术，不认证来源、实际游览时长或路线最优性。

缺 review 为 PLAN_REVIEW_REQUIRED，字段/日期错误为 INVALID_PLAN_REVIEW，超时为 PLAN_TIME_EXCEEDED；均在新任务和行程写入前返回，可以用同一 requestId 修正计划重提。不能通过低层工具绕过。既有持久任务仍以原输入恢复，原本没有 review 的旧任务不补字段改变指纹。时间账不写成 trip/stop 新字段。完整参数见 [调用例](../skills/travel-story-planner/references/mcp-quickstart.md)。

协议版本为0.3.0。通过 stdio 调用 get_status 会额外返回 `compatibility`，根据网页的 planTasks/searchActivity/planReview 能力判定 compatible 或 restart_required。桥接层在首次写入前复用已知状态或检查一次，拒绝不兼容网页的写入及页面控制；远端 UNKNOWN_TOOL 会转为 SERVICE_VERSION_MISMATCH，并阻止后续低层写入。没有自动重试写请求，也不自动降级。重启更新后的网页服务、重连 MCP 并重新 get_status 后可恢复；ensure_service 只复用/启动，不升级旧进程。

已有 tripId 必须提供 expectedRevision，且列全原有 stopId；不能通过省略地点删除。明确授权删除先用低层工具执行，再 get_trip 读取版本。局部修改可直接使用旧工具。

任务状态为 running/completed/failed，progress 为 `{completed,total,label}`，error 为 `{code,message}`。每步写入及展示进度持久化，任务等待真实页面回执后才执行下一步，并推送进度活动。默认算路、导航和播放；finish:plan 停在规划页。任务 completed 不表示影片播完或导出。

已知 taskId 用 get_plan_task 长轮询。传输结果不明或 resumable 的失败任务沿用同 requestId、相同计划重调 apply_plan；恢复只允许换 viewId，不能改变计划或 expectedRevision。已保存步骤不会重做，已冻结候选无须重搜。resumable:false（包括冲突/不可恢复错误）先核验错误和已有数据，不机械重试。已完成任务再次用同 requestId 提交只返回原结果，不再次播放；重播用 open_trip/control_view 并核对回执。展示失败不应另造 requestId 新建行程。完整调用例见 [MCP 工具速查](../skills/travel-story-planner/references/mcp-quickstart.md)。

search_places 的 viewId 可选；提供时自动在目标页面显示全局搜索浮层，录入选择后标记。未提供 viewId 的旧后台调用仍兼容。

### 行程编辑操作

| op | 参数 |
| --- | --- |
| add_day | position?（从0开始，省略追加） |
| remove_day | dayId、stopHandling?(delete/move)、targetDayId?；有地点时必须明确处理 |
| add_stop | dayId、candidateId、position?、clientRef? |
| update_stop | stopId、candidateId?、patch?{name?,city?,country?} |
| remove_stop | stopId |
| move_stop | stopId、targetDayId、position |
| set_transport | fromStopId、toStopId、transport；起终点必须相邻 |
| set_weather | dayId、weather{label、low?、high?、effect?} 或 null（清除）；effect：sun/cloud/overcast/fog/drizzle/rain/heavy-rain/snow/heavy-snow/breeze/wind/storm |

同批后续操作可以用 clientRef 代替 stopId，批次任意一项失败整批不保存。MCP 不接受任意经纬度添加地点；必须先搜索。网页使用受校验的内部业务操作维护素材元数据。

交通枚举沿用原应用：car、bus、train、subway、plane、ship、kayak、motorcycle、bicycle、scooter、walk、horse、ufo、swim、rocket。可选择不代表有对应真实导航服务。

### 并发与重试

低层修改提供最新 expectedRevision；冲突时重新读取并判断意图是否仍适用，不盲目覆盖。requestId 应全局唯一；重试同一操作使用相同 ID 和参数。低层工具将最近最多1000次成功写请求的结果与数据一起持久化；超出保留窗口不能依赖去重保证，失败请求不占用成功记录。apply_plan 使用独立的持久任务进度恢复，遵循上文同 requestId、同计划和原 expectedRevision 规则。

日期范围包含首尾，最多366天。新建时生成全部日期。仅修改 startDate 整体平移日期；缩短范围如涉及有地点的日期则返回 DATE_CONFLICT。插入/删除天后日期连续重排，至少保留一天。

路线计算释放写锁等待服务返回，保存前再次校验版本。改坐标、起终点或交通方式会清除受影响路线。网页自动算路走同一业务服务。

### 路线质量

每条返回 requestedTransport、actualProfile、provider、geometryKind、quality、warnings，distance/duration 可能缺失。

- car：OSRM 驾车路网估算，非实时交通。
- 国内 walk/bicycle：高德对应路线，需要密钥；失败不替换成驾车结果。
- 国外 walk/bicycle、铁路等未接入的方式：unavailable，不返回虚构时长。
- 飞行/水上及对应趣味方式：schematic 示意连接，无真实班次或时长。

### 页面与回执

control_view 支持 show_day、focus_stop、fit_trip、play、restart、stop；播放动作限播放页。没有暂停/继续。

完整展示默认完成服务检查、真实浏览器 navigate/snapshot 和本次页面 ready 门槛，再 apply_plan；任务内部逐步等真实展示回执、算路并按 finish 播放，Agent 用 get_plan_task 长轮询，完成后 get_trip 与最终快照核验。局部操作保留 open_trip/get_command/control_view：导航到播放页并确认 ready 后发送 play，再查真实开始回执。至少两个地点才能播放；一个地点核验地图。路线不可用时保留交通并说明，不伪造时长。

普通页面命令：queued → running → completed/failed，30秒过期。completed 来自页面回执；播放命令完成表示开始播放，不表示整条影片播放结束。切换页面会终止旧页面的操作；应用级导航跨路由保留。窗口断开或租约过期后不会重放旧命令。

open_trip 优先在现有窗口内导航，最长120秒，等目标行程、地图和请求的选择就绪后才确认完成。没有连接窗口时，通过系统启动并携带唯一 launch ID，等待匹配窗口连接。同目标的并发启动会合并；启动过程中请求其他目标返回 APP_STARTING。浏览器置前只能尽力请求，不能保证成功。默认进入播放页不自动播放，随后可发 play 命令。

页面心跳约1秒，租约30秒。数据变动使用 SSE 通知，重连重新读取服务端。行程变化时正在播放的旧版本停止并提示重新播放。

## 桌面应用衔接

根布局持有唯一窗口连接，业务页面仅注册当前操作和状态。浏览器与未来桌面壳共用内部路由；`AppHost` 单独负责窗口置前。后续桌面预加载桥可提供 `window.travelStoryHost.revealWindow()`，复用 MCP 与页面操作协议。当前未制作安装器，也未实现 Electron/Tauri 的进程启动与单实例管理。

## 数据迁移与限制

首次读取旧文件先验证，再备份为 `data/trips.v1-backup.json`，保留行程、素材关联及交通选择，补齐日期；旧路线缺少可靠来源信息，会清空并重新计算。损坏或未知版本数据拒绝写入，不当成空库。

浏览器独有的旧 localStorage 数据不自动覆盖服务端。原始浏览器数据先保留在 `travel-story:legacy-backup`，即使服务端已有行程也不会抹掉未导入的数据，并可从页面导出备份。只有服务端从未初始化且为空时，页面显示明确的导入按钮。删除完全部行程后不会自动重新导入或生成示例。

同一个数据目录只运行一个应用服务进程；MCP 进程均连接该服务，不能分别直接写文件。暂未支持多进程部署、账号、远程访问、自动视频导出和安装器。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

隔离构建可设置 `TRAVEL_STORY_DIST_DIR=.next-verify`，避免覆盖正在运行的开发服务产物。`scripts/smoke-mcp.mjs` 仅允许 `/tmp/travel-story-mcp.*` 临时数据目录，验证真实 stdio 客户端与本地服务；不要把它连接到真实资料库。

服务生命周期真实联调：`scripts/smoke-service.mjs` 仅用于 `/tmp/travel-story-mcp.*` 临时数据和专用端口，要求该端口初始无服务；会经 stdio 启动应用、核验复用，最后停止本次测试创建的进程。

若行程已保存但没有页面，先检查服务并打开内置浏览器、核验目标 viewId，再用 open_trip 在该页面展示已保存行程；不要重复创建或重录。服务 running、页面 UI 已渲染、桥已连接且 ready、展示回执完成是不同状态，逐项核验，失败时明确停在哪一步。
