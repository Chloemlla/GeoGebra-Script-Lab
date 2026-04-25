use serde_json::{json, Value};
use std::time::Duration;
use url::Url;

use crate::error::AppError;
use crate::types::{
    AnnotationJobRequest, AnnotationJobResponse, DrawingJobCreateRequest, ModelConfigView,
    ObjectExplanationItem, ObjectExplanationRequest, ObjectExplanationResponse,
    ScriptInsightsRequest, ScriptInsightsResponse,
};
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
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(45))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(16)
                .tcp_keepalive(Duration::from_secs(30))
                .http2_adaptive_window(true)
                .build()
                .map_err(|err| {
                    AppError::Internal(format!("unable to build model client: {err}"))
                })?,
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

    pub async fn generate_script_insights(
        &self,
        input: &ScriptInsightsRequest,
    ) -> Result<ScriptInsightsResponse, AppError> {
        let prompt = format!(
            "You are a geometry teaching assistant.\nLocale: {}\nExtra prompt: {}\nGeoGebra commands:\n{}\nReturn JSON with keys summary, keyPoints, annotations, explanationSteps, objectDependencies, teachingScript.",
            input.locale,
            input.prompt.clone().unwrap_or_default(),
            input.commands.join("\n")
        );

        let response = self
            .request_structured_json(
                "You only output structured JSON for GeoGebra script explanation tasks.",
                &prompt,
            )
            .await?;

        Ok(parse_script_insights(response, &input.commands))
    }

    pub async fn generate_annotation_job(
        &self,
        input: &AnnotationJobRequest,
    ) -> Result<AnnotationJobResponse, AppError> {
        let prompt = format!(
            "You are a geometry annotation assistant.\nCanvas mode: {}\nLocale: {}\nGoal: {}\nCommands:\n{}\nReturn JSON with keys summary and annotations. annotations must be an array of objects with id, label, description, relatedObjects, suggestedCommand.",
            input.canvas_mode,
            input.locale,
            input.goal,
            input.commands.join("\n")
        );

        let response = self
            .request_structured_json(
                "You only output structured JSON for GeoGebra annotation tasks.",
                &prompt,
            )
            .await?;

        Ok(parse_annotation_job(response, &input.commands))
    }

    pub async fn generate_object_explanations(
        &self,
        input: &ObjectExplanationRequest,
    ) -> Result<ObjectExplanationResponse, AppError> {
        let prompt = format!(
            "You are a geometry dependency assistant.\nCanvas mode: {}\nLocale: {}\nFocus objects: {}\nCommands:\n{}\nReturn JSON with keys summary, objects, teachingScript. objects must be an array with name, kind, dependsOn, reason, sourceCommand.",
            input.canvas_mode,
            input.locale,
            input.focus_objects.join(", "),
            input.commands.join("\n")
        );

        let response = self
            .request_structured_json(
                "You only output structured JSON for GeoGebra dependency explanation tasks.",
                &prompt,
            )
            .await?;

        Ok(parse_object_explanations(
            response,
            &input.commands,
            &input.focus_objects,
        ))
    }

    async fn request_structured_json(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<Value, AppError> {
        let endpoint = self
            .base_url
            .join("/chat/completions")
            .map_err(|err| AppError::Internal(format!("invalid model endpoint: {err}")))?;

        let body = json!({
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.25,
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

        response
            .json()
            .await
            .map_err(|err| AppError::Internal(format!("invalid model response: {err}")))
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

fn parse_content_json(value: Value) -> Value {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .and_then(|content| serde_json::from_str::<Value>(content).ok())
        .unwrap_or(value)
}

fn parse_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_script_insights(value: Value, commands: &[String]) -> ScriptInsightsResponse {
    let content = parse_content_json(value);
    let object_dependencies = content
        .get("objectDependencies")
        .or_else(|| content.get("object_dependencies"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    serde_json::from_value::<ObjectExplanationItem>(item.clone()).ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    ScriptInsightsResponse {
        summary: content
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("脚本会按顺序构造图形并逐步建立对象关系。")
            .to_string(),
        key_points: parse_string_list(
            content
                .get("keyPoints")
                .or_else(|| content.get("key_points")),
        ),
        annotations: parse_string_list(content.get("annotations")),
        explanation_steps: parse_string_list(
            content
                .get("explanationSteps")
                .or_else(|| content.get("explanation_steps")),
        ),
        object_dependencies,
        teaching_script: parse_string_list(
            content
                .get("teachingScript")
                .or_else(|| content.get("teaching_script")),
        )
        .into_iter()
        .chain(
            commands
                .iter()
                .take(2)
                .map(|command| format!("命令 `{command}` 会创建或更新一个几何对象。")),
        )
        .take(8)
        .collect(),
    }
}

fn parse_annotation_job(value: Value, commands: &[String]) -> AnnotationJobResponse {
    let content = parse_content_json(value);
    let annotations = content
        .get("annotations")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    serde_json::from_value::<crate::types::AnnotationSuggestion>(item.clone()).ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            commands
                .iter()
                .take(3)
                .enumerate()
                .map(|(index, command)| crate::types::AnnotationSuggestion {
                    id: format!("ann_{}", index + 1),
                    label: format!("说明 {}", index + 1),
                    description: format!("解释命令 `{command}` 的作用。"),
                    related_objects: extract_command_targets(command),
                    suggested_command: format!(
                        "Text(\"{}\", ({}, {}))",
                        command.replace('"', "'"),
                        index as i32,
                        2 - index as i32
                    ),
                })
                .collect()
        });

    AnnotationJobResponse {
        summary: content
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("已根据当前脚本生成可回写的教学标注建议。")
            .to_string(),
        annotations,
    }
}

fn parse_object_explanations(
    value: Value,
    commands: &[String],
    focus_objects: &[String],
) -> ObjectExplanationResponse {
    let content = parse_content_json(value);
    let objects = content
        .get("objects")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    serde_json::from_value::<ObjectExplanationItem>(item.clone()).ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            focus_objects
                .iter()
                .map(|name| ObjectExplanationItem {
                    name: name.clone(),
                    kind: "object".to_string(),
                    depends_on: Vec::new(),
                    reason: format!("{name} 由当前脚本中的相关命令构造得到。"),
                    source_command: commands
                        .iter()
                        .find(|command| command.trim_start().starts_with(&format!("{name} =")))
                        .cloned()
                        .unwrap_or_default(),
                })
                .collect()
        });

    ObjectExplanationResponse {
        summary: content
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("已根据当前脚本生成对象级依赖解释。")
            .to_string(),
        objects,
        teaching_script: parse_string_list(
            content
                .get("teachingScript")
                .or_else(|| content.get("teaching_script")),
        ),
    }
}

fn extract_command_targets(command: &str) -> Vec<String> {
    command
        .split('=')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| vec![value.to_string()])
        .unwrap_or_default()
}
