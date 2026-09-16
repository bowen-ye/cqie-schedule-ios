# cqie课表 · CQIE Schedule

Android / iOS 课表查询 App: 内嵌官方登录页 → 捕获 OAuth token → 直连教务拉**本人**课表。
无自建服务器、无第三方 SDK、数据只在你手机与教务服务器之间流动。

| | |
|---|---|
| 平台 | Android 8.0+ (minSdk 26 / targetSdk 34)、iOS/iPadOS 15+ |
| 数据源 | 重庆工程学院教务 `njw.cqie.edu.cn`(官方 OAuth2 + Bearer API) |
| 模式 | 直连教务 · 单机单账号(他人使用 = 他自己登录自己的号) |
| 隐私 | 只读本人课表; 本机只存 token(约 7 天, 自动静默续期), 不存密码 |

## 功能

- **官方登录**: 应用内打开统一认证 CAS 页面输账号/密码/验证码, 自动完成 OAuth 换取 token; 过期静默续期, 失败才再弹登录页
- **周课表 / 今日** 双视图
  - 自动定位**当前教学周**, 今天整列高亮(周课表); 今日页显示 正在上 / 下一节 / 已结束 + 30s 自动刷新
  - 作息时间表自动读教务官方 12 节
  - 点击任意空白格可**手动补录**课程/任务(虚线卡片, 存本机)
- **离线秒开**: 最近学期课表缓存在本地, 断网也能看; 有网后台自动刷新
- **手机一屏看全**: 窄屏周课表列宽自适应, 7 天整张铺满、无需左右滑动
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

## 合规边界

只登录本人账号、只读本人课表; 不聚合他人账号、不批量抓取。仓库不含任何账号 / 密码 / token。
