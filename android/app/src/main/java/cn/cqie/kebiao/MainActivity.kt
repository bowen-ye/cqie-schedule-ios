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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * 主界面: 内嵌 H5 课表(assets/www)。
 * 向 H5 注入 window.Android 桥:
 *   token()        当前 access_token(仅 content 态)
 *   ensureToken()  阻塞式: 先静默续期; 不行则弹官方登录页, 返回有效 token
 *   relogin()      非阻塞: 直接弹官方登录页(补登录/换号), 成功由 onActivityResult 刷新
 *   logout()       账号中心「退出」: 清本地 token + 官方 CAS cookie(否则 SSO 会静默登回原号)
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
                if (mode == "login") return@runOnUiThread   // 防连点开两个登录页
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
        } else {
            // 登录被取消/失败(含主动退出后): 回到「未登录」落地页(可再点"去登录"),
            // 不再把整个 App 关掉。
            mode = "content"
            web.loadUrl(CONTENT_INDEX)
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
            // 账号中心「退出」: 清本地 token, 并且必须连官方 CAS 会话 cookie 一起清掉 ——
            // 否则换号登录时被 SSO 一秒内静默登回原账号, 看起来就像"退不掉"。
            // JS 侧随后会清 localStorage(kbt-*) 并 reload 到"未登录"落地页。
            TokenStore.clear(this@MainActivity)
            try {
                android.webkit.CookieManager.getInstance().apply {
                    removeAllCookies(null)
                    flush()
                }
            } catch (e: Exception) {
            }
        }

        /** 账号中心「去官方登录页」: 非阻塞弹官方登录页, 不冻结 H5; 成功后由 onActivityResult 刷新内容页。 */
        @JavascriptInterface
        fun relogin() {
            requestLogin(blocking = false)
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
