# Changelog

本文件记录各正式版本的变更。Release 发布时由 release.yml 自动提取对应 tag 的段落作为 Release 说明。

## v0.8.2 — 2026-09-18

### 新增

- 内容生成页产品导览：聚光遮罩六步走查（任务架构 / 提示词 / 基础与高级设置 / 运行 / 功能模块 / 队列历史），ComfyUI 就绪后首次进入自动触发一次，页面标题旁 `?` 图标可随时重放
- 插件操作改为阻塞式执行弹窗：安装 / 卸载 / 更新 / 开关 / Git 安装统一为确认后阻塞等待 ComfyUI-Manager 队列完成，SSE 与轮询双信号收尾并给出成功 / 失败 / 超时三态，成功后按待重启 diff 提示重启
- CivitAI 搜索与下载强制要求 API Key：未配置时后端搜索代理、模型详情与下载入口直接返回 403 不做匿名降级，模型页呈引导空态并屏蔽请求，新增 CivitAI 设置弹窗承载 key 与 NSFW 浏览级别
- 公共隧道停机回收自愈：restore 先向后端校验隧道存活，已失效或无法确认时复用旧子域名自动重新注册

### 重构

- 设置域回迁各功能页：LLM / 提示词 / CivitAI 配置就近迁入内容生成页与模型页弹窗，设置页精简为面板与关于单页；新增 `useModalCloseGuard` 统一 SSH / 同步 / 隧道设置弹窗的未保存关闭确认
- 前端开启 TypeScript 严格检查（`noUncheckedIndexedAccess` / `noImplicitOverride` / `noFallthroughCasesInSwitch` / `noUnusedLocals` / `noUnusedParameters`）并收敛类型
- 统一未知异常的错误信息提取（`utils/errorMessage.ts`），各 composable 与组件将 `e: any` 收敛为 unknown
- 模型已下载状态收敛到下载按钮，移除卡片与版本列表/收藏列表的已下载 badge

### 修复

- 插件页确认弹窗与操作收尾体验修正：确认标题统一「插件变更」，列表加载请求改静默消除重启窗口期的重复连接错误 toast，ComfyUI-Manager 自身行移除启用 / 禁用 / 卸载按钮
- 内容生成页 token 芯片编辑态占位与删除按钮悬停显示修正
- 纯图标按钮补齐 hover 提示：`BaseButton` icon-only 缺省取 aria-label，弹窗 / 抽屉 / 下拉等原生图标按钮同步补 title

### 变更

- 移除插件 `update_all` 端点，操作响应文案统一为 submitted
- 移除设置页分区导航、scrollspy 与模块级保存，移除 `useUnsavedGuard` / `useSettingsGuard` / `UnsavedBanner`

## v0.8.1 — 2026-09-16

### 新增

- 同步任务队列：所有同步任务经常驻执行员顺序执行，手动执行忙时自动排队（不再报错拒绝），排队任务可取消、执行中的任务可中断；任务列表按「执行中 / 排队 / 已结束」分层排序并显示排队数，面板重启后自动把残留任务标记为中断
- 存储绑定同步文件夹：连接云存储时选择存储内目录，预设规则远程路径 = 存储桶 + 同步文件夹 + 预设相对路径；同步规则预设改为按场景分组的六组多子规则模板（下载模型 / 下载工作流与素材 / 备份模型 / 备份工作流与素材 / 上传输出移动与保留本地），向导勾选预设、部署时展开为具体规则，规则名创建时以当前语言固化落库
- 同步页新增规则编辑弹窗（新增 / 编辑统一表单），本地路径与远程路径拼接在前端预检（与后端同一语义）；规则远程路径必填，不再允许空路径同步到远端根
- 隧道切换即刷新：公网隧道切换由后端蓝绿编排、新旧 cloudflared 短暂并存，前端全页冻结遮罩并探测新旧地址自动跳转，切换期间任务不丢请求不白屏；自定义模式子域名必填，cloudflared 进程名与 metrics 端口收敛为运行时配置

### 修复

- 服务卡片呼吸动画、执行状态重连时重置，同步页乱序响应保护，Jupyter token 支持强制刷新跳缓存
- 环境变量注入的 rclone 密码字段先转为 obscure 密文（rclone 环境变量形态要求密文，明文会报错）；OAuth 存储目录浏览合并所选驱动器参数，不再固定浏览默认主盘

### 变更

- 移除 Companion 客户端任务回报接口与规则摘要上报，面板仅保留连接与同步状态展示；同步 worker 重启不再打断执行中任务与排队任务

## v0.8.0 — 2026-09-12

### 新增

- 云同步网盘 OAuth 授权向导：面板内代跑 `rclone authorize` 并截获回调地址，用户粘贴回调 URL 完成 token 交换（token 不回传前端），Google Drive 支持自建 client_id/secret；新增云盘目录列取与远程目录创建接口
- 云存储连接共享组件（授权 / 添加流程 / 路径浏览）复用于存储管理页与安装向导 step3-4，存储管理改为弹窗式添加与重连；安装向导凭据内存草稿与部署计划提交，staged rclone 试连失败自动回滚新建 remote
- 同步记录服务端分页与执行规则快照：`sync_jobs` 新增 `rules_json`，规则编辑/删除后历史仍可回看；新增任务详情弹窗（结果 / 规则快照 / 文件清单 / 增量事件流）
- 同步客户端页 Hero 拆分为在线数与公网地址两个维度，新增 `POST /api/sync/worker/restart`
- SSH 密码跟随：开启后改密自动同步，无公钥关闭需确认放行；CivitAI NSFW 浏览级别（bitmask 1-31）与封面模糊遮罩，纳入配置导入导出
- 服务页公共组件 ServiceHero / ListPagination / ListRow / BaseButton iconOnly；ComfyUI 参数迁入分组弹窗（四组 + 已修改项计数 + 未保存守卫）与版本切换独立弹窗；GPU 监控补齐 SM 时钟 / 风扇转速 / 温度上限原生读数
- 接入 13 个第三方品牌图标（官方/高保真 SVG），侧栏、服务卡、服务页 Hero、页签与关于页改品牌 mark，存储 logo 迁移彩色 SVG
- 登录页迁移为 Vue 独立入口，本地模型来源行改为可点击外链；Hugging Face 白名单 247 条描述补齐中英双语

### 重构

- 设置页重构为四分区单页（面板 / 生成与模型 / 连接与同步 / 关于）：吸顶 TabSwitcher + scrollspy，L2 模块独立保存，「N 处未保存」跳转首个未保存模块；SSH 连接与公钥管理迁入设置，隧道/云同步设置回迁页内弹窗
- 总览与 ComfyUI / Jupyter / SSH / 隧道 / 云同步五页统一为单列布局 + 状态机 Hero + ListRow 对象行，列表、分区间距、颜色变量、按钮层级与字号规范全局对齐；五页日志统一折叠标题，云同步默认收起
- 图标体系收口 `MsIcon`：`icons.txt` 成为字体子集唯一来源，生成 `IconName` 联合类型并接入构建期校验，修正跨页语义错位与 `movie` 字形缺失，纯图标按钮补齐 aria-label/title
- 确认弹窗统一「标题 + 后果说明 + 按钮」结构（49 处），危险操作默认聚焦取消键；执行终态通知收敛为应用级单一出口并按 prompt_id 幂等去重，轮询/自动刷新改静默
- i18n 清理死键与重复键 197 条，术语与中英体例统一，补齐后端缺失文案；产品日志去 emoji，成功行改用 success 级别透出
- 清理死代码与旧实现：StatCard、OAuthWizard、SettingsDomainTunnel/Sync、SyncActivityTab 等

### 修复

- 同步记录兼容旧库：`sync_jobs` 缺 `rules_json` 列或数组字段损坏时不再渲染崩溃
- 隧道启动/重启失败如实上报（不再返回 ok:true），公共模式用持久化 token 重建 cloudflared；公共 API 响应解析与请求异常分离，非 JSON 响应携带状态码与原文
- 执行终态与辅助任务（预处理/打标）通知重复、误报修复，ComfyUI 页不再把打标完成误报为生成完成；ComfyUI 状态补队列运行/等待数，不再恒为 0
- 修复 15 处双错误 toast（useApiFetch 已提示 + 调用点 fallback）与 3 处失败仍提示成功（生成中断 / 重启面板 / 停止后台运行）
- 修复确认弹窗同一 tick 打开时状态重置失效、SectionHeader 键盘事件冒泡误触折叠
- 修复非 OAuth 存储动态下拉未注册、Dashboard 诊断加载圈被 scoped 隔离不可见、公共子域名变更未重新注册

### 变更

- 移除 `/api/sync/rclone_config` GET/POST 端点，rclone 配置不再支持直接编辑，统一走存储管理流程
- 设置页由路由子 tab 改为四分区单页；`/login` 接口改为 POST JSON 配合 Vue 独立入口
- 同步客户端 `davUrl` 改名为 `hostUrl`，仅识别 dashboard/comfycarry 两个 key，不再猜测其它服务子域名

## v0.7.1 — 2026-09-06

### 新增

- 模型类别 badge 单一事实源：`normalizeModelCategory` / `modelCategoryColor` / `modelCategoryLabel` 统一本地索引、Civitai、HF 白名单、下载任务四条数据管线的 type 归一与文案，迁移 5 个组件移除各自映射表，修复部分类别 badge 无色全灰
- 下载量紧凑格式化 `fmtCompact`（56.8k / 1.2M），Civitai 卡片 meta 行启用
- 页面工具栏吸顶：新增 PageTopStack 组件，Models / ComfyUI 页各 tab 的 SectionToolbar（含未保存提示条）通过 Teleport 挂到顶部栈随页面吸顶

### 重构

- 全局产物 / 素材卡统一 3:4 竖版比例（Dashboard 画廊、历史面板、批量预览、LoRA 卡、模型选择器、模型卡），网格列宽收窄保证一屏至少两行，Civitai 缩略图升级 width=550 适配竖版高度
- 字体栈规范化：移除 Google Fonts 外链依赖，全局 font-family 改为西文优先 + 系统原生无衬线回退；新增 `--font-tabular` 变量修复等宽混排时汉字错误回退为宋体衬线
- 简化诊断 / 历史入口标题文案

### 修复

- 页面切换 transform 入场动画引发的吸顶首帧渲染丢失与文档级假滚动条（page-fade 改 opacity-only；DropdownMenu 弃用 `:global()` 规避 compiler-sfc 丢弃后续选择器）
- Release 说明改用 CHANGELOG.md 自动提取（v0.7.0 起），缺失对应段落则发布失败

## v0.7.0 — 2026-08-30

### 新增

- 侧边栏按功能分组导航（工作区 / 服务 / 连接 / 系统），下拉菜单重构为悬浮级联子菜单，支持键盘导航与移动端视图切换
- 移动端双层布局：汉堡菜单内嵌标题栏，TabSwitcher 双行吸顶，未保存提示条吸附位置随双行高度校准
- 队列 / 历史抽屉支持 `?panel=` 深链直开
- 服务跳转地址离线检测与端口兜底（`/api/overview` 与 `/api/comfyui/status` 返回实际端口）
- Release 分发机制：tag push 自动构建并发布完整部署包 `comfycarry-dist.tar.gz`，bootstrap 与面板内置更新统一以 latest Release 为更新源

### 重构

- 移除全局固定顶栏，标题与操作下放至各页面首行并吸顶；桌面 / 移动端布局统一
- Dashboard 拆分为 Hero / Tasks / Services / Gallery / Diagnostics 五个子组件，画廊接入生成队列 store，消除私有请求
- 控件高度基准统一（34px / 28px），SegmentedControl 接入滑动指示器，全局 200ms 过渡动效
- 主题规范化：硬编码颜色改为设计变量与 color-mix，登录页浅色主题 Modern Neutral 化
- UsageBar 统一品牌主色，移除孤儿组件 ProgressBar
- 热更新改为逐项 staged 交换（备份 - 落位 - 回滚），更新中断不再留下半新半旧状态

### 修复

- 提示词设置在组件重建后误报未保存（dirty 快照移至模块级）
- 移动端未保存提示条吸顶时与标签行重叠
- Dashboard 画廊在新增产物时整行卡片重建、服务总数异常时回退为固定值、服务运行时长时钟偏差时显示负数、离开页面后延迟任务仍触发请求
- 下拉菜单鼠标与键盘混合操作时，刚展开的子菜单被悬挂的关闭倒计时误关
- 热更新下载失败残留临时文件；bootstrap 版本记录的 commit 写入分支名而非真实 SHA
- 更新检查改为语义化版本比对，与 tag 发布机制对齐

### 变更

- 图像任务默认架构由 SDXL 切换为 SD 1.5
- main 分支 push 不再触发任何发布，commit 与 Release 完全解耦
