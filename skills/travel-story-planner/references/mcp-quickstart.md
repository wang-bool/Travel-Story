# MCP 工具速查与两地点调用例

直接用当前客户端已暴露工具，命名空间只匹配一次。以当前 schema 为准，不重复发现/安装；前置、回执和恢复规则见 [执行参考](mcp-execution.md)。首版同轮展示，后续修改等本版确认。

下列名称是 **MCP 工具名，不是 HTTP 路径**。完整计划用 apply_plan，内部自动创建行程；不需要先调用 create_trip。不读取 app/api/**/route.ts、不自行请求 Travel Story HTTP API 或写数据库。找不到工具时处理 MCP 连接/版本问题，不切换到源码调查。

## 工具速查

| 工具 | 输入要点 | 使用的返回值 |
| --- | --- | --- |
| get_status | `{}`，本轮 bootstrap 一次 | `url/search/views/capabilities/compatibility`；compatible 才继续，旧心跳不能代替新页面 ready |
| ensure_service | `{}`，仅服务不可用时 | `status/url`，启动后取状态 |
| get_view_state | `{viewId?}`，需刷新页面连接信息时 | `views[].viewId/ready/page/lastSeen` |
| get_weather | `{latitude,longitude}` 或 `{city}` + `{startDate,endDate}`（≤16天） | 逐日 `days[].label/low/high/effect`（可直接喂 set_weather）、降水、风速；超范围截断或报 OUT_OF_FORECAST_RANGE |
| search_places | `{query,countryCode?,city?,language?,near?,limit?,viewId?}` | 已核验的 `candidates[].candidateId` 和 `expiresAt`，复用有效候选 |
| apply_plan | `{requestId,viewId,trip,days,review,tripId?,expectedRevision?,finish?,calculateRoutes?}`，新任务必填 review | `taskId/status/progress/resumable/tripId?/revision?/url?/error?` |
| get_plan_task | `{taskId,waitMs?:0..20000}`，默认15000 | 同上；running 时继续长轮询 |
| list_trips/get_trip | `{query?,limit?,cursor?}` / `{tripId}` | 目标 ID、最新 revision、保存内容 |
| create_trip | `{requestId,name,startDate,endDate,origin?,region?,description?,presentation:{viewId}}`，仅单独创建空行程时使用 | `tripId/revision/trip/url/presentation`；自动生成日期范围内全部天 |
| update_trip | `{tripId,expectedRevision,requestId,patch:{name?,startDate?,endDate?,origin?,region?,description?},presentation:{viewId}}` | 新 revision 和 presentation；仅局部元数据修改 |
| edit_itinerary | `{tripId,expectedRevision,requestId,presentation:{viewId},operations}` | 局部修改的新 revision 和 presentation；`op` 含 add_day/remove_day/add_stop/update_stop/remove_stop/move_stop/set_transport/**set_weather**（`{dayId, weather:{label,low?,high?,effect?}}`，写入当日天气，effect：sun/cloud/overcast/fog/drizzle/rain/heavy-rain/snow/heavy-snow/breeze/wind/storm；weather 为 null 时清除） |
| calculate_routes | `{tripId,expectedRevision,requestId,presentation:{viewId},segmentIds?}` | 路线质量、警告及 presentation |
| open_trip/control_view | `{tripId,page,viewId}` / `{viewId,action}` | commandId，低层展示用 get_command 等回执 |

## 完整顺序例：杭州一天，两地点，步行

仅示例日期 **2026-11-06** 与“西湖断桥 → 平湖秋月，步行”。实际使用用户已定日期和计划。`<…>` 必须换成真实返回值；requestId 为本次唯一值，同计划恢复沿用原值。

1. `get_status({})` 取得 `url/search/views`，确认 compatibility.status=compatible 与 capabilities.planTasks/searchActivity/planReview=true。restart_required、SERVICE_VERSION_MISMATCH 或 UNKNOWN_TOOL 时停止写入，重启更新后的网页并重连；不退回低层写入或浏览器表单。仅 SERVICE_UNAVAILABLE 时 ensure_service 后取状态。核验所需搜索源，不为取 URL 再启动一次。
2. **实际浏览器 navigate(url) → snapshot**，确认 UI 已渲染；必要时 `get_view_state({})` 更新本次连接，记录 ready 且有新鲜心跳的 `<viewId>`。之后保持页面打开。views 为空、目标页缺失或 ready:false 都禁止 apply_plan。
3. 无有效候选时分别调用以下搜索；已有本会话核验且未过期的 candidateId 则跳过相应搜索。页面浮层自动显示结果。

```json
{"query":"西湖断桥","countryCode":"CN","city":"杭州","limit":5,"viewId":"<viewId>"}
```

```json
{"query":"平湖秋月","countryCode":"CN","city":"杭州","limit":5,"viewId":"<viewId>"}
```

核验名称、地址和位置，记录 `<candidateA>`、`<candidateB>`，不默认选第一项。

4. 先完成区域、游览范围/时长、时间与体力检查，再调用 **apply_plan** 一次，不另行 create_trip 或逐点 edit_itinerary。下面 review 仅演示结构与加法，数值不是实际杭州旅行依据，执行时全部替换为本次已研究的预算与真实来源说明：

```json
{
  "requestId": "<uniquePlanRequest>",
  "viewId": "<viewId>",
  "trip": {
    "name": "杭州一日游",
    "startDate": "2026-11-06",
    "endDate": "2026-11-06",
    "region": "杭州"
  },
  "days": [{
    "date": "2026-11-06",
    "stops": [
      {"candidateId":"<candidateA>","transportToNext":"walk"},
      {"candidateId":"<candidateB>"}
    ]
  }],
  "review": {
    "spatialNotes": "示例：两地点按同区域组合，无固定住宿或预约造成的往返；执行时根据实际位置核验。",
    "days": [{
      "date": "2026-11-06",
      "availableMinutes": 480,
      "travelMinutes": 60,
      "visitMinutes": 180,
      "mealRestMinutes": 90,
      "bufferMinutes": 60,
      "basis": "仅示例：窗口09:00–17:00，两处地点游览范围与时长、交通来源需实际核验；这些分钟数不是旅行建议。"
    }]
  },
  "finish": "play",
  "calculateRoutes": true
}
```

服务端冻结候选，逐步创建/录入/设置交通并等每次真实页面回执，最后算路、切播放页并开始。Agent 不在每个内部步骤截图、查 get_command 或反复查服务。

review.days 与提交 days 日期一一对应。四类用时合计不得超过 availableMinutes；basis 写清窗口边界、主要景点范围/时长来源、接驳与估算。空间合理性和来源可靠性仍由 Agent 判断，不能修改数字凑过检查。PLAN_REVIEW_REQUIRED/INVALID_PLAN_REVIEW/PLAN_TIME_EXCEEDED 在创建任务前返回时，修正原计划重提，不绕过；旧持久任务按原参数恢复。

5. 返回 running 时调用 **get_plan_task**：

```json
{"taskId":"<第4步返回的taskId>","waitMs":20000}
```

仍 running 才继续长轮询；只保留一个等待。failed 时先读 error/resumable；仅 resumable:true 才在修复页面或实际阻塞后，以**同一 requestId、相同计划**重调 apply_plan；恢复可换 viewId，其余内容不变。resumable:false（含版本冲突）时停止自动重试，先读取错误和实际数据。不要新建请求、重复创建行程或重搜任务已冻结候选。

6. completed 后 `get_trip({"tripId":"<任务返回的tripId>"})` 核验日期、两地点顺序和 walk，读路线质量/警告，再做最终浏览器 snapshot。按真实回执报告已开始播放；这不表示影片已播完或导出。只有一个地点时核验地图，不凑第二个点。同 requestId 再次提交 completed 任务仅返回原结果，不会再播放；需要重播用 open_trip/control_view 及真实回执。

## 已有行程与局部修改

完整计划应用到已有行程须带 `tripId` 和最新 `expectedRevision`；days 必须列全原有 stopId，新增点用 candidateId，每个 stop 二选一。扁平排列所有非最后点必须有 transportToNext（含跨日），最后点不能有。最多100地点、366天。不能省略原点来删除；明确授权删除先用低层工具，再读取新版本。

局部更改继续用旧工具。`add_stop` 是 edit_itinerary 内 `op`，参数 dayId/candidateId/position?；`set_transport` 参数 fromStopId/toStopId/transport，起终点须相邻，不存在 edit_transport。常用 transport：walk/car/bus/subway/train/plane/ship/bicycle。保存后按 presentation 确认展示，pending 才有限查询 get_command，failed 先核验保存结果再恢复展示，不重复添加。

仅当用户单独要一个空行程时，直接调用 MCP **create_trip**（已满足浏览器门槛），不套用完整计划的 apply_plan：

```json
{"requestId":"<uniqueCreateRequest>","name":"杭州一日游","startDate":"2026-11-06","endDate":"2026-11-06","region":"杭州","presentation":{"viewId":"<viewId>"}}
```

已有行程只改名称时，直接调用 MCP **update_trip**：

```json
{"tripId":"<tripId>","expectedRevision":1,"requestId":"<uniqueUpdateRequest>","patch":{"name":"调整后的行程名称"},"presentation":{"viewId":"<viewId>"}}
```

以上日期、名称、revision 和尖括号占位符均需换成本次真实值；revision 从 get_trip 的最新结果读取，不固定为1。
