import Foundation
import Security

enum AppConfig {
    static let authBase = URL(string: "https://njw.cqie.edu.cn/authserver")!
    static let casRedirect = "https://njw.cqie.edu.cn/workspace/cas"
    static let tokenRedirect = "https://njw.cqie.edu.cn/workspace/token-index"
    static let clientID = "personal-prod"
    static let clientSecret = "app-a-1234"

    static var casStartURL: URL {
        var components = URLComponents(url: authBase.appendingPathComponent("casLogin"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "redirect_uri", value: casRedirect)]
        return components.url!
    }

    static var authorizeURL: URL {
        let endpoint = authBase.appendingPathComponent("oauth").appendingPathComponent("authorize")
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "all"),
            URLQueryItem(name: "state", value: ""),
            URLQueryItem(name: "redirect_uri", value: tokenRedirect)
        ]
        return components.url!
    }
}

private struct StoredToken: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: TimeInterval
}

enum TokenStore {
    private static let service = Bundle.main.bundleIdentifier ?? "cn.cqie.kebiao"
    private static let account = "oauth-token"

    private static func read() -> StoredToken? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(StoredToken.self, from: data)
    }

    static var accessToken: String { read()?.accessToken ?? "" }
    static var refreshToken: String { read()?.refreshToken ?? "" }

    static var hasValidAccessToken: Bool {
        guard let token = read() else { return false }
        return !token.accessToken.isEmpty && token.expiresAt > Date().timeIntervalSince1970 + 60
    }

    static func save(accessToken: String, refreshToken: String?, expiresIn: TimeInterval) {
        let currentRefresh = read()?.refreshToken ?? ""
        let token = StoredToken(
            accessToken: accessToken,
            refreshToken: (refreshToken?.isEmpty == false ? refreshToken! : currentRefresh),
            expiresAt: Date().timeIntervalSince1970 + max(60, expiresIn - 120)
        )
        guard let data = try? JSONEncoder().encode(token) else { return }
        clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum OAuthService {
    static func exchange(code: String, completion: @escaping (String?) -> Void) {
        requestToken(parameters: [
            "client_id": AppConfig.clientID,
            "client_secret": AppConfig.clientSecret,
            "code": code,
            "redirect_uri": AppConfig.tokenRedirect,
            "grant_type": "authorization_code"
        ], completion: completion)
    }

    static func refresh(completion: @escaping (String?) -> Void) {
        let refreshToken = TokenStore.refreshToken
        guard !refreshToken.isEmpty else {
            completion(nil)
            return
        }
        requestToken(parameters: [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": AppConfig.clientID,
            "client_secret": AppConfig.clientSecret
        ], completion: completion)
    }

    private static func requestToken(parameters: [String: String], completion: @escaping (String?) -> Void) {
        let endpoint = AppConfig.authBase.appendingPathComponent("oauth").appendingPathComponent("token")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let basic = Data("\(AppConfig.clientID):\(AppConfig.clientSecret)".utf8).base64EncodedString()
        request.setValue("Basic \(basic)", forHTTPHeaderField: "Authorization")
        request.httpBody = formBody(parameters)

        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let accessToken = object["access_token"] as? String,
                  !accessToken.isEmpty else {
                completion(nil)
                return
            }
            let refreshToken = object["refresh_token"] as? String
            let expiresIn = (object["expires_in"] as? NSNumber)?.doubleValue ?? 604_799
            TokenStore.save(accessToken: accessToken, refreshToken: refreshToken, expiresIn: expiresIn)
            completion(accessToken)
        }.resume()
    }

    private static func formBody(_ parameters: [String: String]) -> Data? {
        var components = URLComponents()
        components.queryItems = parameters.sorted(by: { $0.key < $1.key }).map {
            URLQueryItem(name: $0.key, value: $0.value)
        }
        return components.percentEncodedQuery?.data(using: .utf8)
    }
}

enum NativeHTTP {
    static func perform(
        method: String,
        urlString: String,
        bearer: String,
        body: String,
        completion: @escaping (String) -> Void
    ) {
        guard let url = URL(string: urlString), url.scheme == "https" else {
            completion("__KBT_ERR__0\ninvalid URL")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method.uppercased()
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !bearer.isEmpty { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if !body.isEmpty {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = body.data(using: .utf8)
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion("__KBT_ERR__0\n\(error.localizedDescription)")
                return
            }
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            guard let http = response as? HTTPURLResponse else {
                completion("__KBT_ERR__0\ninvalid response")
                return
            }
            if (200...299).contains(http.statusCode) {
                completion(text)
            } else {
                completion("__KBT_ERR__\(http.statusCode)\n\(String(text.prefix(500)))")
            }
        }.resume()
    }
}
