package cn.cqie.kebiao

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import java.net.URLEncoder

/**
 * 官方登录 WebView。
 * 链: casLogin -> 统一 CAS(用户输账号/密码/验证码, 可能免密 SSO)
 *      -> authserver/authentication/cas 换会话(302) -> /workspace/cas
 * 拦截点 A: 页面到达 /workspace/cas(会话 cookie 已就位) -> 改跳 oauth/authorize
 *      -> 302 -> token-index?code=...  (SSO 已登录, 不再要验证码)
 * 拦截点 B: 页面到达 token-index 且带 code -> 停载, 原生换 token -> 结束本页。
 * 与 njw_login._full_cas_oauth 相同的确定性流程, 只是把"输验证码"交给真人 WebView。
 */
class LoginActivity : Activity() {

    private lateinit var web: WebView
    private var injects = 0
    @Volatile private var handling = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(web)
        configure(web)
        web.loadUrl(casStartUrl())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(w: WebView) {
        val s: WebSettings = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        s.setSupportZoom(false)
        w.setBackgroundColor(Color.WHITE)
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                val u = url ?: ""
                if (handling) return
                // A: CAS 成功后落到 workspace/cas(会话已建) -> 走 authorize 拿 code
                if (u.contains("/workspace/cas") && injects < 4) {
                    injects++
                    view?.stopLoading()
                    view?.loadUrl(authorizeUrl())
                    return
                }
                // B: authorize 带 code 回来 -> 换 token
                if (u.contains("/workspace/token-index") && u.contains("code=")) {
                    handling = true
                    view?.stopLoading()
                    handleCode(u)
                }
            }
        }
    }

    private fun casStartUrl(): String =
        "$NJW_AUTH/casLogin?redirect_uri=" + URLEncoder.encode(REDIRECT_CAS, "UTF-8")

    private fun authorizeUrl(): String =
        "$NJW_AUTH/oauth/authorize?client_id=$CLIENT_ID&response_type=code&scope=all&state=" +
            "&redirect_uri=" + URLEncoder.encode(REDIRECT_TOKEN, "UTF-8")

    private fun handleCode(url: String) {
        val code = Uri.parse(url).getQueryParameter("code")
        if (code.isNullOrEmpty()) { handling = false; return }
        Thread {
            val ok = exchangeCode(this, code) != null
            runOnUiThread {
                if (ok) {
                    setResult(Activity.RESULT_OK)
                    finish()
                } else {
                    handling = false
                    injects = 0
                    Toast.makeText(this, "登录成功但换取 token 失败，请重试", Toast.LENGTH_LONG).show()
                    web.loadUrl(casStartUrl())
                }
            }
        }.start()
    }

    override fun onBackPressed() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
