# dsh-sticker-bag

给 DeepSeek Harness 的表情袋：**收表情、打标签、按情绪挑、一句话发出去**。

插件的本体只有几个文件，不依赖任何第三方包，也不需要模型。它做的事：

- 把一张图加进 QQ 收藏表情（走 OneBot 网关的 `add_custom_face`），并写备注；
- 在本地留一份索引（名字 / 情绪 / 标签 / 用过几次），方便以后按情绪找；
- 图片存放在哪可以自己定——**包括外接硬盘**；
- DSH 里给模型五个工具，聊天时让它自己挑着发。

## 装

```bash
# 从 GitHub 装（改代码即时生效）
git clone https://github.com/1535946785liu-web/dsh-sticker-bag.git
dsh plugin --profile web add link:./dsh-sticker-bag

# 以后发到 npm 之后，也可以一行装：
# dsh plugin --profile web add dsh-sticker-bag
```

装完重启 DSH（或者等它热重载），打开 **设置 → 表情袋**。

## 先配三样

设置页往下拉能看到配置预览，也可以直接编辑文件：

`<DSH_HOME>/sticker-bag/config.json`

```json
{
  "storageDir": "",
  "onebotUrl": "http://127.0.0.1:3000",
  "onebotToken": "",
  "biliCredPath": "",
  "minSide": 64
}
```

| 字段 | 作用 |
| --- | --- |
| `storageDir` | 表情存放地址。空 = `<DSH_HOME>/stickers`；填 `D:\stickers` 就是外接硬盘 |
| `onebotUrl` | OneBot v11 网关地址。SnowLuma / NapCat / LLOneBot 都行 |
| `onebotToken` | 网关的 access token，没有就留空 |
| `biliCredPath` | B站凭证文件路径（拉表情池当候选用）。空 = `<DSH_HOME>/bili-duty/bili_credential.json` |
| `minSide` | 收图的最小边长，太小的糊图直接拒收 |

> OneBot 网关要支持这几个 action：`add_custom_face`、`modify_custom_face`、`delete_custom_face`、`send_custom_face`、`get_login_info`。
> SnowLuma 全部支持；NapCat 支持 `add_custom_face` 但部分版本没有 `modify_custom_face`（插件会跳过备注，不影响收图）。

## 给模型的工具

| 工具 | 干什么 |
| --- | --- |
| `sticker_list` | 看库里有什么，可按情绪 / 关键词筛（默认不返回本地绝对路径） |
| `sticker_add` | 收一张：给 http(s) 图片地址，或表情袋目录里已下好的图；自动质检、写备注 |
| `sticker_remove` | 删一张 |
| `sticker_candidates` | 从 B站表情池拉一批候选到 `<DSH_HOME>/sticker-bag/candidates`，挑着用 |
| `sticker_send` | 发一张（私聊或群） |

## 接到 QQ 会话（仿真会话）

如果 QQ 侧走的是 agent preset（比如 `qq-chat-v2`），插件装在 profile 里**不会**自动出现在 QQ 会话——preset 有自己的插件行和执行期工具白名单。要两件事：

1. preset 的 `agent.cordis.yml` 里加一行：

```yaml
- id: sticker-bag
  name: 'dsh-sticker-bag'
  config: {}
```

2. 如果你的 QQ 侧有类似 `qq-tool-restrict` 的执行期 guard，把五个 `sticker_*` 工具放进白名单。

安全边界（给仿真实例用的）：`sticker_add` 收**本地路径**时只认两处——表情库目录（`storageDir`）和 `<DSH_HOME>/sticker-bag/`（`candidates/`、`downloads/`），其它路径一律拒。这样 QQ 侧能「自己拉候选、自己收、自己发」，但拿不到「读本机任意文件」的口子。需要从网络收图时直接给 `http(s)` 地址。

## 数据放在哪

```
<storageDir>/
├── index.json      清单：名字、情绪、标签、相对路径、用过几次
└── inbox/          原图
```

`index.json` 里存的是**相对路径**，所以整个目录换盘只要改 `storageDir`，清单不用动。设置页里的「搬到新地址」会把文件复制过去（旧的不删，留作备份）。

插件自己的配置和下载缓存：

```
<DSH_HOME>/sticker-bag/
├── config.json     设置
├── candidates/     sticker_candidates 拉的候选图
└── downloads/      sticker_add 从 URL 下载的图
```

## 开源

MIT。欢迎提 issue / PR。

不涉及政治、色情、盗图的内容——这个工具默认只处理「干净的表情」。
