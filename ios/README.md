# iOS 构建说明

## 环境

- macOS 13 或更高版本
- Xcode 15 或更高版本
- iOS 15 或更高版本的 iPhone/iPad
- Apple ID；真机长期分发或 App Store 发布需要 Apple Developer 账号

## 运行

1. 在 macOS 终端进入仓库，执行 `sh ios/sync_web.sh`。
2. 用 Xcode 打开 `ios/Kebiao.xcodeproj`。
3. 选择 `Kebiao` Target，在 **Signing & Capabilities** 里选择自己的 Team。
4. 如果 Bundle Identifier 已被占用，将 `cn.cqie.kebiao` 改成自己的唯一标识。
5. 连接 iPhone，选择该设备后点击 Run。

模拟器可以检查界面，但学校登录页或校园网策略可能要求使用真机网络。首次启动会打开学校官方登录页；应用不接触账号密码，只把 OAuth token 保存在 iOS Keychain。

## 打包 IPA / TestFlight

在 Xcode 选择 **Product > Archive**，归档完成后通过 Organizer 选择：

- **Distribute App > TestFlight & App Store**：上传 TestFlight 或 App Store Connect。
- **Distribute App > Ad Hoc**：导出给已登记 UDID 的设备安装。
- 免费 Apple ID 只能用于个人真机调试，签名通常 7 天失效，不能用于正式分发。

## 网页资源

课表 UI 的唯一源文件仍是仓库根目录下的 `prototype/`。修改后重新运行 `sh ios/sync_web.sh`，再在 Xcode 构建即可。
