use serde_json::{json, Value};
use url::Url;

use crate::error::AppError;
use crate::types::{DrawingJobCreateRequest, ModelConfigView};
use crate::utils::fallback_commands;

#[derive(Clone)]
pub struct ModelClient {
    base_url: Url,
    model_name: String,
    api_key: Option<String>,
    http: reqwest::Client,
}

impl ModelClient {
    pub fn new(base_url: String, model_name: String, api_key: String) -> Result<Self, AppError> {
        let base_url = Url::parse(&base_url)
            .map_err(|err| AppError::BadRequest(format!("invalid model base URL: {err}")))?;
        let api_key = if api_key.trim().is_empty() {
            None
        } else {
            Some(api_key)
        };

        Ok(Self {
            base_url,
            model_name,
            api_key,
            http: reqwest::Client::new(),
        })
    }

    pub fn view(&self) -> ModelConfigView {
        ModelConfigView {
            base_url: self.base_url.as_str().trim_end_matches('/').to_string(),
            model_name: self.model_name.clone(),
            api_key_set: self.api_key.is_some(),
        }
    }

    pub async fn generate_drawing_commands(
        &self,
        input: &DrawingJobCreateRequest,
    ) -> Result<ModelDrawingResponse, AppError> {
        let endpoint = self
            .base_url
            .join("/chat/completions")
            .map_err(|err| AppError::Internal(format!("invalid model endpoint: {err}")))?;

        let prompt = format!(
            "You are a geometry assistant. Generate GeoGebra commands only.\nCanvas mode: {}\nLocale: {}\nUser prompt: {}\nReturn JSON with keys sceneSummary, commands, confidence, humanReviewRecommended.",
            input.canvas_mode, input.locale, input.prompt
        );

        let body = json!({
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "You only output structured JSON for GeoGebra drawing tasks."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        });

        let mut request = self.http.post(endpoint).json(&body);
        if let Some(api_key) = &self.api_key {
            request = request.bearer_auth(api_key);
        }

        let response = request
            .send()
            .await
            .map_err(|err| AppError::Internal(format!("model request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Internal(format!(
                "model provider returned {}",
                response.status()
            )));
        }

        let json: Value = response
            .json()
            .await
            .map_err(|err| AppError::Internal(format!("invalid model response: {err}")))?;

        Ok(ModelDrawingResponse::from_json(json))
    }
}

#[derive(Debug, Clone)]
pub struct ModelDrawingResponse {
    pub scene_summary: String,
    pub commands: Vec<String>,
    pub confidence: f32,
    pub human_review_recommended: bool,
}

impl ModelDrawingResponse {
    pub fn fallback() -> Self {
        Self {
            scene_summary: "model output is unavailable, fallback command set generated locally"
                .to_string(),
            commands: fallback_commands(),
            confidence: 0.72,
            human_review_recommended: true,
        }
    }

    pub fn from_json(value: Value) -> Self {
        let scene_summary = value
            .get("sceneSummary")
            .or_else(|| value.get("scene_summary"))
            .and_then(Value::as_str)
            .unwrap_or("AI generated drawing commands")
            .to_string();

        let commands = value
            .get("commands")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
            .unwrap_or_else(fallback_commands);

        let confidence = value
            .get("confidence")
            .and_then(Value::as_f64)
            .map(|value| value as f32)
            .unwrap_or(0.85);

        let human_review_recommended = value
            .get("humanReviewRecommended")
            .or_else(|| value.get("human_review_recommended"))
            .and_then(Value::as_bool)
            .unwrap_or(confidence < 0.8);

        Self {
            scene_summary,
            commands,
            confidence,
            human_review_recommended,
        }
    }
}
