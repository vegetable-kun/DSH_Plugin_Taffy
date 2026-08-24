# taffy-mood — DeepSeek Harness 表情包状态机插件

这是一个 dsh 的插件，把 Taffy 表情包挂在 DeepSeek Harness Web UI 右下角，随 agent 状态自动切换：待审批、思考中、干活中、出错、被打断……全部有专属表情。标准 DSH 插件包（bundle + web client），素材随包分发，一条命令安装。

![taffy](assets/taffy-fork.gif)

## 安装

```sh
dsh plugin --profile web add github:vegetable-kun/deepseek-harness-plugin
```

然后重启 `dsh web` 即生效。安装器会自动把包加进 profile 的 bundles 层列表，无需手动编辑任何配置。

## 效果预览

| 状态 | 表情 | 触发条件 |
|---|---|---|
| 闲置 | `taffy2-idling` | 兜底默认 |
| 输入中 | `taffy-se_xy` | 输入框有草稿 |
| 思考中 | `taffy-dumb` | 模型流式输出中 |
| 工具执行中 | `taffy-tang-laughing` | tool/call 活跃 |
| 待审批 | `taffy-fork` | approval 请求弹出，带脉冲动画 |
| 已批准！ | `taffy-spread_heart` | 同意后 3 秒 |
| 黑客 | `taffy-hacker` | 批准后的工作期间，对话完成即结束 |
| 审批被拒 | `taffy-embarrassing` | 拒绝后持续，直到开始打字被"消费" |
| 用户中止 | `taffy-angry` | turn/end reason=aborted，5 秒 |
| 出错/截断 | `taffy-suicide` | turn/end reason=error/max-tokens，5 秒 |
| 插话收到！ | `taffy-suprised` | 模型正在输出/干活时收到新消息，4 秒 |
| 被阻塞了… | `taffy-cry` | turn/end reason=blocked，6 秒 |
| 得意 | `taffy-admirable` | 一轮用 ≥5 次工具后正常完成，4 秒 |
| 假哭 | `taffy-fake_crying` | 连续两次拒绝审批，5 秒 |

优先级链：锁定 > 待审批 > 批准庆祝 > 惊讶 > 哭 > 中止/出错/假哭闪帧 > 得意 > 运行中(黑客/思考/工具) > 打字 > 闲置。

## 使用

- **左键拖动**移动位置；**中键点击**打开浮动控制台；右键兜底
- 控制台：实时状态徽章 / 锁定任意表情（调试用）/ 测试审批 / 重置位置
- 设置面板 → 「Taffy 表情」页：启用开关、大小（50–1000px）、不透明度、鼠标穿透
- 外观设置保存在浏览器 localStorage（键 `dsh-taffy-mood/settings`），刷新不丢

## 卸载 / 停用

```sh
dsh plugin --profile web remove dsh-taffy-mood   # 从 profile 移除
# 或在设置页关闭「启用表情」临时隐藏
```

## 结构与技术要点

```
package.json       dsh.bundle.patch + dsh.client.platform: "web"
cordis.patch.yml   - insert: dsh-taffy-mood
host.js            Host 半边：session/event 状态机 + 包内素材路由 + JSON API
client.js          Client 半边：__ModuleLoader__ 包装的 overlay/控制台/设置页
assets/            全部素材（15 张在用 GIF + 备用 JPG）
test/smoke.mjs     冒烟测试：node test/smoke.mjs
```

- Host 通过 `ctx.on('session/event')` 审计日志事件驱动状态机（`approval/*`、`tool/*`、`turn/end`、`assistant/chunk`、`user/message`）；运行检测直接扫描 agents 注册表（事件计数会漏掉激活前已 running 的 agent）
- 浏览器半边经 `/dsh-taffy-mood/api/state` 轮询状态、`/api/action` 提交动作（lock / clear-rejected / test-approve），素材经 `/dsh-taffy-mood/assets/*` 白名单路由提供并内存缓存
- 插话判定 = 工具执行中或 2.5 秒内有 chunk，避免新轮次启动瞬间的时序误报
- 打字检测用官方 `conversation.composer.dock` InputZone 的 `props.input.draft`
- 无构建步骤、无 npm 依赖：纯 ESM host + ModuleLoader 包装 client，clone 即源码即产物

## License

MIT
