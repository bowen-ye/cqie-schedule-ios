# cqie课表 · CQIE Schedule

Android / iOS 课表查询 App，并提供 Safari 主屏幕版。原生端通过官方 OAuth 直连教务；Safari 端在教务官网同源读取**本人**课表后仅把课表数据保存到本机。
无自建账号中转服务器、无第三方 SDK，账号密码始终只在学校官方页面输入。

| | |
|---|---|
| 平台 | Android 8.0+ (minSdk 26 / targetSdk 34)、iOS/iPadOS 15+ |
| 数据源 | 重庆工程学院教务 `njw.cqie.edu.cn`(官方 OAuth2 + Bearer API) |
| 模式 | 直连教务 · 单机单账号(他人使用 = 他自己登录自己的号) |
| 隐私 | 只读本人课表；原生端 token 存本机安全区，Safari 端不导出 token，只存课表数据 |

## 功能

- **官方登录**: 应用内打开统一认证 CAS 页面输账号/密码/验证码, 自动完成 OAuth 换取 token; 过期静默续期, 失败才再弹登录页
- **周课表 / 今日** 双视图
  - 自动定位**当前教学周**, 今天整列高亮(周课表); 今日页显示 正在上 / 下一节 / 已结束 + 30s 自动刷新
  - 作息时间表自动读教务官方 12 节
  - 点击任意空白格可**手动补录**课程/任务(虚线卡片, 存本机)
- **离线秒开**: 最近学期课表缓存在本地, 断网也能看; 有网后台自动刷新
- **手机清晰排课**: 顶部保留七天概览，点选某天后以完整宽度逐门显示；同时段课程分别列出并标记“时间冲突”，绝不互相遮挡
- **账号中心**(顶栏 👤): 查看当前账号 / 清除本地缓存 / **退出登录**(连官方 CAS 会话一起清, 回到「未登录」落地页, 点「去官方登录页」即可换号, 不被 SSO 静默登回原号)

## 目录

```
android/    原生壳(Kotlin + WebView + OkHttp): 登录链、token 存储、JS 桥
ios/        原生壳(Swift + WKWebView + URLSession): OAuth、Keychain、JS 桥
prototype/  网页原型 = 唯一 UI 真源(H5 三件套, 复用于 APK 内嵌)
docs/       需求文档
```

## 打包 APK

打包脚本会把 `prototype/` 的 H5 同步进 assets 再 Gradle 出包:

```bat
android\build_apk.bat
```

产物: `android/app/build/outputs/apk/release/app-release.apk`(已开 R8 minify + 资源收缩)。

> 纯前端调试 `prototype/index.html` 即可; `prototype/server.py` 是仅供本机联调的后端代理, 不入库。

## 构建 iOS App

iOS 必须在 macOS + Xcode 上编译和签名：

```sh
sh ios/sync_web.sh
open ios/Kebiao.xcodeproj
```

在 Xcode 的 `Signing & Capabilities` 里选择自己的 Team 后，即可运行到 iPhone；归档、TestFlight 和 IPA 分发步骤见 [`ios/README.md`](ios/README.md)。iOS 端把 token 存在 Keychain，不保存账号密码。

## Safari 一体式链接

`prototype/` 已具备 iPhone 单日课表界面。由于学校拒绝外部 OAuth 回跳，而且学校网关的跨域响应会被浏览器拦截，Safari 首次使用需要设置一次“导入课表”书签：学生在学校官网正常登录后点击该书签，书签在官网同源读取当前学期课表，再通过不会发送到服务器的 URL 片段把压缩后的课表数据带回，并立即从地址栏清除。返回数据必须匹配本机生成的随机校验码，外部构造的链接不能覆盖课表；账号密码和登录凭证始终留在学校页面。

iOS 会把主屏幕 Web App 与 Safari 的本地存储隔离，不能依赖两者共享缓存。课表导入成功后点击页面里的“同步到主屏幕”，再从生成的专用页面执行“分享 → 添加到主屏幕”。页面同时复制一份不含学号和登录凭证的压缩课表导入码：桌面图标通常会在首次打开时自动恢复；如果当前 iOS 没有保留安装地址，点击“从剪贴板导入课表”即可。以后更新只需在 Safari 重新导入并同步，再到原桌面图标中点击“从剪贴板更新课表”，不用重装图标。

实机验证已确认学校 OAuth 拒绝外部回跳地址，错误为 `Invalid redirect`。学校现有客户端只登记了 `https://njw.cqie.edu.cn/workspace/token-index`，因此网页不能实现零设置自动回跳。书签桥接只导入渲染所需的当前学期课表数据，不导出 token；Windows + Sideloadly 原生安装仍是另一种可用方式。不要用第三方服务器代收学校账号密码。

## 合规边界

只登录本人账号、只读本人课表; 不聚合他人账号、不批量抓取。仓库不含任何账号 / 密码 / token。
