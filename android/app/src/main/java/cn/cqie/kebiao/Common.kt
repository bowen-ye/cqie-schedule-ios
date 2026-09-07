package cn.cqie.kebiao

import android.content.Context
import android.util.Base64
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 与教务 OAuth 链相关的常量 + Token 本地存储 + token 换取/续期。
 * 端点/字段与 njw_login.py 一一对应(只读本人课表, 合规边界同抢课仓库)。
 */
const val NJW_AUTH = "https://njw.cqie.edu.cn/authserver"
const val REDIRECT_CAS = "https://njw.cqie.edu.cn/workspace/cas"
const val REDIRECT_TOKEN = "https://njw.cqie.edu.cn/workspace/token-index"
const val CLIENT_ID = "personal-prod"
const val CLIENT_SECRET = "app-a-1234"
const val CONTENT_INDEX = "file:///android_asset/www/index.html"
const val PREFS = "kbt"
const val RC_LOGIN = 1001

object TokenStore {
    private fun p(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun valid(ctx: Context): Boolean {
        val at = p(ctx).getString("at", "") ?: ""
        val exp = p(ctx).getLong("exp", 0L)
        return at.isNotEmpty() && exp > System.currentTimeMillis() + 60_000
    }

    fun access(ctx: Context): String = p(ctx).getString("at", "") ?: ""

    fun save(ctx: Context, at: String, rt: String?, expiresIn: Long) {
        p(ctx).edit()
            .putString("at", at)
            .putString("rt", rt ?: "")
            .putLong("exp", System.currentTimeMillis() + (expiresIn - 120) * 1000)
            .apply()
    }

    fun clear(ctx: Context) {
        p(ctx).edit().clear().apply()
    }
}

val httpClient: OkHttpClient by lazy {
    OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
}

private fun basicAuth(): String {
    val raw = "$CLIENT_ID:$CLIENT_SECRET".toByteArray()
    return "Basic " + Base64.encodeToString(raw, Base64.NO_WRAP)
}

private fun parseAndSave(ctx: Context, json: String): String? = try {
    val j = JSONObject(json)
    val at = j.optString("access_token")
    if (at.isEmpty()) {
        null
    } else {
        // 有些实现刷新响应里不带新的 refresh_token; 此时沿用旧的, 绝不能清空覆盖
        // (否则一次刷新后 refresh 就永久失效, 用户就不得不重新登录了)
        var rt = j.optString("refresh_token")
        if (rt.isEmpty()) rt = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("rt", "") ?: ""
        TokenStore.save(ctx, at, rt.ifEmpty { null }, j.optLong("expires_in", 604799L))
        at
    }
} catch (e: Exception) {
    null
}

/** 用 authorize 拿到的 code 换 token(grant_type=authorization_code)。成功即落盘并返回 access_token。 */
fun exchangeCode(ctx: Context, code: String): String? {
    val form = FormBody.Builder()
        .add("client_id", CLIENT_ID)
        .add("client_secret", CLIENT_SECRET)
        .add("code", code)
        .add("redirect_uri", REDIRECT_TOKEN)
        .add("grant_type", "authorization_code")
        .build()
    return try {
        val req = Request.Builder().url("$NJW_AUTH/oauth/token")
            .header("Authorization", basicAuth())
            .header("Accept", "application/json")
            .post(form)
            .build()
        httpClient.newCall(req).execute().use { resp ->
            val s = resp.body?.string() ?: ""
            if (resp.code in 200..299) parseAndSave(ctx, s) else null
        }
    } catch (e: Exception) {
        null
    }
}

/** 静默续期(grant_type=refresh_token)。refresh 失效则清空本地 token。 */
fun refreshAccessToken(ctx: Context): String? {
    val rt = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("rt", "") ?: ""
    if (rt.isEmpty()) return null
    val form = FormBody.Builder()
        .add("grant_type", "refresh_token")
        .add("refresh_token", rt)
        .add("client_id", CLIENT_ID)
        .add("client_secret", CLIENT_SECRET)
        .build()
    return try {
        val req = Request.Builder().url("$NJW_AUTH/oauth/token")
            .header("Authorization", basicAuth())
            .header("Accept", "application/json")
            .post(form)
            .build()
        httpClient.newCall(req).execute().use { resp ->
            val s = resp.body?.string() ?: ""
            // 续期失败(网络/服务器临时故障)不碰本地登录态: 下次启动会再次尝试静默续期。
            // 只有 refresh 真正失效时, 界面上才会因 401 自动弹官方登录页。
            if (resp.code in 200..299) parseAndSave(ctx, s) else null
        }
    } catch (e: Exception) {
        null
    }
}
