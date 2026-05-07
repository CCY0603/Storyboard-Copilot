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
use crate::ai::{AIProvider, GenerateRequest};

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

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let normalized =
        if decoded.starts_with('/') && decoded.len() > 2 && decoded.as_bytes().get(2) == Some(&b':')
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
        SUPPORTED_MODELS.iter().map(|s| s.to_string()).collect()
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = Self::sanitize_model(&request.model);
        let size_param = Self::resolve_size_param(&request.size, &request.aspect_ratio);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let has_references = request
            .reference_images
            .as_ref()
            .map(|imgs| !imgs.is_empty())
            .unwrap_or(false);

        info!(
            "[32zi Request] model: {}, size: {}, aspect_ratio: {}, refs: {}",
            model,
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|imgs| imgs.len())
                .unwrap_or(0)
        );

        if has_references {
            self.generate_image_edit(&request, model, size_param, &api_key)
                .await
        } else {
            self.generate_text_to_image(&request, model, size_param, &api_key)
                .await
        }
    }
}