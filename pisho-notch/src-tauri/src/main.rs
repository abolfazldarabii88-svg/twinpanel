#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

fn place_notch(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let width = (200.0 * scale) as i32;
        let x = ((size.width as i32 - width) / 2).max(0);
        let _ = window.set_position(PhysicalPosition::new(x, (10.0 * scale) as i32));
    }
    let _ = window.set_size(PhysicalSize::new(200, 72));
    let _ = window.set_always_on_top(true);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                place_notch(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pisho Notch");
}
