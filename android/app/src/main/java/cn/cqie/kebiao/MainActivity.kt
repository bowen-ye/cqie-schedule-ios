package cn.cqie.kebiao

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import java.util.concurrent.CountDownLatch
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * 主界面: 内嵌 H5 课表(assets/www)。
 * 向 H5 注入 window.Android 桥:
 *   token()        当前 access_token(仅 content 态)
 *   ensureToken()  阻塞式: 先静默续期; 不行则弹官方登录页, 返回有效 token
 *   http()         OkHttp 直连(绕过 WebView CORS), 用于 H5 fetch 兜底
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    @Volatile private var mode = "boot" // boot | login | content
    private val lock = Any()
    private var loginLatch: CountDownLatch? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(web)
        configure(web)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                // 页内只有 GitHub 等外链 http(s): 交给系统浏览器, 不占应用内体验
                val u = url ?: ""
                if (u.startsWith("http://") || u.startsWith("https://")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (e: Exception) { }
                    return true
                }
                return false
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        boot()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(w: WebView) {
        val s: WebSettings = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.setSupportZoom(false)
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        try {
            @Suppress("DEPRECATION")
            s.allowUniversalAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            s.allowFileAccessFromFileURLs = true
        } catch (e: Exception) {
            // 老版本忽略
        }
        w.setBackgroundColor(Color.WHITE)
    }

    private fun boot() {
        Thread {
            var ok = TokenStore.valid(this)
            if (!ok) ok = refreshAccessToken(this) != null
            runOnUiThread {
                mode = "content"
                if (ok) showContent() else requestLogin(blocking = false)
            }
        }.start()
    }

    private fun showContent() {
        mode = "content"
        web.loadUrl(CONTENT_INDEX)
    }

    /** 打开官方登录页。blocking=true 由 JS ensureToken 触发, 阻塞等待结果。 */
    private fun requestLogin(blocking: Boolean): String? {
        if (!blocking) {
            runOnUiThread {
                mode = "login"
                startActivityForResult(Intent(this, LoginActivity::class.java), RC_LOGIN)
            }
            return null
        }
        synchronized(lock) {
            if (loginLatch == null) {
                val latch = CountDownLatch(1)
                loginLatch = latch
                runOnUiThread {
                    mode = "login"
                    startActivityForResult(Intent(this, LoginActivity::class.java), RC_LOGIN)
                }
            }
            loginLatch?.await(200, TimeUnit.SECONDS)
        }
        return if (TokenStore.valid(this)) TokenStore.access(this) else null
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != RC_LOGIN) return
        val latch = loginLatch
        loginLatch = null
        if (TokenStore.valid(this)) {
            showContent()
        } else if (latch == null) {
            // 首次启动被取消且无 token
            Toast.makeText(this, "未登录，无法查看课表", Toast.LENGTH_SHORT).show()
            finish()
        }
        latch?.countDown()
    }

    private inner class Bridge {

        @JavascriptInterface
        fun platform(): String = "android"

        @JavascriptInterface
        fun token(): String =
            if (mode == "content") TokenStore.access(this@MainActivity) else ""

        @JavascriptInterface
        fun ensureToken(): String {
            if (TokenStore.valid(this@MainActivity)) return TokenStore.access(this@MainActivity)
            refreshAccessToken(this@MainActivity)?.let { return it }
            return requestLogin(blocking = true) ?: ""
        }

        @JavascriptInterface
        fun logout() {
            // 账号中心「退出」: 清掉本地 token。由 JS 接着清 localStorage 并 reload,
            // reload 后的首次接口 401 -> ensureToken -> 自动弹官方登录页可换号。
            TokenStore.clear(this@MainActivity)
        }

        @JavascriptInterface
        fun http(method: String, url: String, bearer: String, body: String): String {
            if (mode != "content") return "__KBT_ERR__403\nnot in content mode"
            val jsonType = "application/json; charset=utf-8".toMediaType()
            return try {
                val rb = Request.Builder().url(url)
                val reqBody = if (body.isNotEmpty()) body.toRequestBody(jsonType) else null
                rb.method(method.uppercase(), reqBody)
                rb.header("Accept", "application/json")
                if (bearer.isNotEmpty()) rb.header("Authorization", "Bearer $bearer")
                httpClient.newCall(rb.build()).execute().use { resp ->
                    val s = resp.body?.string() ?: ""
                    if (resp.code in 200..299) s else "__KBT_ERR__${resp.code}\n${s.take(500)}"
                }
            } catch (e: Exception) {
                "__KBT_ERR__0\n" + (e.message ?: "net error")
            }
        }
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else finish()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
