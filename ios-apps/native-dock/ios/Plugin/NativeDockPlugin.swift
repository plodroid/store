import Foundation
import Capacitor
import UIKit

/// The bottom bar of the app as a real UITabBar. Built with the iOS 26 SDK and run on iOS 26 it sits in a Liquid Glass capsule
/// (UIGlassEffect); on iOS 13–25 it is the normal system tab bar. The page decides what the items are and what happens on a tap.
@objc(NativeDockPlugin)
public class NativeDockPlugin: CAPPlugin, UITabBarDelegate {
    private var host: UIView?
    private var bar: UITabBar?
    private var capsule = false
    private var ids: [Int: String] = [:]
    private var more: [String: [[String: String]]] = [:]
    private var shownId = ""

    @objc func update(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.apply(call) }
    }

    private func apply(_ call: CAPPluginCall) {
        guard let vc = bridge?.viewController, let list = call.getArray("items") as? [[String: Any]] else { call.reject("bad arguments"); return }
        build(in: vc)
        guard let host = host, let bar = bar else { call.reject("no bar"); return }
        if call.getBool("hidden") ?? false {
            host.isHidden = true
            call.resolve(["height": 0]); return
        }
        host.isHidden = false
        if let tint = call.getString("tint"), let c = Self.color(tint) { bar.tintColor = c }

        var items: [UITabBarItem] = []
        ids.removeAll(); more.removeAll()
        for (i, it) in list.enumerated() {
            let id = it["id"] as? String ?? "\(i)"
            let image = UIImage(systemName: it["symbol"] as? String ?? "circle") ?? UIImage(systemName: "circle")
            let item = UITabBarItem(title: it["title"] as? String, image: image, tag: i)
            if let n = it["badge"] as? Int, n > 0 { item.badgeValue = String(n) }
            else if let s = it["badge"] as? String, !s.isEmpty, s != "0" { item.badgeValue = s }
            if let m = it["more"] as? [[String: String]] { more[id] = m }
            ids[i] = id
            items.append(item)
        }
        bar.setItems(items, animated: false)
        shownId = call.getString("selected") ?? ""
        bar.selectedItem = items.first { ids[$0.tag] == shownId }

        vc.view.layoutIfNeeded()
        host.superview?.bringSubviewToFront(host)
        call.resolve(["height": max(0, Double(vc.view.bounds.height - host.frame.minY)), "glass": capsule])
    }

    private func build(in vc: UIViewController) {
        if bar != nil { return }
        let bar = UITabBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        var host: UIView = UIView()
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect()
            glass.isInteractive = true
            let v = UIVisualEffectView(effect: glass)
            v.layer.cornerRadius = 32
            v.layer.cornerCurve = .continuous
            v.clipsToBounds = true
            v.contentView.addSubview(bar)
            let clear = UITabBarAppearance()
            clear.configureWithTransparentBackground()
            bar.standardAppearance = clear
            bar.scrollEdgeAppearance = clear
            host = v
            capsule = true
        }
        #endif
        if !capsule { host.addSubview(bar) }
        host.translatesAutoresizingMaskIntoConstraints = false
        vc.view.addSubview(host)
        if capsule {
            NSLayoutConstraint.activate([
                bar.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: 6),
                bar.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -6),
                bar.topAnchor.constraint(equalTo: host.topAnchor),
                bar.heightAnchor.constraint(equalToConstant: 64),
                host.heightAnchor.constraint(equalToConstant: 64),
                host.leadingAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.leadingAnchor, constant: 18),
                host.trailingAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.trailingAnchor, constant: -18),
                host.bottomAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.bottomAnchor, constant: -6),
            ])
        } else {
            NSLayoutConstraint.activate([
                bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                bar.topAnchor.constraint(equalTo: host.topAnchor),
                bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                host.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
                host.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
                host.bottomAnchor.constraint(equalTo: vc.view.bottomAnchor),
            ])
        }
        self.bar = bar
        self.host = host
    }

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard let id = ids[item.tag] else { return }
        if let choices = more[id], let vc = bridge?.viewController {
            let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
            for c in choices {
                sheet.addAction(UIAlertAction(title: c["title"], style: .default) { _ in
                    self.notifyListeners("tap", data: ["id": c["id"] ?? ""])
                })
            }
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                tabBar.selectedItem = tabBar.items?.first { self.ids[$0.tag] == self.shownId }
            })
            if let pop = sheet.popoverPresentationController { pop.sourceView = tabBar; pop.sourceRect = tabBar.bounds }
            (vc.presentedViewController ?? vc).present(sheet, animated: true)
            return
        }
        notifyListeners("tap", data: ["id": id])
    }

    private static func color(_ hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let n = UInt32(s, radix: 16) else { return nil }
        return UIColor(red: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: 1)
    }
}
