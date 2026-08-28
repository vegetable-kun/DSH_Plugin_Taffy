# taffy-mood — DeepSeek Harness 表情包状态机插件

这是一个 dsh 的插件，把 Taffy 表情包挂在 DeepSeek Harness Web UI 右下角，随 agent 状态自动切换：待审批、思考中、干活中、出错、被打断……全部有专属表情。标准 DSH 插件包（bundle + web client），素材随包分发，一条命令安装。

![taffy](assets/taffy-fork.gif)

## 安装

```sh
dsh plugin --profile web add github:vegetable-kun/DSH_Plugin_Taffy
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
| 求饶 | `taffy-begging` | 60 秒内第二次审批请求，5 秒窗口（过期回落待审批）|
| 等你回答 | `taffy-staring` 静态图 | ask_user_question 提问挂起，回答即恢复 |
| 记忆压缩中 | `taffy-pressure` 静态图 | 上下文压缩 start→end（含 90 秒兜底）|
| 长任务疲惫 | `taffy-angry_staring` 静态图 | 单轮持续超 3 分钟，turn/end 即清 |
| 审批没人理 | `taffy-cry_denying` | 审批挂起超 30 秒无人处理，决定落地即恢复 |
| 休眠 | `taffy4` 静态图 | 空闲超 10 分钟，省 GIF 解码；打字/任何活动即醒 |
| 开机问候 | `tafei` 静态图 | 页面加载后首屏打招呼 2 秒，不遮蔽任何业务状态 |

优先级链：锁定 > 求饶(时间盒) > 等你回答 > 记忆压缩 > 审批没人理 > 待审批 > 批准庆祝 > 惊讶 > 哭 > 中止/出错/假哭闪帧 > 得意 > 长任务疲惫 > 运行中(黑客/思考/工具) > 打字 > 开机问候(2秒) > 休眠 > 闲置。所有新状态都有明确出口：求饶是时间盒、等你回答由回答消息/结果配对/轮次结束三路清除、压缩由 end 事件加兜底超时双保险、疲惫与没人理由时间阈值动态推导并随轮次/决定自动消失，均不会阻塞下层状态。

## 使用

- **左键拖动**移动位置；**中键点击**打开浮动控制台；右键兜底
- 控制台：实时状态徽章 / 锁定任意表情（调试用）/ 测试审批 / 重置位置
- 设置面板 → 「Taffy 表情」页：启用开关、大小（50–1000px）、不透明度、鼠标穿透、**今日状态时长统计**
- 外观设置保存在浏览器 localStorage（键 `dsh-taffy-mood/settings`），刷新不丢

## 卸载 / 停用

```sh
dsh plugin --profile web remove dsh-taffy-mood   # 从 profile 移除
# 或在设置页关闭「启用表情」临时隐藏
```

## 配置

阈值可在 `~/.dsh/profiles/web/cordis.patch.yml` 里给 `dsh-taffy-mood` 行追加 `config` 字段（蛇形命名，只传想改的）：

```yaml
- id: dsh-taffy-mood
  config:
    surprised_ms: 6000          # 插话惊讶 6 秒（默认 4000）
    ignored_after_ms: 60000     # 审批没人理 60 秒（默认 30000）
    sleep_after_ms: 600000      # 休眠 10 分钟（默认 600000）
    tired_after_ms: 300000      # 长任务疲惫 5 分钟（默认 180000）
    # turn_flash_ms / crying_ms / admirable_ms / begging_window_ms / begging_show_ms / compacting_failsafe_ms 同理
```

未列出的字段保持原默认值；非法值（负数、非数字）会被 host 忽略并回退到默认。

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
- 写动作严格 POST-only + Origin 校验（仅放行 `127.0.0.1`/`localhost` loopback 与缺 Origin 的本地工具），防止跨源页面通过 `<img>` 触发审批弹卡
- 轮询节奏按需调度：活跃状态 300ms 跟手，空闲 2s 兜底，时间态到期精确触发
- 插话判定 = 工具执行中或 2.5 秒内有 chunk，避免新轮次启动瞬间的时序误报
- 打字检测用官方 `conversation.composer.dock` InputZone 的 `props.input.draft`
- 阈值可通过 `~/.dsh/profiles/web/cordis.patch.yml` 覆盖（`config:` 字段，蛇形命名），如 `surprised_ms: 6000` / `sleep_after_ms: 600000`
- 素材按内容哈希永久缓存（`max-age=31536000, immutable`），URL 形如 `/assets/taffy-cry.a1b2c3d4.gif`；换包换 URL 不卡旧版，老 URL 走 301 兼容
- 纯 ESM host + ModuleLoader 包装 client，无构建步骤、无 npm 依赖，clone 即源码即产物

有问题欢迎投issue和pr,喜欢就点个免费的star吧

<img width="300" height="300" alt="taffy-underwear" src="https://github.com/user-attachments/assets/3118f157-4fa5-44ba-889e-4e056bfa2ebf" />

## License

MIT
