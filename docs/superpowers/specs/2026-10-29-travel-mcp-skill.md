# Skill 第二部分：已有计划录入与播放

## 已实现范围

入口 skills/travel-story-planner/SKILL.md 按任务路由：制定攻略使用第一部分，已有计划且要求录入/展示/播放时按需读取 references/mcp-execution.md，不重新做旅行访谈。

第二部分提取实际日期、每日地点顺序、出发/到达点和交通；检查服务，必要时调用 ensure_service；核验中文/英文/当地名候选；创建或明确修改目标行程；保存地点与相邻路段交通、计算路线、get_trip复核；最后导航到播放页，等待导航回执和窗口ready，再发play并确认开始回执。

播放复用现有 open_trip + get_command + get_view_state + control_view(play)，没有重复增加另一个播放引擎或视频导出。新增 ensure_service 后工具总数14个。景点介绍、时间块、餐饮/休息建议留在文字计划或行程说明，不编造不存在的结构化字段。

## 本地服务生命周期

mcp/serviceLifecycle.mjs 由 stdio 入口调用，因此HTTP应用离线时仍能启动。验证本地健康标识、相同数据目录令牌及认证get_status后复用；否则在无其他服务占端口时运行固定项目内的Next。已有生产构建用start，没有则dev；不安装依赖，不接收自定义命令，不杀进程，不更换端口。日志保存在配置数据目录service.log，子进程日志不进入协议stdout。

同一桥进程内启动调用合并，45秒内等待就绪；超时保留存活子进程，再次调用继续检查，避免重复启动。已退出的历史子进程可在单次ensure中恢复；不把竞争启动失败的PID当作有效服务PID报告。已有服务检查返回running/launched=false，本次成功启动返回started/launched=true。

## 场景验证

无第二部分时独立Agent读取原Skill，在“已有计划直接录入播放”的场景拒绝任何应用操作，准确指出旧Skill仅允许规划。这是本次增加任务路由和执行流程所需的基线差距。

加载第二部分后的独立模拟：服务离线→ensure_service→搜索地点→按返回dayId添加两地点并设walk→显示失败不重写→国外步行路线不可用如实保留→get_trip核验→等待导航与目标播放页ready→play→收到completed后才声称开始。对同名跨国歧义先询问，对未实际发生的expired回执不冒充已发生；真实expired时不声称成功。

模拟还发现参考未明确列搜索query键；已增加与现有schema一致的例子，并对示例JSON进行真实输入schema验证。

## 自动与真实联调

- npm test：102项通过，0失败，其中17项服务生命周期测试。
- npm run typecheck：通过；TRAVEL_STORY_DIST_DIR=.next-verify npm run build：通过。
- Skill quick_validate、相对链接校验、示例JSON契约校验、npm dry-run分发清单检查通过。
- 独立代码审查发现重复报告启动状态、失败竞争PID、服务退出后需两次ensure恢复等问题，均已补回归并修复；复审无新重要问题。
- scripts/smoke-service.mjs：真实stdio在应用离线时连接、ensure_service启动认证服务，再次调用复用；测试结束只停止本次拥有的服务进程。
- scripts/smoke-mcp.mjs：真实SDK发现14工具，录入与网页共享、交通保存、不支持路线如实反馈、旧写接口禁用及令牌校验通过。
- scripts/smoke-browser.mjs：真实Chrome/WebGL，模拟地图瓦片与搜索/路线源，临时数据；同窗口导航、MCP添加地点高亮、实际播放开始/停止、镜头保留、SSE缺失心跳补偿、WebGL重试通过。

首次播放联调在导航completed后立即调用play，注册表心跳尚未报告ready，返回VIEW_NOT_READY；测试流程已改为与Skill一致，先显式等待get_view_state目标播放页ready再play，复测通过。导航完成与状态心跳不是同一响应，不将暂时未就绪当作保存失败。

未安装到用户AI客户端、未修改真实行程库、未制作桌面安装器、未提交或发布。测试服务均使用隔离数据与专用端口。
