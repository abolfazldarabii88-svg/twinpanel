#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

fn place_notch(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();
        let scale = monitor.scale_factor();
        let width = (184.0 * scale).round() as u32;
        let x = position.x + (size.width.saturating_sub(width) / 2) as i32;
        // Anchor the notch to the actual top edge of the display.
        let _ = window.set_position(PhysicalPosition::new(x, position.y));
    }
    let _ = window.set_size(LogicalSize::new(184.0, 46.0));
    let _ = window.set_always_on_top(true);
}

#[cfg(target_os = "windows")]
fn track_global_cursor(app: tauri::AppHandle, window: &WebviewWindow) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let monitor = window.current_monitor().ok().flatten();
    let (origin_x, origin_y, screen_width, scale) = match monitor {
        Some(monitor) => {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x as f64,
                position.y as f64,
                size.width as f64,
                monitor.scale_factor(),
            )
        }
        None => return,
    };

    std::thread::spawn(move || loop {
        let mut point = POINT { x: 0, y: 0 };
        let ok = unsafe { GetCursorPos(&mut point) };
        if ok != 0 {
            let cursor_x = (point.x as f64 - origin_x) / scale;
            let cursor_y = (point.y as f64 - origin_y) / scale;
            let logical_width = screen_width / scale;
            let gaze_x = ((cursor_x - logical_width / 2.0) / 22.0).clamp(-5.0, 5.0);
            let gaze_y = ((cursor_y - 23.0) / 16.0).clamp(-3.0, 3.0);
            let _ = app.emit("pisho-gaze", [gaze_x, gaze_y]);
        }
        std::thread::sleep(std::time::Duration::from_millis(24));
    });
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                place_notch(&window);
                #[cfg(target_os = "windows")]
                track_global_cursor(app.handle().clone(), &window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pisho Notch");
}
