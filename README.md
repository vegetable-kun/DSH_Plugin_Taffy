# taffy-mood — DeepSeek Harness 表情包状态机插件

把 Taffy 表情包挂在 DeepSeek Harness Web UI 右下角，随 agent 状态自动切换：待审批、思考中、干活中、出错、被打断……全部有专属表情。

![taffy](assets/taffy-fork.gif)

## 效果预览

| 状态 | 表情 | 触发条件 |
|---|---|---|
| 闲置 | `taffy2-idling` | 兜底默认 |
| 输入中 | `taffy-se_xy` | 输入框有草稿（官方 composer dock props 检测）|
| 思考中 | `taffy-dumb` | 模型流式输出中（2s 内有 assistant/chunk）|
| 工具执行中 | `taffy-tang-laughing` | tool/call 与 tool/result 计数 > 0 |
| 待审批 | `taffy-fork` | approval/asked，带脉冲动画 |
| 已批准！ | `taffy-spread_heart` | 同意后 3 秒 |
| 黑客 | `taffy-hacker` | 批准后的工作期间，对话完成即结束 |
| 审批被拒 | `taffy-embarrassing` | 拒绝后持续，直到开始打字被"消费" |
| 用户中止 | `taffy-angry` | turn/end reason=aborted，5 秒 |
| 出错/截断 | `taffy-suicide` | turn/end reason=error/max-tokens，5 秒 |
| 插话收到！ | `taffy-suprised` | 模型正在输出/干活时收到新消息，4 秒 |
| 被阻塞了… | `taffy-cry` | turn/end reason=blocked，6 秒 |
| 求饶 | `taffy-begging` | 60 秒内第二次审批请求，5 秒 |
| 得意 | `taffy-admirable` | 一轮用 ≥5 次工具后正常完成，4 秒 |
| 假哭 | `taffy-fake_crying` | 连续两次拒绝审批，5 秒 |

优先级链：锁定 > 待审批 > 批准庆祝 > 惊讶 > 哭 > 中止/出错/假哭闪帧 > 得意 > 运行中(黑客/思考/工具) > 打字 > 闲置。

## 安装

1. **放置素材**：把 [`assets/`](assets/) 里插件用到的 15 张 GIF 复制到 Harness 所在机器的 `~/taffy-gif/`：

   ```sh
   mkdir -p ~/taffy-gif
   cp assets/*.gif ~/taffy-gif/
   ```

2. **创建动态插件**：在 DSH Web UI 的对话里让 agent 用 `cordis_define` 创建插件——
   - `code.host` 粘贴 [`plugin/host.js`](plugin/host.js) 文件内容（去掉首行注释）
   - `code.client` 粘贴 [`plugin/client.js`](plugin/client.js) 文件内容（去掉首行注释）
3. **激活**：`cordis_run` 后首次会在浏览器请求 Client 授权，点允许即可。

## 使用

- 右下角表情随状态自动切换；**左键拖动**移动位置；**中键点击**打开浮动控制台
- 控制台：实时状态徽章 / 锁定任意表情（调试用）/ 测试审批 / 重置位置
- 设置面板 → 「Taffy 表情」页：启用开关、大小（50–1000px）、不透明度、鼠标穿透
- 所有外观设置**自动持久化**到 `~/taffy-gif/taffy-config.json`，刷新页面不丢

## 技术要点

- 纯动态 Cordis Plugin（Host + Client 双半边），无构建步骤，plain JavaScript + `React.createElement`
- Host 通过 `session/event` 日志审计事件驱动状态机（`approval/*`、`tool/*`、`turn/end`、`assistant/chunk`、`user/message`）
- 运行检测直接扫描 agents 注册表（事件计数会漏掉激活前已 running 的 agent）
- GIF 经 Host `webServer.register` 白名单路由提供（`/taffy-gif/<name>.gif`），内存缓存
- 插话判定用"工具执行或 2.5 秒内有 chunk"，避免新轮次启动的时序误报
- 打字检测用官方 `conversation.composer.dock` InputZone 的 `props.input.draft`，非键盘监听

> 注意：动态插件是进程内的临时对象，DSH 重启后需重新 define/run；素材与配置文件在磁盘上不受影响。

## 目录结构

```
assets/            全部素材（15 张插件用 GIF + 8 张静态 JPG 备用）
plugin/host.js     Host 半边源码（粘进 cordis_define 的 code.host）
plugin/client.js   Client 半边源码（粘进 cordis_define 的 code.client）
```
喜欢就留个小小的star吧
![taffy](assets/taffy-underwear.jpg)
