import UIKit
import UniformTypeIdentifiers

// Hands one shared image to the app: copies it into the App Group, records it
// where @capgo/capacitor-share-target looks, and opens the app. The image is
// never decoded here, since a share extension gets little memory.
class ShareViewController: UIViewController {
    private let appGroup = "group.me.akshath.unsettled"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
        guard let (provider, type) = providers.lazy.compactMap({ provider in Self.imageType(provider).map { (provider, $0) } }).first
        else { return finish() }
        let done = { (saved: Bool) in
            DispatchQueue.main.async {
                if saved { self.open(URL(string: "unsettled://share")!) }
                self.finish()
            }
        }
        provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
            // The provided file is deleted when this callback returns, so it is copied inside it.
            if let url { return done(self.save(type: type, name: url.lastPathComponent) { try FileManager.default.copyItem(at: url, to: $0) }) }
            // A host holding the image in memory (the screenshot markup screen) offers bytes, not a file.
            provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                done(data.map { data in self.save(type: type, name: "Screenshot.\(type.preferredFilenameExtension ?? "png")") { try data.write(to: $0) } } ?? false)
            }
        }
    }

    // PNG or JPEG when the host offers either, since WebKit decodes HEIC only from iOS 17.
    private static func imageType(_ provider: NSItemProvider) -> UTType? {
        let types = provider.registeredTypeIdentifiers.compactMap(UTType.init)
        return types.first { $0 == .png || $0 == .jpeg } ?? types.first { $0.conforms(to: .image) }
    }

    private func save(type: UTType, name: String, write: (URL) throws -> Void) -> Bool {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return false }
        // One pending share at a time: the folder is emptied before each copy, so files never pile up.
        let folder = container.appendingPathComponent("shared", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        let target = folder.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try write(target)
        } catch { return false }
        let file: [String: Any] = ["uri": target.absoluteString, "name": name, "mimeType": type.preferredMIMEType ?? "image/png"]
        UserDefaults(suiteName: appGroup)?.set(["title": "", "texts": [String](), "files": [file]], forKey: "share-target-data")
        return true
    }

    // iOS gives extensions no API to open their app; UIApplication is reached
    // through the responder chain instead.
    private func open(_ url: URL) {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
