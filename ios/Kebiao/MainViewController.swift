import UIKit
import WebKit

final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var bootStarted = false
    private var loginInProgress = false
    private var loginWaiters: [(String) -> Void] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        controller.add(self, name: "cqieBridge")

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = controller
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        loadContent()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !bootStarted else { return }
        bootStarted = true
        guard !TokenStore.hasValidAccessToken else { return }

        OAuthService.refresh { [weak self] token in
            DispatchQueue.main.async {
                guard let self else { return }
                if token != nil {
                    self.loadContent()
                } else {
                    self.beginLogin(reloadOnSuccess: true, completion: nil)
                }
            }
        }
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "cqieBridge")
    }

    private func loadContent() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") else {
            showFatalError("应用资源不完整，请重新安装。")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private func showFatalError(_ message: String) {
        let label = UILabel()
        label.text = message
        label.textAlignment = .center
        label.numberOfLines = 0
        label.textColor = .secondaryLabel
        label.frame = view.bounds.insetBy(dx: 24, dy: 24)
        view.addSubview(label)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if url.isFileURL || url.scheme == "about" {
            decisionHandler(.allow)
        } else if url.scheme == "http" || url.scheme == "https" {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url,
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        if prompt == "__CQIE_TOKEN__" {
            completionHandler(TokenStore.hasValidAccessToken ? TokenStore.accessToken : "")
        } else {
            completionHandler(nil)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "cqieBridge",
              let payload = message.body as? [String: Any],
              let id = payload["id"] as? NSNumber,
              let method = payload["method"] as? String else { return }
        let args = payload["args"] as? [Any] ?? []

        switch method {
        case "http":
            guard args.count >= 4 else {
                reply(id: id, value: "__KBT_ERR__0\ninvalid bridge arguments")
                return
            }
            NativeHTTP.perform(
                method: args[0] as? String ?? "GET",
                urlString: args[1] as? String ?? "",
                bearer: args[2] as? String ?? "",
                body: args[3] as? String ?? ""
            ) { [weak self] result in
                DispatchQueue.main.async { self?.reply(id: id, value: result) }
            }

        case "ensureToken":
            ensureToken { [weak self] token in self?.reply(id: id, value: token) }

        case "relogin":
            beginLogin(reloadOnSuccess: true) { [weak self] token in
                self?.reply(id: id, value: token)
            }

        case "logout":
            logout { [weak self] in self?.reply(id: id, value: true) }

        default:
            reply(id: id, value: NSNull(), error: "unknown method")
        }
    }

    private func ensureToken(completion: @escaping (String) -> Void) {
        if TokenStore.hasValidAccessToken {
            completion(TokenStore.accessToken)
            return
        }
        OAuthService.refresh { [weak self] token in
            DispatchQueue.main.async {
                if let token {
                    completion(token)
                } else {
                    self?.beginLogin(reloadOnSuccess: false, completion: completion)
                }
            }
        }
    }

    private func beginLogin(reloadOnSuccess: Bool, completion: ((String) -> Void)?) {
        if let completion { loginWaiters.append(completion) }
        guard !loginInProgress else { return }
        loginInProgress = true

        let login = LoginViewController { [weak self] token in
            guard let self else { return }
            self.loginInProgress = false
            let result = token ?? ""
            let waiters = self.loginWaiters
            self.loginWaiters.removeAll()
            waiters.forEach { $0(result) }
            if token != nil, reloadOnSuccess { self.loadContent() }
        }
        let navigation = UINavigationController(rootViewController: login)
        navigation.modalPresentationStyle = .fullScreen
        present(navigation, animated: true)
    }

    private func logout(completion: @escaping () -> Void) {
        TokenStore.clear()
        let dataStore = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        dataStore.fetchDataRecords(ofTypes: types) { records in
            let cqieRecords = records.filter { $0.displayName.contains("cqie.edu.cn") }
            let finish = { DispatchQueue.main.async(execute: completion) }
            guard !cqieRecords.isEmpty else {
                HTTPCookieStorage.shared.removeCookies(since: .distantPast)
                finish()
                return
            }
            dataStore.removeData(ofTypes: types, for: cqieRecords) {
                HTTPCookieStorage.shared.removeCookies(since: .distantPast)
                finish()
            }
        }
    }

    private func reply(id: NSNumber, value: Any, error: String? = nil) {
        guard let valueJSON = Self.jsonLiteral(value),
              let errorJSON = Self.jsonLiteral(error ?? NSNull()) else { return }
        let script = "window.__cqieBridgeReply(\(id.intValue),\(valueJSON),\(errorJSON));"
        webView.evaluateJavaScript(script)
    }

    private static func jsonLiteral(_ value: Any) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static let bridgeScript = #"""
    (() => {
      const pending = new Map();
      let nextId = 1;
      const call = (method, args = []) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.cqieBridge.postMessage({ id, method, args });
      });
      window.__cqieBridgeReply = (id, value, error) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id);
        if (error) item.reject(new Error(error)); else item.resolve(value);
      };
      window.Android = {
        platform: () => "ios",
        token: () => window.prompt("__CQIE_TOKEN__", "") || "",
        ensureToken: () => call("ensureToken"),
        relogin: () => call("relogin"),
        logout: () => call("logout"),
        http: (method, url, bearer, body) => call("http", [method, url, bearer, body])
      };
    })();
    """#
}
