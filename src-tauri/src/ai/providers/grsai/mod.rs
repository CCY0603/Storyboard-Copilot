use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Cursor;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;
use base64::{engine::general_purpose::STANDARD, Engine};
use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

const DRAW_ENDPOINT_PATH: &str = "/v1/draw/nano-banana";
const GPT_IMAGE_DRAW_ENDPOINT_PATH: &str = "/v1/draw/completions";
const RESULT_ENDPOINT_PATH: &str = "/v1/draw/result";
const DEFAULT_BASE_URL: &str = "https://grsai.dakka.com.cn";
const DEFAULT_PRO_MODEL: &str = "nano-banana-pro";
const POLL_INTERVAL_MS: u64 = 2000;

const REF_IMAGE_MAX_DIMENSION: u32 = 512;
const REF_IMAGE_JPEG_QUALITY: u8 = 60;

const SUPPORTED_MODELS: [&str; 9] = [
    "nano-banana-2",
    "nano-banana-pro",
    "nano-banana-pro-vt",
    "nano-banana-pro-cl",
    "nano-banana-pro-vip",
    "nano-banana-pro-4k-vip",
    "grsai/nano-banana-pro",
    "gpt-image-2",
    "gpt-image-2-vip",
];

fn debug_log(msg: &str) {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(r"C:\Users\10840\Desktop\grsai_debug.log")
    {
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
    eprintln!("[GRSAI-DEBUG] {}", msg);
}

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let normalized = if decoded.starts_with('/')
        && decoded.len() > 2
        && decoded.as_bytes().get(2) == Some(&b':')
    {
        &decoded[1..]
    } else {
        &decoded
    };
    normalized.to_string()
}

fn encode_reference_for_grsai(source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return Some(payload.to_string());
        }
    }
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return Some(trimmed.to_string());
    }
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    let bytes = std::fs::read(path).ok()?;
    Some(STANDARD.encode(bytes))
}

fn encode_reference_for_gpt_image(source: &str) -> Result<String, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Empty source".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    let raw_bytes = if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            STANDARD.decode(payload).map_err(|e| format!("Base64 decode error: {}", e))?
        } else {
            return Err("Invalid data URI".to_string());
        }
    } else {
        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            STANDARD.decode(trimmed).map_err(|e| format!("Base64 decode error: {}", e))?
        } else {
            let path = if trimmed.starts_with("file://") {
                PathBuf::from(decode_file_url_path(trimmed))
            } else {
                PathBuf::from(trimmed)
            };
            std::fs::read(&path).map_err(|e| format!("File read error: {}", e))?
        }
    };

    debug_log(&format!("Raw image bytes: {}", raw_bytes.len()));
    compress_reference_image(&raw_bytes)
}

fn compress_reference_image(raw_bytes: &[u8]) -> Result<String, String> {
    let img = image::ImageReader::new(Cursor::new(raw_bytes))
        .with_guessed_format()
        .map_err(|e| format!("Format guess error: {}", e))?
        .decode()
        .map_err(|e| format!("Decode error: {}", e))?;

    let (w, h) = (img.width(), img.height());
    debug_log(&format!("Original image: {}x{}", w, h));

    let resized = if w > REF_IMAGE_MAX_DIMENSION || h > REF_IMAGE_MAX_DIMENSION {
        let ratio = (REF_IMAGE_MAX_DIMENSION as f64 / w.max(h) as f64).min(1.0);
        let new_w = (w as f64 * ratio) as u32;
        let new_h = (h as f64 * ratio) as u32;
        debug_log(&format!("Resizing to {}x{}", new_w, new_h));
        img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let rgb_image = resized.to_rgb8();
    let mut jpeg_buf = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, REF_IMAGE_JPEG_QUALITY);
    encoder.encode(
        rgb_image.as_raw(),
        rgb_image.width(),
        rgb_image.height(),
        image::ExtendedColorType::Rgb8,
    ).map_err(|e| format!("JPEG encode error: {}", e))?;

    let jpeg_bytes = jpeg_buf.into_inner();
    let b64 = STANDARD.encode(&jpeg_bytes);
    // Add data URI prefix so GRSAI server recognizes this as image data
    let data_uri = format!("data:image/jpeg;base64,{}", b64);
    debug_log(&format!("Compressed: {} bytes -> {} bytes JPEG -> {} chars data_uri", raw_bytes.len(), jpeg_bytes.len(), data_uri.len()));

    Ok(data_uri)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawRequestBody {
    model: String,
    prompt: String,
    aspect_ratio: String,
    image_size: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    urls: Option<Vec<String>>,
    web_hook: String,
    shut_progress: bool,
}

fn parse_sse_last_event(text: &str) -> Option<Value> {
    let mut last_data: Option<Value> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(data_str) = trimmed.strip_prefix("data:") {
            let data_str = data_str.trim();
            if data_str.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data_str) {
                last_data = Some(v);
            }
        } else if !trimmed.starts_with(':') && !trimmed.is_empty() {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                last_data = Some(v);
            }
        }
    }
    last_data
}

pub struct GrsaiProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl GrsaiProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .no_proxy()
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    fn normalize_requested_model(&self, request: &GenerateRequest) -> String {
        let requested = request
            .model
            .split_once('/')
            .map(|(_, model)| model.to_string())
            .unwrap_or_else(|| request.model.clone());

        if requested == "gpt-image-2" || requested == "gpt-image-2-vip" {
            return requested;
        }

        if requested == "nano-banana-2" {
            return requested;
        }

        if requested == "nano-banana-pro" || requested.starts_with("nano-banana-pro-") {
            return request
                .extra_params
                .as_ref()
                .and_then(|params| params.get("grsai_pro_model"))
                .and_then(|value| value.as_str())
                .map(Self::normalize_pro_variant)
                .unwrap_or_else(|| requested);
        }

        DEFAULT_PRO_MODEL.to_string()
    }

    fn normalize_pro_variant(input: &str) -> String {
        let trimmed = input.trim().to_lowercase();
        if trimmed == DEFAULT_PRO_MODEL || trimmed.starts_with("nano-banana-pro-") {
            return trimmed;
        }
        DEFAULT_PRO_MODEL.to_string()
    }

    fn resolve_task_payload<'a>(value: &'a Value) -> Result<&'a Value, AIError> {
        if let Some(code) = value.get("code").and_then(|raw| raw.as_i64()) {
            if code != 0 {
                let msg = value
                    .get("msg")
                    .and_then(|raw| raw.as_str())
                    .unwrap_or("unknown error");
                return Err(AIError::Provider(format!("GRSAI API code {}: {}", code, msg)));
            }
            return value
                .get("data")
                .ok_or_else(|| AIError::Provider("GRSAI response missing data field".to_string()));
        }
        Ok(value)
    }

    fn extract_result_url(payload: &Value) -> Option<String> {
        payload
            .get("results")
            .and_then(|results| results.as_array())
            .and_then(|results| results.first())
            .and_then(|first| first.get("url"))
            .and_then(|url| url.as_str())
            .map(|url| url.to_string())
    }

    fn resolve_resolution_from_size(size: &str) -> String {
        let lower = size.to_lowercase();
        if lower.contains("4k") {
            "4k".to_string()
        } else if lower.contains("2k") {
            "2k".to_string()
        } else {
            "1k".to_string()
        }
    }

    async fn request_draw(&self, request: &GenerateRequest, model: String) -> Result<Value, AIError> {
        let is_gpt_image = model.starts_with("gpt-image-2");
        let endpoint_path = if is_gpt_image {
            GPT_IMAGE_DRAW_ENDPOINT_PATH
        } else {
            DRAW_ENDPOINT_PATH
        };

        let endpoint = format!("{}{}", self.base_url, endpoint_path);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        if is_gpt_image {
            debug_log("=== GPT-IMAGE REQUEST START ===");
            debug_log(&format!("Model: {}", model));
            debug_log(&format!("Has ref images: {:?}", request.reference_images.as_ref().map(|v| v.len())));

            let reference_urls: Option<Vec<String>> = if let Some(ref_images) = &request.reference_images {
                if ref_images.is_empty() {
                    None
                } else {
                    let mut encoded = Vec::new();
                    for (i, img) in ref_images.iter().enumerate() {
                        debug_log(&format!("Encoding ref image {} (source len: {})", i, img.len()));
                        match encode_reference_for_gpt_image(img) {
                            Ok(b64) => {
                                debug_log(&format!("Ref image {} encoded OK, b64 len: {}", i, b64.len()));
                                encoded.push(b64);
                            }
                            Err(e) => {
                                debug_log(&format!("Ref image {} FAILED: {}", i, e));
                                return Err(AIError::InvalidRequest(format!("Failed to encode reference image {}: {}", i, e)));
                            }
                        }
                    }
                    if encoded.is_empty() { None } else { Some(encoded) }
                }
            } else {
                None
            };

            let mut body = json!({
                "model": model,
                "prompt": request.prompt,
                "size": request.aspect_ratio,
                "webHook": "-1"
            });

            if let Some(ref_urls) = &reference_urls {
                body["urls"] = json!(ref_urls);
                debug_log(&format!("Added {} urls", ref_urls.len()));
            }

            let body_json = serde_json::to_string(&body).unwrap_or_default();
            debug_log(&format!("Total body length: {} bytes", body_json.len()));
            debug_log(&format!("Body preview: {}", &body_json[..body_json.len().min(300)]));

            let response = self
                .client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .body(body_json)
                .send()
                .await?;

            debug_log(&format!("Response status: {}", response.status()));

            return Self::handle_draw_response(response).await;
        }

        // nano-banana path
        let reference_urls: Option<Vec<String>> = request
            .reference_images
            .as_ref()
            .map(|images| {
                images
                    .iter()
                    .filter_map(|image| encode_reference_for_grsai(image))
                    .collect::<Vec<_>>()
            })
            .filter(|images| !images.is_empty());

        if request
            .reference_images
            .as_ref()
            .map(|images| !images.is_empty())
            .unwrap_or(false)
            && reference_urls.is_none()
        {
            return Err(AIError::InvalidRequest(
                "Reference images are present but none could be encoded for GRSAI".to_string(),
            ));
        }

        let body = DrawRequestBody {
            model,
            prompt: request.prompt.clone(),
            aspect_ratio: request.aspect_ratio.clone(),
            image_size: request.size.clone(),
            urls: reference_urls,
            web_hook: "-1".to_string(),
            shut_progress: true,
        };

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        Self::handle_draw_response(response).await
    }

    async fn handle_draw_response(response: reqwest::Response) -> Result<Value, AIError> {
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            debug_log(&format!("Error response: {} - {}", status, &error_text[..error_text.len().min(500)]));
            return Err(AIError::Provider(format!(
                "GRSAI draw request failed {}: {}",
                status, error_text
            )));
        }

        let response_text = response.text().await.map_err(|e| {
            AIError::Provider(format!("Failed to read response body: {}", e))
        })?;
        debug_log(&format!("Response text (first 500): {}", &response_text[..response_text.len().min(500)]));

        if let Ok(v) = serde_json::from_str::<Value>(&response_text) {
            return Ok(v);
        }

        if let Some(v) = parse_sse_last_event(&response_text) {
            debug_log("Parsed SSE response successfully");
            return Ok(v);
        }

        Err(AIError::Provider(format!(
            "Failed to parse response as JSON or SSE. Raw (first 500): {}",
            &response_text[..response_text.len().min(500)]
        )))
    }

    async fn poll_result_once(&self, task_id: &str) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}{}", self.base_url, RESULT_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&json!({ "id": task_id }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "GRSAI result request failed {}: {}",
                status, error_text
            )));
        }

        let response_text = response.text().await.map_err(AIError::from)?;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("grsai_debug.log") {
    let _ = writeln!(f, "[POLL] task_id: {}, response: {}", task_id, &response_text[..response_text.len().min(1000)]);
}
        let poll_response = if let Ok(v) = serde_json::from_str::<Value>(&response_text) {
            v
        } else if let Some(v) = parse_sse_last_event(&response_text) {
            v
        } else {
            return Err(AIError::Provider(format!(
                "Failed to parse poll response. Raw (first 500): {}",
                &response_text[..response_text.len().min(500)]
            )));
        };

        let payload = Self::resolve_task_payload(&poll_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(ProviderTaskPollResult::Succeeded(url));
        }

        match payload.get("status").and_then(|raw| raw.as_str()) {
            Some("running") | None => Ok(ProviderTaskPollResult::Running),
            Some("failed") => {
                let reason = payload
                    .get("error")
                    .and_then(|raw| raw.as_str())
                    .filter(|value| !value.is_empty())
                    .or_else(|| payload.get("failure_reason").and_then(|raw| raw.as_str()))
                    .unwrap_or("unknown failure");
                Ok(ProviderTaskPollResult::Failed(reason.to_string()))
            }
            Some(other) => Err(AIError::Provider(format!("GRSAI unexpected task status: {}", other))),
        }
    }

    async fn poll_result_until_complete(&self, task_id: &str) -> Result<String, AIError> {
        loop {
            match self.poll_result_once(task_id).await? {
                ProviderTaskPollResult::Running => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                ProviderTaskPollResult::Failed(message) => return Err(AIError::TaskFailed(message)),
            }
        }
    }
}

impl Default for GrsaiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for GrsaiProvider {
    fn name(&self) -> &str {
        "grsai"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("grsai/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "grsai/nano-banana-2".to_string(),
            "grsai/nano-banana-pro".to_string(),
            "grsai/gpt-image-2".to_string(),
            "grsai/gpt-image-2-vip".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn submit_task(&self, request: GenerateRequest) -> Result<ProviderTaskSubmission, AIError> {
        let model = self.normalize_requested_model(&request);
        let draw_response = self.request_draw(&request, model).await?;
        let payload = Self::resolve_task_payload(&draw_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(ProviderTaskSubmission::Succeeded(url));
        }

        let task_id = payload
            .get("id")
            .and_then(|raw| raw.as_str())
            .ok_or_else(|| AIError::Provider("GRSAI response missing task id".to_string()))?;

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id: task_id.to_string(),
            metadata: None,
        }))
    }

    async fn poll_task(&self, handle: ProviderTaskHandle) -> Result<ProviderTaskPollResult, AIError> {
        self.poll_result_once(handle.task_id.as_str()).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = self.normalize_requested_model(&request);
        info!(
            "[GRSAI Request] model: {}, size: {}, aspect_ratio: {}",
            model, request.size, request.aspect_ratio
        );

        let draw_response = self.request_draw(&request, model).await?;
        let payload = Self::resolve_task_payload(&draw_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(url);
        }

        let task_id = payload
            .get("id")
            .and_then(|raw| raw.as_str())
            .ok_or_else(|| AIError::Provider("GRSAI response missing task id".to_string()))?;

        self.poll_result_until_complete(task_id).await
    }
}
