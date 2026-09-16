# 在 Windows 上安装到 iPhone

本方法不经过 App Store，适合先给少量设备测试。iPhone 17 可以使用。

## 准备

- iPhone 数据线
- 一个 Apple ID
- Windows 10/11
- 本仓库构建得到的 `cqie-schedule-unsigned.ipa`

免费 Apple ID 签名的 App 有效期为 7 天，需要定期连接同一台电脑刷新。正式长期使用仍建议后续通过 TestFlight 或 App Store 分发。

## 安装 AltStore

1. 从 Apple 官网安装 Windows 版 iTunes 与 iCloud，不要使用 Microsoft Store 版本。
2. 从 AltStore 官网下载并安装 AltServer for Windows。
3. 用数据线连接 iPhone，解锁后点“信任此电脑”。
4. 打开 iTunes，为该 iPhone 开启“通过 Wi-Fi 与此 iPhone 同步”。
5. 运行 AltServer，在系统托盘选择 **Install AltStore**，再选择你的 iPhone。
6. 按 AltServer 提示输入用于免费签名的 Apple ID。
7. 在 iPhone 的“设置 > 隐私与安全性 > 开发者模式”中开启开发者模式并按提示重启。

## 安装课表 IPA

1. 把 `cqie-schedule-unsigned.ipa` 保存到 iPhone 的“文件”App，或通过聊天/网盘传到“文件”。
2. 打开 iPhone 上的 AltStore，进入 **My Apps**。
3. 点击左上角 `+`，选择该 IPA。
4. 等待签名安装完成，然后打开“cqie课表”，进入学校官方登录页登录。

## 每 7 天刷新

让 iPhone 与安装 AltServer 的电脑处于同一 Wi-Fi，电脑保持 AltServer 运行；在 AltStore 的 **My Apps** 页面点击 **Refresh All**。

不要把 Apple ID 密码、验证码或学校账号提供给他人。账号密码只应由使用者本人在 Apple/学校官方页面中输入。
