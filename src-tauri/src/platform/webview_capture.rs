// ABOUTME: Captures a PNG of what a SPOPI window shows, through the WebView itself.
// ABOUTME: Windows uses WebView2, macOS uses WKWebView, and Linux uses WebKitGTK. None opens a debug port.

use std::time::Duration;

#[derive(Debug)]
pub enum CaptureError {
    #[cfg_attr(
        any(windows, target_os = "macos", target_os = "linux"),
        allow(dead_code)
    )]
    Unsupported,
    #[cfg_attr(
        not(any(windows, target_os = "macos", target_os = "linux")),
        allow(dead_code)
    )]
    Failed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => write!(f, "screenshots are not available on this system"),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);

/// `Page.captureScreenshot` answers `{"data":"<base64 png>"}`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn png_from_devtools_json(json: &str) -> Result<Vec<u8>, CaptureError> {
    use base64::Engine;
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| CaptureError::Failed(format!("unreadable capture reply: {error}")))?;
    let data = value
        .get("data")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| CaptureError::Failed("capture reply has no image".into()))?;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| CaptureError::Failed(format!("capture image is not base64: {error}")))
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
async fn await_capture<T>(
    rx: tokio::sync::oneshot::Receiver<Result<T, String>>,
) -> Result<T, CaptureError> {
    tokio::time::timeout(CAPTURE_TIMEOUT, rx)
        .await
        .map_err(|_| CaptureError::Failed("the window did not answer in time".into()))?
        .map_err(|_| CaptureError::Failed("the window closed before answering".into()))?
        .map_err(CaptureError::Failed)
}

#[cfg(windows)]
pub async fn capture_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, CaptureError> {
    use std::sync::{Arc, Mutex};
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = move |result: Result<String, String>| {
        if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = tx.send(result);
        }
    };
    let on_ui_thread = send.clone();
    window
        .with_webview(move |webview| {
            let fail = on_ui_thread.clone();
            let done = on_ui_thread.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result, json| {
                    done(result.map(|()| json).map_err(|error| error.to_string()));
                    Ok(())
                },
            ));
            // SAFETY: the controller belongs to this window and is used on its UI thread,
            // which is where `with_webview` runs this closure.
            let started = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from("Page.captureScreenshot"),
                        &HSTRING::from(r#"{"format":"png"}"#),
                        &handler,
                    )
                })
            };
            if let Err(error) = started {
                fail(Err(error.to_string()));
            }
        })
        .map_err(|error| CaptureError::Failed(error.to_string()))?;
    png_from_devtools_json(&await_capture(rx).await?)
}

#[cfg(target_os = "macos")]
pub async fn capture_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, CaptureError> {
    use std::sync::{Arc, Mutex};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = move |result: Result<Vec<u8>, String>| {
        if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = tx.send(result);
        }
    };
    window
        .with_webview(move |webview| macos_snapshot(webview, send))
        .map_err(|error| CaptureError::Failed(error.to_string()))?;
    await_capture(rx).await
}

#[cfg(target_os = "macos")]
fn macos_snapshot(
    webview: tauri::webview::PlatformWebview,
    send: impl Fn(Result<Vec<u8>, String>) + Send + 'static,
) {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::NSError;
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    // `with_webview` consumed one retain. Take it back so this closure's drop
    // releases it on the main thread; the window keeps its own retain.
    let Some(view) = (unsafe { Retained::<WKWebView>::from_raw(webview.inner().cast()) }) else {
        send(Err("the window has no web view".into()));
        return;
    };
    let Some(marker) = MainThreadMarker::new() else {
        send(Err("screenshot must run on the main thread".into()));
        return;
    };
    // Default rect is the view bounds. The default waits until the latest
    // page updates are on screen, which is the picture the user is looking at.
    let config = unsafe { WKSnapshotConfiguration::new(marker) };
    let handler = RcBlock::new(
        move |image: *mut objc2_app_kit::NSImage, error: *mut NSError| {
            send(macos_png(image, error));
        },
    );
    // SAFETY: `view` is the window's WKWebView, this runs on the main thread,
    // and the block only borrows the image and error for this call.
    unsafe {
        view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    }
}

#[cfg(target_os = "macos")]
fn macos_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey};
    use objc2_foundation::NSDictionary;

    if !error.is_null() {
        // SAFETY: a non-null error from this callback is a live NSError for the call.
        let message = unsafe { &*error }.localizedDescription().to_string();
        return Err(message);
    }
    if image.is_null() {
        return Err("capture reply has no image".into());
    }
    // SAFETY: a non-null image from this callback is a live NSImage for the call.
    let image = unsafe { &*image };
    let Some(tiff) = image.TIFFRepresentation() else {
        return Err("capture image could not be read".into());
    };
    let Some(rep) = NSBitmapImageRep::imageRepWithData(&tiff) else {
        return Err("capture image could not be read".into());
    };
    let properties = NSDictionary::<NSBitmapImageRepPropertyKey, AnyObject>::dictionary();
    // SAFETY: `properties` is empty, so it contains no mistyped values.
    let Some(png) = (unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }) else {
        return Err("capture image could not be encoded".into());
    };
    let bytes = nsdata_bytes(&png);
    if bytes.starts_with(b"\x89PNG") {
        Ok(bytes)
    } else {
        Err("capture was not a PNG".into())
    }
}

#[cfg(target_os = "macos")]
fn nsdata_bytes(data: &objc2_foundation::NSData) -> Vec<u8> {
    use std::ptr::NonNull;

    let length = data.length();
    let size = usize::try_from(length).unwrap_or(0);
    if size == 0 {
        return Vec::new();
    }
    let mut bytes = vec![0u8; size];
    // SAFETY: `bytes` is `size` long, and `size` is `NSData`'s length.
    unsafe {
        data.getBytes_length(NonNull::new(bytes.as_mut_ptr().cast()).unwrap(), length);
    }
    bytes
}

#[cfg(target_os = "linux")]
pub async fn capture_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, CaptureError> {
    use std::sync::{Arc, Mutex};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = move |result: Result<Vec<u8>, String>| {
        if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = tx.send(result);
        }
    };
    window
        .with_webview(move |webview| {
            use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

            let view = webview.inner();
            // Runs on the GTK main thread, which owns the context this call requires.
            // Visible is the page on screen, including the selection the user sees.
            view.snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::INCLUDE_SELECTION_HIGHLIGHTING,
                None::<&gio::Cancellable>,
                move |result| {
                    send(match result {
                        Ok(surface) => png_from_cairo(surface),
                        Err(error) => Err(error.to_string()),
                    });
                },
            );
        })
        .map_err(|error| CaptureError::Failed(error.to_string()))?;
    await_capture(rx).await
}

#[cfg(target_os = "linux")]
fn png_from_cairo(surface: cairo::Surface) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    surface
        .write_to_png(&mut png)
        .map_err(|error| format!("could not encode the snapshot: {error}"))?;
    if png.starts_with(b"\x89PNG") {
        Ok(png)
    } else {
        Err("capture was not a PNG".into())
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub async fn capture_png(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devtools_reply_decodes_to_png_bytes() {
        let png = png_from_devtools_json(r#"{"data":"iVBORw0KGgo="}"#).unwrap();
        assert_eq!(&png[..4], b"\x89PNG");
        assert!(png_from_devtools_json(r#"{"nope":1}"#).is_err());
        assert!(png_from_devtools_json("not json").is_err());
    }
}
