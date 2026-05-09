//! 32zi AI Provider Implementation
//!
//! 32zi (ai.32zi.com) is an OpenAI-compatible relay API provider.
//! Supports both OpenAI image generation models and video generation models.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::ImageEncoder;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle,
    ProviderTaskPollResult, ProviderTaskSubmission,
};

const DEFAULT_BASE_URL: &str = "https://ai.32zi.com/v1";
const MAX_IMAGE_DIMENSION: u32 = 512;
const JPEG_QUALITY: u8 = 50;

const SUPPORTED_MODELS: [&str; 7] = [
    "zi32/gpt-image-2",
    "zi32/gpt-image-1.5",
    "zi32/gpt-image-1",
    "zi32/gpt-image-1-mini",
    "zi32/gemini-3.1-flash-image",
    "zi32/gemini-3-pro-image",
    "zi32/gemini-2.5-flash-image",
];

/// Video model identifiers supported by 32zi
const VIDEO_MODELS: &[&str] = &[
    "grok-videos",
    "grok-video-3",
    "grok-video-3-10s",
];

/// Check if a model (without provider prefix) is a video model
fn is_video_model(model: &str) -> bool {
    VIDEO_MODELS.iter().any(|m| *m == model)
}

/// Check if a video model uses OpenAI /v1/videos format
fn is_openai_video_model(model: &str) -> bool {
    model == "grok-videos"
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

fn source_to_bytes(source: &str) -> Result<Vec<u8>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("source is empty".to_string());
    }
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return STANDARD
                .decode(payload)
                .map_err(|err| format!("invalid data-url base64 payload: {}", err));
        }
    }
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return STANDARD
            .decode(trimmed)
            .map_err(|err| format!("invalid base64 payload: {}", err));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Err("URL sources not supported for local encoding".to_string());
    }
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    std::fs::read(&path).map_err(|err| {
        format!(
            "failed to read path \"{}\": {}",
            path.to_string_lossy(),
            err
        )
    })
}

fn compress_image_for_multipart(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("Failed to load image: {}", e))?;
    let img = if img.width() > MAX_IMAGE_DIMENSION || img.height() > MAX_IMAGE_DIMENSION {
        img.resize(
            MAX_IMAGE_DIMENSION,
            MAX_IMAGE_DIMENSION,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
    encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    Ok(buf)
}

/// Compress image for video API - more aggressive than multipart to keep JSON small
fn compress_image_for_video(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const MAX_VIDEO_DIMENSION: u32 = 512;
    const VIDEO_JPEG_QUALITY: u8 = 40;
    let img = image::load_from_memory(bytes).map_err(|e| format!("Failed to load image: {}", e))?;
    let img = if img.width() > MAX_VIDEO_DIMENSION || img.height() > MAX_VIDEO_DIMENSION {
        img.resize(
            MAX_VIDEO_DIMENSION,
            MAX_VIDEO_DIMENSION,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, VIDEO_JPEG_QUALITY);
    encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    Ok(buf)
}

fn extract_image_url(body: &Value) -> Option<String> {
    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(url) = item.get("url").and_then(|u| u.as_str()) {
                if !url.trim().is_empty() {
                    return Some(url.to_string());
                }
            }
            if let Some(b64) = item.get("b64_json").and_then(|b| b.as_str()) {
                if !b64.trim().is_empty() {
                    return Some(format!("data:image/png;base64,{}", b64));
                }
            }
        }
    }
    let pointers = [
        "/data/url",
        "/data/image_url",
        "/url",
        "/image_url",
        "/output/url",
        "/result/url",
    ];
    for pointer in pointers {
        if let Some(url) = body
            .pointer(pointer)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        {
            return Some(url.to_string());
        }
    }
    None
}

fn handle_response_body(raw: &str, endpoint_label: &str) -> Result<String, AIError> {
    let body: Value = serde_json::from_str(raw).map_err(|err| {
        AIError::Provider(format!(
            "32zi {} invalid JSON response: {}; raw={}",
            endpoint_label, err, raw
        ))
    })?;

    if let Some(error) = body.get("error") {
        let msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(AIError::Provider(format!("32zi API error: {}", msg)));
    }

    extract_image_url(&body).ok_or_else(|| {
        AIError::Provider(format!(
            "32zi {} no image URL in response: {}",
            endpoint_label, raw
        ))
    })
}

/// Encode reference image to URL or data URI for video API
#[allow(dead_code)]
fn encode_reference_image_url(source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Already a URL
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    // Data URL with base64
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && (meta.ends_with(";base64") || meta.contains("image/")) {
            if !payload.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    // Raw base64
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return Some(format!("data:image/jpeg;base64,{}", trimmed));
    }
    // Try to read as file
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    if let Ok(bytes) = std::fs::read(&path) {
        let mime = if path.extension().and_then(|e| e.to_str()) == Some("png") {
            "image/png"
        } else {
            "image/jpeg"
        };
        return Some(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)));
    }
    None
}

pub struct Zi32Provider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl Zi32Provider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn resolve_size_param(size: &str, aspect_ratio: &str) -> String {
        match size {
            "1K" => match aspect_ratio {
                "16:9" => "1792x1024".to_string(),
                "9:16" => "1024x1792".to_string(),
                _ => "1024x1024".to_string(),
            },
            "2K" => match aspect_ratio {
                "16:9" => "2048x1152".to_string(),
                "9:16" => "1152x2048".to_string(),
                _ => "1536x1536".to_string(),
            },
            "4K" => match aspect_ratio {
                "16:9" => "3840x2160".to_string(),
                "9:16" => "2160x3840".to_string(),
                _ => "3072x3072".to_string(),
            },
            _ => "1024x1024".to_string(),
        }
    }

    /// Convert aspect ratio to video size string
    fn aspect_ratio_to_video_size(aspect_ratio: &str) -> String {
        match aspect_ratio {
            "1:1" => "1024x1024",
            "16:9" => "1280x720",
            "9:16" => "720x1280",
            "4:3" => "1024x768",
            "3:4" => "768x1024",
            "3:2" => "1152x768",
            "2:3" => "768x1152",
            _ => "1280x720",
        }
        .to_string()
    }

    async fn generate_text_to_image(
        &self,
        request: &GenerateRequest,
        model: String,
        size_param: String,
        api_key: &str,
    ) -> Result<String, AIError> {
        let endpoint = format!("{}/images/generations", self.base_url);
        let body = json!({
            "model": model,
            "prompt": request.prompt,
            "size": size_param,
            "n": 1
        });

        info!("[32zi API] POST {} (text-to-image)", endpoint);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "32zi generations request failed {}: {}",
                status, error_text
            )));
        }

        let raw = response.text().await.unwrap_or_default();
        handle_response_body(&raw, "generations")
    }

    async fn generate_image_edit(
        &self,
        request: &GenerateRequest,
        model: String,
        size_param: String,
        api_key: &str,
    ) -> Result<String, AIError> {
        let endpoint = format!("{}/images/edits", self.base_url);
        let mut form = Form::new()
            .text("model", model.clone())
            .text("prompt", request.prompt.clone())
            .text("n", "1");

        if size_param != "1024x1024" {
            form = form.text("size", size_param);
        }

        if let Some(ref_images) = &request.reference_images {
            if let Some(source) = ref_images.first() {
                match source_to_bytes(source) {
                    Ok(bytes) => {
                        let compressed = compress_image_for_multipart(&bytes).unwrap_or(bytes);
                        let compressed_len = compressed.len();
                        let part = Part::bytes(compressed)
                            .file_name("image.png")
                            .mime_str("image/png")
                            .unwrap();
                        form = form.part("image", part);
                        info!(
                            "[32zi] Reference image compressed, size: {} bytes",
                            compressed_len
                        );
                    }
                    Err(e) => {
                        info!("[32zi] Failed to read reference image: {}", e);
                    }
                }
            }
        }

        info!("[32zi API] POST {} (image-edit, multipart)", endpoint);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "32zi edits request failed {}: {}",
                status, error_text
            )));
        }

        let raw = response.text().await.unwrap_or_default();
        handle_response_body(&raw, "edits")
    }

    /// Submit a video generation task
    /// grok-videos → /v1/videos (OpenAI format)
    /// grok-video-3 / grok-video-3-10s → /v1/video/create
    async fn submit_video_task(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<String, AIError> {
        let raw_model = Self::sanitize_model(&model);

        // Get reference image URLs if provided (image-to-video)
        let mut images: Vec<String> = Vec::new();
        if let Some(ref_imgs) = &request.reference_images {
            for img in ref_imgs {
                let trimmed = img.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                    images.push(trimmed.to_string());
                    continue;
                }
                match source_to_bytes(trimmed) {
                    Ok(bytes) => {
                        match compress_image_for_video(&bytes) {
                            Ok(compressed) => {
                                let data_url = format!(
                                    "data:image/jpeg;base64,{}",
                                    STANDARD.encode(&compressed)
                                );
                                info!(
                                    "[32zi Video API] Compressed ref image: {} -> {} bytes",
                                    bytes.len(),
                                    compressed.len()
                                );
                                images.push(data_url);
                            }
                            Err(e) => {
                                info!("[32zi Video API] Failed to compress ref image: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        info!("[32zi Video API] Failed to read ref image: {}", e);
                    }
                }
            }
        }

        // Get resolution from extra_params or default
        let resolution = request
            .extra_params
            .as_ref()
            .and_then(|p| p.get("resolution"))
            .and_then(|v| v.as_str())
            .unwrap_or("720P");

        // Get duration from extra_params or default
        let mut duration = request
            .extra_params
            .as_ref()
            .and_then(|p| p.get("duration"))
            .and_then(|v| v.as_u64())
            .unwrap_or(5) as u32;

        // Clamp duration per model requirements
        if is_openai_video_model(&raw_model) {
            // grok-videos only accepts 6 or 10
            if duration != 6 && duration != 10 {
                duration = 6;
            }
        } else if raw_model == "grok-video-3-10s" {
            duration = 10;
        }

        if is_openai_video_model(&raw_model) {
            // OpenAI format: POST /v1/videos
            let mut body = json!({
                "model": raw_model,
                "prompt": request.prompt,
                "seconds": duration,
            });
            if !images.is_empty() {
                body["image_url"] = json!(images[0]);
            }
            // Map aspect_ratio to size for OpenAI format
            let size = Self::aspect_ratio_to_video_size(&request.aspect_ratio);
            body["size"] = json!(size);

            let endpoint = format!("{}/videos", self.base_url);
            let api_key = self.api_key.read().await.clone()
                .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

            info!("[32zi Video API] POST {} (OpenAI format) model={}", endpoint, raw_model);

            let response = self.client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return Err(AIError::Provider(format!(
                    "32zi video submit failed {}: {}", status, error_text
                )));
            }

            let resp_text = response.text().await?;
            let resp_json: Value = serde_json::from_str(&resp_text)
                .map_err(|e| AIError::Provider(format!("32zi video submit invalid JSON: {}", e)))?;

            let task_id = resp_json.get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AIError::Provider(format!(
                    "32zi video response missing task ID: {}", resp_text
                )))?
                .to_string();

            info!("[32zi Video API] Task submitted (OpenAI): {}", task_id);
            Ok(task_id)
        } else {
            // Custom format: POST /v1/video/create
            let body = json!({
                "model": raw_model,
                "prompt": request.prompt,
                "aspect_ratio": request.aspect_ratio,
                "size": resolution,
                "seconds": duration,
                "images": images,
            });

            let endpoint = format!("{}/video/create", self.base_url);
            let api_key = self.api_key.read().await.clone()
                .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

            info!(
                "[32zi Video API] POST {} model={}, aspect_ratio={}, images_count={}",
                endpoint, raw_model, request.aspect_ratio, images.len()
            );

            let response = self.client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return Err(AIError::Provider(format!(
                    "32zi video submit failed {}: {}", status, error_text
                )));
            }

            let resp_text = response.text().await?;
            let resp_json: Value = serde_json::from_str(&resp_text)
                .map_err(|e| AIError::Provider(format!("32zi video submit invalid JSON: {}", e)))?;

            let task_id = resp_json.get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AIError::Provider(format!(
                    "32zi video response missing task ID: {}", resp_text
                )))?
                .to_string();

            info!("[32zi Video API] Task submitted: {}", task_id);
            Ok(task_id)
        }
    }

    /// Poll video generation status from 32zi /v1/video/query endpoint
    async fn poll_video_task(&self, task_id: &str) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}/video/query?id={}", self.base_url, task_id);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "32zi video poll failed {}: {}",
                status, error_text
            )));
        }

        let resp_text = response.text().await?;
        let resp_json: Value = serde_json::from_str(&resp_text)
            .map_err(|e| AIError::Provider(format!("32zi video poll invalid JSON: {}", e)))?;

        let status = resp_json
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_lowercase();

        match status.as_str() {
            "pending" | "processing" | "in_progress" | "running" | "queued" => {
                Ok(ProviderTaskPollResult::Running)
            }
            "done" | "completed" | "succeeded" | "success" => {
                // Try multiple possible video URL locations
                let video_url = resp_json
                    .get("video_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        resp_json
                            .get("data")
                            .and_then(|d| d.get("video_url"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .or_else(|| {
                        // OpenAI /v1/videos/{id} format: data[0].url
                        resp_json
                            .get("data")
                            .and_then(|d| d.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|item| item.get("url"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })
                    .or_else(|| {
                        resp_json
                            .get("url")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    });

                if let Some(url) = video_url {
                    info!("[32zi Video API] Video completed: {}", url);
                    Ok(ProviderTaskPollResult::Succeeded(url))
                } else {
                    Err(AIError::Provider(format!(
                        "32zi video completed but no URL found: {}",
                        resp_text
                    )))
                }
            }
            "expired" | "failed" | "fail" => {
                let error_msg = resp_json
                    .get("message")
                    .and_then(|v| v.as_str())
                    .or_else(|| resp_json.get("error").and_then(|v| v.as_str()))
                    .unwrap_or("Video generation failed")
                    .to_string();
                Ok(ProviderTaskPollResult::Failed(error_msg))
            }
            _ => Err(AIError::Provider(format!(
                "Unknown 32zi video status: {}",
                status
            ))),
        }
    }
}

impl Default for Zi32Provider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for Zi32Provider {
    fn name(&self) -> &str {
        "zi32"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("zi32/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        let mut models: Vec<String> = SUPPORTED_MODELS.iter().map(|s| s.to_string()).collect();
        // Add video models
        for vm in VIDEO_MODELS {
            models.push(format!("zi32/{}", vm));
        }
        models
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let raw_model = Self::sanitize_model(&request.model);

        if is_video_model(&raw_model) {
            // Video models use async task submission
            let task_id = self.submit_video_task(&request, request.model.clone()).await?;
            Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
                task_id,
                metadata: Some(json!({ "media_type": "video" })),
            }))
        } else {
            // Image models generate synchronously
            let api_key = self
                .api_key
                .read()
                .await
                .clone()
                .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

            let size_param = Self::resolve_size_param(&request.size, &request.aspect_ratio);
            let has_references = request
                .reference_images
                .as_ref()
                .map(|imgs| !imgs.is_empty())
                .unwrap_or(false);

            let result = if has_references {
                self.generate_image_edit(&request, raw_model, size_param, &api_key)
                    .await?
            } else {
                self.generate_text_to_image(&request, raw_model, size_param, &api_key)
                    .await?
            };
            Ok(ProviderTaskSubmission::Succeeded(result))
        }
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        self.poll_video_task(&handle.task_id).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let raw_model = Self::sanitize_model(&request.model);

        if is_video_model(&raw_model) {
            // Video: submit + poll loop
            let task_id = self.submit_video_task(&request, request.model.clone()).await?;

            let max_attempts = 180; // Max 3 minutes (180 * 1 second)
            for attempt in 0..max_attempts {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                match self.poll_video_task(&task_id).await? {
                    ProviderTaskPollResult::Running => {
                        if attempt % 15 == 0 {
                            info!(
                                "[32zi Video] Still processing... attempt {}/{}",
                                attempt, max_attempts
                            );
                        }
                        continue;
                    }
                    ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                    ProviderTaskPollResult::Failed(error) => {
                        return Err(AIError::Provider(format!(
                            "Video generation failed: {}",
                            error
                        )))
                    }
                }
            }

            Err(AIError::Provider(
                "Video generation timed out after 3 minutes".to_string(),
            ))
        } else {
            // Image: synchronous generation
            let api_key = self
                .api_key
                .read()
                .await
                .clone()
                .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

            let size_param = Self::resolve_size_param(&request.size, &request.aspect_ratio);
            let has_references = request
                .reference_images
                .as_ref()
                .map(|imgs| !imgs.is_empty())
                .unwrap_or(false);

            info!(
                "[32zi Request] model: {}, size: {}, aspect_ratio: {}, refs: {}",
                raw_model,
                request.size,
                request.aspect_ratio,
                request
                    .reference_images
                    .as_ref()
                    .map(|imgs| imgs.len())
                    .unwrap_or(0)
            );

            if has_references {
                self.generate_image_edit(&request, raw_model, size_param, &api_key)
                    .await
            } else {
                self.generate_text_to_image(&request, raw_model, size_param, &api_key)
                    .await
            }
        }
    }
}
