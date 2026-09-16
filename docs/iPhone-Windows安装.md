# 在 Windows 上安装到 iPhone

本方法不经过 App Store，适合先给少量设备测试。iPhone 17 可以使用。

## 准备

- iPhone 数据线
- 一个 Apple ID
- Windows 10/11
- 本仓库构建得到的 `cqie-schedule-unsigned.ipa`

免费 Apple ID 签名的 App 有效期为 7 天，需要定期连接同一台电脑刷新。正式长期使用仍建议后续通过 TestFlight 或 App Store 分发。

## 最简单：用 Sideloadly 直接安装

1. 从 Apple 官网安装 Windows 版 iTunes 与 iCloud，不要使用 Microsoft Store 版本。
2. 从 Sideloadly 官网下载并安装 Windows 版 Sideloadly。
3. 用数据线连接 iPhone，解锁后点“信任此电脑”。
4. 打开 Sideloadly，把 `cqie-schedule-iphone17-unsigned.ipa` 拖进去。
5. 选择已连接的 iPhone，输入由手机使用者本人掌握的 Apple ID，然后点击 **Start**。
6. 若 Apple ID 开了双重认证，按界面提示使用 Apple 的应用专用密码。
7. 安装后，在 iPhone 的“设置 > 通用 > VPN 与设备管理”中信任该 Apple ID 对应的开发者。
8. 在“设置 > 隐私与安全性 > 开发者模式”中开启开发者模式并按提示重启。
9. 打开“cqie课表”，由手机使用者本人在学校官方页面登录。

## 免费账号的限制

- 免费 Apple ID 签名有效期为 7 天，到期前需要重新用 Sideloadly 安装一次。
- 付费 Apple Developer 账号的签名通常可使用一年。
- 你可以把本安装包 ZIP 发给对方，但签名安装时最好由对方本人输入自己的 Apple ID。

## 可选：使用 AltStore 自动刷新

如果不想每周重新拖入 IPA，也可以安装 AltServer/AltStore。让 iPhone 与安装 AltServer 的电脑处于同一 Wi-Fi，电脑保持 AltServer 运行，然后在 AltStore 的 **My Apps** 页面点击 `+` 安装 IPA，之后使用 **Refresh All** 刷新签名。

不要把 Apple ID 密码、验证码或学校账号提供给他人。账号密码只应由使用者本人在 Apple/学校官方页面中输入。
