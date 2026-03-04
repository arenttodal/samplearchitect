#[tauri::command]
async fn chat_with_claude(
    api_key: String,
    messages: String,
    system_prompt: String,
) -> Result<String, String> {
    let messages_val: serde_json::Value = serde_json::from_str(&messages)
        .map_err(|e| format!("Invalid messages JSON: {}", e))?;

    let body = serde_json::json!({
        "model": "claude-sonnet-4-5-20250929",
        "max_tokens": 2048,
        "system": system_prompt,
        "messages": messages_val
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let resp_body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    if !status.is_success() {
        let err_msg = resp_body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("API error ({}): {}", status.as_u16(), err_msg));
    }

    resp_body["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in response".to_string())
}

#[tauri::command]
fn read_dir_recursive(path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_wav_files(&std::path::Path::new(&path), &mut files)
        .map_err(|e| e.to_string())?;
    Ok(files)
}

fn collect_wav_files(dir: &std::path::Path, files: &mut Vec<String>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if !name.starts_with('.') {
                    collect_wav_files(&path, files)?;
                }
            } else {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if !name.starts_with('.') && name.to_lowercase().ends_with(".wav") {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            chat_with_claude,
            read_dir_recursive,
            copy_file,
            write_text_file,
            create_directory,
            read_file_bytes,
            write_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
