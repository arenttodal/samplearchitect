/* ipc.js — Thin wrappers over Tauri commands that move raw bytes */

function tauriInvoke(cmd, args, options) {
  return window.__TAURI__.core.invoke(cmd, args, options);
}

/* Returns an ArrayBuffer (read_file_bytes responds with raw bytes). */
async function readFileBytes(path) {
  var r = await tauriInvoke('read_file_bytes', { path: path });
  return r instanceof ArrayBuffer ? r : new Uint8Array(r).buffer;
}

/* Sends bytes as the raw request body; the path travels in a header. */
function writeFileBytes(path, bytes) {
  var body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return tauriInvoke('write_file_bytes', body, {
    headers: { 'x-path': encodeURIComponent(path) }
  });
}
