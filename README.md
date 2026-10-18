# YugiohDeckRulingIndex

游戏王卡组与单卡裁定索引站，集中整理各系列的裁定、持续适用效果、注意事项、自肃和召唤条件，方便玩家与裁判学习、查阅。

项目由 SRDS 及多位中国大陆裁判共同支持。

> **比赛使用提示：** 本站首页明确提示，在比赛过程中使用本页面可能受到警告以上判罚。请遵守赛事规定。

## 功能介绍

| 功能 | 说明 |
|---|---|
| 卡组索引 | 首页以卡片形式展示各系列入口及更新标记 |
| 卡组裁定 | 按系列整理裁定、效果适用、注意事项、自肃与召唤条件等内容 |
| 单卡裁定 | 提供部分单卡的独立裁定页面，并支持在其他页面引用 |
| 卡组预览 | 展示主卡组、额外卡组与副卡组，支持展开查看分享码卡组 |
| 卡片信息 | 在已接入的页面中，通过悬停或点击查看卡片详情、正文中的卡名效果 |
| MyCard 前排卡组 | 根据排行快照及系列映射，在对应页面展示相关构筑 |
| 实验性效果标记 | 部分页面提供效果状态开关，辅助手动记录；开关本身不进行规则判定 |

各页面的内容与功能接入情况可能不同。

## 技术组成

| 部分 | 使用技术 |
|---|---|
| 页面与样式 | HTML、CSS、Typerite 模板 |
| 页面交互 | 原生 JavaScript、jQuery、模板配套插件 |
| 数据存储 | 静态 JSON 文件 |
| 排行同步 | Python 标准库、GitHub Actions |
| 卡组代理 | Vercel Serverless Function（TypeScript） |

## 项目结构

```text
YugiohDeckRulingIndex/
├── index.html                    # 首页及卡组索引
├── header.html                   # 公共导航
├── footer.html                   # 公共页脚
├── page-about.html               # 项目介绍与反馈入口
├── Maliss.html                   # 卡组裁定页示例
├── Ars_Magna.html                # 单卡裁定页示例
├── css/                          # 网站、卡组预览与标记工具样式
├── images/                       # 页面图片与卡组封面
├── js/
│   ├── main.js                   # 公共组件与页面交互
│   ├── deck-names.js             # 从页面标题读取名称并设置封面
│   ├── deck-cards.js             # 首页卡组卡片渲染
│   ├── deck-viewer.js            # 卡组渲染与卡片信息展示
│   ├── mc-deck-previews.js        # MyCard 快照匹配与展示
│   └── judge-tool.js             # 实验性效果状态开关
├── data/
│   ├── mc-leaderboard.json       # MyCard 排行快照
│   └── mc-series-pages.json      # 系列名称与裁定页映射
├── scripts/
│   └── sync-mc-leaderboard.py    # 排行快照同步脚本
├── api/
│   └── deck-proxy.ts             # 外部卡组页面代理
├── .github/workflows/
│   └── sync-mc.yml               # 定时同步工作流
└── readme.txt                    # 原始模板说明与授权条款
```

## 内容维护

### 更新已有卡组

在对应 HTML 页面中修改裁定内容，并按需更新 `index.html` 中该卡组的 `data-updated` 标记。

MyCard 构筑由同步脚本自动维护首页日期：按系列比较同步前后的构筑码集合，仅在构筑新增、删除或卡组码变化时，将对应卡组的 `data-updated` 更新为同步当天的北京时间日期（`YYYY-MM-DD`）。排名、积分、排列顺序或相同构筑的重复次数变化不会触发日期更新。首次同步没有旧快照时，按空构筑集合比较。

同步后有 JSON 构筑的页面会清空 `div#deck-raw` 内部内容，保留 DIV 本身及其他属性。系列退出前排时，从上一份快照保留第一份有效构筑到 `old_decks`（按页面名索引），页面显示 `old`，并在连续空缺的同步中继续保留；重新出现当前构筑时删除该历史记录。历史构筑不计入当前前排的 `players` 和 `total`。

没有 JSON 历史但仍有静态构筑的页面，只保留 `deck-raw` 中第一份构筑，并添加 `data-old="true"`，页面显示 `old · 历史构筑`。如果原本没有任何可用构筑，不生成虚构的历史记录。静态构筑清理或 old 标记变化也会更新首页日期。

页面名称由 `<title>` 提供，导航名称与首页卡片名称会读取对应页面标题。

### 新增卡组

1. 参考已有卡组页面创建新的 HTML 文件，填写标题及裁定内容。
2. 在 `index.html` 中添加 `<deck-card>` 入口。
3. 在 `header.html` 的卡组列表中添加链接。
4. 添加封面图片；按默认规则使用以下路径：
   - 首页封面：`images/thumbs/masonry/页面名-600.jpg`
   - 详情封面：`images/thumbs/single/standard/页面名-2000.jpg`
5. 如需展示 MyCard 前排构筑，在 `data/mc-series-pages.json` 中维护系列名称映射。

默认图片路径中的“页面名”指 HTML 文件名去掉 `.html` 后的部分。

### 共享单卡裁定

页面可通过 `.ruling-include` 元素的 `data-ruling-source` 指定来源页面与内容选择器。公共脚本负责加载引用内容，便于集中维护多页共用的裁定。

## MyCard 数据同步

同步脚本从以下接口分页读取排行数据，目标范围为前 100 名：

```text
https://ygo.xyk.one/mc/api/leaderboard?page={page}
```

处理结果保存到 `data/mc-leaderboard.json`。前端依据
`data/mc-series-pages.json`，将卡组主系列匹配到对应裁定页面。

### 手动同步

推荐使用与工作流一致的 Python 3.12。脚本仅使用标准库，无需额外安装 Python 依赖。

```bash
# 拉取最新排行并更新本地 JSON 快照
python scripts/sync-mc-leaderboard.py
```

### 自动同步

GitHub Actions 工作流配置为每天北京时间 **06:00** 触发，也支持在 Actions 页面手动运行。

工作流会在快照发生变化时自动提交并推送更新，同时提交构筑变化所对应的 `index.html` 日期更新及系列 HTML 中的静态构筑清理，需要仓库允许 Actions 写入内容。手动运行同步脚本也会更新这些页面。实际运行与数据更新情况可在工作流记录中查看。

前端展示的是最近同步的快照，更新时间可与源站实时排行存在差异。

## 外部资源

| 来源 | 用途 |
|---|---|
| [百鸽](https://ygocdb.com/) | 卡片资料与详情页面 |
| 卡图 CDN | 卡组预览图片及备用图片 |
| [MyCard 前排数据](https://ygo.xyk.one/mc) | 排行与构筑快照来源 |
| `deck.ourygo.top` | 外部卡组页面 |
| [Styleshout](https://www.styleshout.com/) | Typerite 页面模板 |

外部服务的可用性会影响对应图片、资料或预览功能。

## 反馈与贡献

欢迎反馈裁定错误、提出新增卡组需求，或提供整理好的资料。

可通过项目关于页面提供的
[腾讯文档](https://docs.qq.com/sheet/DSFBKTEtGRWNaV0Fr)
提交反馈。

建议附上相关页面、具体问题、修正建议及裁定出处，方便维护者核对。

## 致谢与授权

感谢梅洛、蹦蹦、米吕及参与资料整理和维护的中国大陆裁判，感谢 SRDS 的支持，网站由水橋パルスィ提供。

网站基于 Styleshout 的 Typerite 模板开发。模板授权与署名要求详见
[readme.txt](readme.txt)，使用和再发布时请遵守其中的条款，并保留所需署名链接。

模板授权不代表项目内全部资料及第三方资源使用相同许可；相关内容应遵循各自的授权条件。
