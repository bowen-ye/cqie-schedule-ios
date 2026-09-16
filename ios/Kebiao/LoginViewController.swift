import UIKit
import WebKit

final class LoginViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var authorizeRedirects = 0
    private var isExchanging = false
    private let completion: (String?) -> Void

    init(completion: @escaping (String?) -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        title = "官方账号登录"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(cancelLogin)
        )

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        webView.load(URLRequest(url: AppConfig.casStartURL))
    }

    @objc private func cancelLogin() {
        dismiss(animated: true) { self.completion(nil) }
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
        let absolute = url.absoluteString

        if absolute.contains("/workspace/cas"), authorizeRedirects < 4 {
            authorizeRedirects += 1
            decisionHandler(.cancel)
            webView.load(URLRequest(url: AppConfig.authorizeURL))
            return
        }

        if absolute.contains("/workspace/token-index"),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
           !code.isEmpty,
           !isExchanging {
            isExchanging = true
            decisionHandler(.cancel)
            exchange(code: code)
            return
        }
        decisionHandler(.allow)
    }

    private func exchange(code: String) {
        OAuthService.exchange(code: code) { [weak self] token in
            DispatchQueue.main.async {
                guard let self else { return }
                if let token {
                    self.dismiss(animated: true) { self.completion(token) }
                } else {
                    self.isExchanging = false
                    self.authorizeRedirects = 0
                    let alert = UIAlertController(
                        title: "登录未完成",
                        message: "账号验证成功，但换取登录凭证失败。请检查网络后重试。",
                        preferredStyle: .alert
                    )
                    alert.addAction(UIAlertAction(title: "重试", style: .default) { _ in
                        self.webView.load(URLRequest(url: AppConfig.casStartURL))
                    })
                    self.present(alert, animated: true)
                }
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }
}
