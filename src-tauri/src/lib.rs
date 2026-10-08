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

/// Returns raw bytes (an ArrayBuffer in JS) instead of a JSON number array.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Takes the file contents as the raw request body and the destination as a
/// URL-encoded `x-path` header, so large WAVs don't go through JSON.
#[tauri::command]
fn write_file_bytes(request: tauri::ipc::Request) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_file_bytes expects a raw byte body".into());
    };
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("write_file_bytes: missing x-path header")?;
    let path = percent_decode(encoded)?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| format!("bad escape %{}", hex))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[derive(serde::Serialize, Debug, PartialEq)]
struct WavInfo {
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    format_tag: u16,
    duration_secs: f64,
}

/// Reads only the RIFF chunk headers of a WAV file.
fn wav_info(path: &std::path::Path) -> Result<WavInfo, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let file_len = f.metadata().map_err(|e| e.to_string())?.len();
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff)
        .map_err(|_| "Not a WAV file (too short)".to_string())?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("Not a WAV file (missing RIFF/WAVE header)".into());
    }
    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    let mut data_len: Option<u64> = None;
    let mut pos: u64 = 12;
    while pos + 8 <= file_len {
        f.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
        let mut hdr = [0u8; 8];
        f.read_exact(&mut hdr).map_err(|e| e.to_string())?;
        let size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as u64;
        match &hdr[0..4] {
            b"fmt " => {
                let mut b = [0u8; 16];
                f.read_exact(&mut b)
                    .map_err(|_| "WAV fmt chunk is truncated".to_string())?;
                fmt = Some((
                    u16::from_le_bytes([b[0], b[1]]),
                    u16::from_le_bytes([b[2], b[3]]),
                    u32::from_le_bytes([b[4], b[5], b[6], b[7]]),
                    u16::from_le_bytes([b[14], b[15]]),
                ));
            }
            b"data" => data_len = Some(size.min(file_len - pos - 8)),
            _ => {}
        }
        if fmt.is_some() && data_len.is_some() {
            break;
        }
        pos += 8 + size + (size % 2);
    }
    let (format_tag, channels, sample_rate, bits_per_sample) =
        fmt.ok_or("WAV has no fmt chunk")?;
    let data_len = data_len.ok_or("WAV has no data chunk")?;
    if channels == 0 || sample_rate == 0 || bits_per_sample == 0 {
        return Err("WAV header has zero channels, rate or bit depth".into());
    }
    let frame = channels as u64 * (bits_per_sample as u64 / 8).max(1);
    Ok(WavInfo {
        sample_rate,
        channels,
        bits_per_sample,
        format_tag,
        duration_secs: data_len as f64 / frame as f64 / sample_rate as f64,
    })
}

#[tauri::command]
fn read_wav_info(path: String) -> Result<WavInfo, String> {
    wav_info(std::path::Path::new(&path))
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
            write_file_bytes,
            read_wav_info,
            path_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(rate: u32, bits: u16, channels: u16, frames: u32, extra_chunk: bool) -> Vec<u8> {
        let block = channels * bits / 8;
        let data_len = frames * block as u32;
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&0u32.to_le_bytes());
        v.extend_from_slice(b"WAVE");
        if extra_chunk {
            // odd-sized chunk to exercise pad-byte handling
            v.extend_from_slice(b"LIST");
            v.extend_from_slice(&3u32.to_le_bytes());
            v.extend_from_slice(&[1, 2, 3, 0]);
        }
        v.extend_from_slice(b"fmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&channels.to_le_bytes());
        v.extend_from_slice(&rate.to_le_bytes());
        v.extend_from_slice(&(rate * block as u32).to_le_bytes());
        v.extend_from_slice(&block.to_le_bytes());
        v.extend_from_slice(&bits.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&data_len.to_le_bytes());
        v.extend(std::iter::repeat(0u8).take(data_len as usize));
        v
    }

    fn tmp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("sa-test-{}-{}", std::process::id(), name));
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn reads_basic_wav() {
        let p = tmp("a.wav", &wav_bytes(48000, 24, 2, 48000, false));
        let info = wav_info(&p).unwrap();
        assert_eq!(info.sample_rate, 48000);
        assert_eq!(info.bits_per_sample, 24);
        assert_eq!(info.channels, 2);
        assert!((info.duration_secs - 1.0).abs() < 1e-9);
    }

    #[test]
    fn skips_odd_sized_chunks() {
        let p = tmp("b.wav", &wav_bytes(44100, 16, 1, 22050, true));
        let info = wav_info(&p).unwrap();
        assert_eq!(info.sample_rate, 44100);
        assert!((info.duration_secs - 0.5).abs() < 1e-9);
    }

    #[test]
    fn rejects_non_wav() {
        let p = tmp("c.wav", b"this is not audio at all");
        assert!(wav_info(&p).is_err());
        let p = tmp("d.wav", b"RIF");
        assert!(wav_info(&p).is_err());
    }

    #[test]
    fn percent_decodes_paths() {
        assert_eq!(percent_decode("%2Fa%20b%2F%C3%A6.wav").unwrap(), "/a b/\u{e6}.wav");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
        assert!(percent_decode("%zz").is_err());
    }
}
