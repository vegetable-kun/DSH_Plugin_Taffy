# PR 草稿 — 提交到 awesome-dsh-plugin/awesome-dsh-plugin

> 操作路径：Fork 该仓库 → 新建分支 → 把 `awesome-dsh-plugin.entry.yml` 的内容存为
> `data/plugins/vegetable-kun__DSH_Plugin_Taffy.yml` → commit → 开 PR（base: main）。

## 标题

```
Add vegetable-kun/DSH_Plugin_Taffy (fun)
```

## 正文

```markdown
## New entry: vegetable-kun/DSH_Plugin_Taffy

A Taffy mood mascot for the DeepSeek Harness Web UI. The corner GIF reacts
live to agent state: approval pending (pulsing fork), approved celebration,
streaming, tool runs, user interrupts, rejections, aborts and errors — 14
distinct moods with a documented priority chain.

- Standard dsh plugin package (`dsh.bundle.patch` + `dsh.client.platform: web`),
  no build step, assets bundled — installs via one command:
  `dsh plugin --profile web add github:vegetable-kun/DSH_Plugin_Taffy`
- Drag to position, middle-click floating console, per-mood locking, test
  approval button; appearance persisted in localStorage
- State machine driven by `session/event` log audit (approval/*, tool/*,
  turn/end, assistant/chunk, user/message); running state read from the live
  agents registry
- MIT licensed; bilingual README; smoke-tested host logic (`node test/smoke.mjs`)

Thanks for maintaining the registry!
```

## 提交前自查（对应官方 pr-gate 自动检查）

- [x] 仓库树内任意位置声明了 `dsh.bundle`（package.json）
- [ ] 仓库龄 ≥ 1 天 —— 建仓次日再提
- [ ] commit 数 ≥ 10 —— 目前不足，正常迭代攒够再提
