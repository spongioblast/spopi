// ABOUTME: The SPOPI-styled frame for the phone's pairing and status pages.
// ABOUTME: Self-contained: these pages load before the phone may fetch the app's stylesheets.

/// Dawn, SPOPI's default theme, inlined so the page needs no other request.
const STYLE: &str = r#"
:root{color-scheme:dark;--bg:#1a1d26;--glass:rgba(255,255,255,.04);--glass-hover:rgba(255,255,255,.07);--border:rgba(255,255,255,.08);--border-hover:rgba(255,255,255,.13);--text:rgba(255,255,255,.9);--muted:rgba(255,255,255,.55);--accent:#7a8ab0;--accent-glow:rgba(122,138,176,.2);--accent-text:#a0b4d8;--error:#f87171;--success:#34d399}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text)}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",system-ui,Roboto,"Noto Sans","Helvetica Neue",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:24px}
.card{width:100%;max-width:26rem;padding:24px;background:var(--glass);border:1px solid var(--border);border-radius:16px}
.brand{display:flex;align-items:center;gap:8px;margin:0 0 16px;color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.brand::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-glow)}
h1{margin:0 0 8px;font-size:20px;font-weight:600;line-height:1.25}
p{margin:0 0 16px;color:var(--muted)}
p:last-child{margin-bottom:0}
label{display:grid;gap:6px;margin:0 0 16px;color:var(--muted);font-size:12px}
input{width:100%;padding:10px 12px;font:inherit;font-size:16px;color:var(--text);background:var(--glass);border:1px solid var(--border);border-radius:10px;outline:none}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
button{width:100%;padding:12px 16px;font:inherit;font-weight:600;color:var(--bg);background:var(--accent);border:0;border-radius:10px;cursor:pointer}
button:active{filter:brightness(1.1)}
button:disabled{opacity:.5;cursor:default}
.status{display:flex;align-items:flex-start;gap:10px;margin:16px 0 0;color:var(--muted)}
.status:empty{display:none}
.status[data-state="wait"]::before{content:"";flex:none;width:14px;height:14px;margin-top:3px;border:2px solid var(--border-hover);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
.status[data-state="error"]{color:var(--error)}
.status[data-state="ok"]{color:var(--success)}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.status[data-state="wait"]::before{animation:none}}
"#;

/// A full page: the card holds `body`, under the SPOPI mark.
pub(super) fn shell(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"theme-color\" content=\"#1a1d26\"><title>{title} · SPOPI</title><style>{STYLE}</style></head><body><main class=\"card\"><div class=\"brand\">SPOPI</div>{body}</main></body></html>"
    )
}

/// A page that only says something: a heading and one paragraph, both plain text.
pub(super) fn message(title: &str, text: &str) -> String {
    let title = escape(title);
    shell(&title, &format!("<h1>{title}</h1><p>{}</p>", escape(text)))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::{message, shell};

    #[test]
    fn message_text_is_not_markup() {
        let page = message("A <b>", "x & <script>y</script>");
        assert!(page.contains("<h1>A &lt;b&gt;</h1><p>x &amp; &lt;script&gt;y&lt;/script&gt;</p>"));
        assert!(!page.contains("<script>"));
    }

    #[test]
    fn pages_carry_the_spopi_frame() {
        let page = message("Not paired", "Pair it again.");
        assert!(page.contains("<title>Not paired · SPOPI</title>"));
        assert!(page.contains("class=\"card\""));
        assert!(page.contains("<h1>Not paired</h1><p>Pair it again.</p>"));
        assert!(page.contains("--accent:#7a8ab0"));
        assert!(shell("Pair", "<form></form>").contains("<form></form></main>"));
    }
}
