# ===== 直连教务 APK · R8 保留规则 =====

# WebView.addJavascriptInterface 靠反射把 JS 名映射到方法, R8 不感知字符串,
# 必须整类保留, 否则 window.Android.token()/ensureToken()/http()/logout() 会变没。
-keep class cn.cqie.kebiao.MainActivity$Bridge { *; }

# MainActivity / LoginActivity 由 AndroidManifest 启动, 保个底(通常 manifest 已自动保留)
-keep class cn.cqie.kebiao.MainActivity { *; }
-keep class cn.cqie.kebiao.LoginActivity { *; }

# okhttp 自带 consumer rules; 这里仅关掉它那些不需要的 verbose(可选)
-dontwarn okhttp3.**
-dontwarn okio.**
