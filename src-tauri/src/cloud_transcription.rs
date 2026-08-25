//! Cloud transcription for proprietary hosted models.
//!
//! Currently OpenAI only: the recorded 16 kHz PCM is encoded as an in-memory
//! WAV and posted to the provider's `/audio/transcriptions` endpoint.
//! Anthropic has no speech-to-text API today, so OpenAI is the only provider.

use crate::audio_toolkit::audio::wav_bytes;
use crate::settings::AppSettings;
use anyhow::{anyhow, Result};
use log::{debug, info};
use serde::Deserialize;
use std::sync::mpsc;
use std::time::Duration;

/// Provider id shared with post-processing: cloud transcription reuses the
/// OpenAI API key and base URL configured in `post_process_providers`.
const OPENAI_PROVIDER_ID: &str = "openai";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

/// Transcribe `samples` (16 kHz mono PCM) with an OpenAI-hosted model.
///
/// Blocking. Callers already sit on threads that block on engine compute
/// (including inside async tasks — see actions.rs), so the request is spawned
/// onto Tauri's runtime and awaited through a channel; `block_on` would panic
/// in that async context.
pub fn transcribe_openai(settings: &AppSettings, model: &str, samples: &[f32]) -> Result<String> {
    let provider = settings
        .post_process_provider(OPENAI_PROVIDER_ID)
        .ok_or_else(|| anyhow!("OpenAI provider is not configured"))?;
    let api_key = settings
        .post_process_api_keys
        .get(OPENAI_PROVIDER_ID)
        .cloned()
        .unwrap_or_default();
    if api_key.is_empty() {
        return Err(anyhow!(
            "No OpenAI API key configured. Add one under Settings → Models → Cloud transcription."
        ));
    }

    let url = format!(
        "{}/audio/transcriptions",
        provider.base_url.trim_end_matches('/')
    );
    let wav = wav_bytes(samples)?;
    debug!(
        "Sending {:.2}s of audio ({} KiB WAV) to cloud model '{}'",
        samples.len() as f64 / 16_000.0,
        wav.len() / 1024,
        model
    );

    let model = model.to_string();
    // Custom words give the model spelling context, mirroring the whisper
    // initial prompt.
    let prompt = (!settings.custom_words.is_empty()).then(|| settings.custom_words.join(", "));

    let (tx, rx) = mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let _ = tx.send(request_transcription(url, api_key, model, wav, prompt).await);
    });
    rx.recv()
        .map_err(|_| anyhow!("Cloud transcription task ended without a response"))?
}

async fn request_transcription(
    url: String,
    api_key: String,
    model: String,
    wav: Vec<u8>,
    prompt: Option<String>,
) -> Result<String> {
    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model)
        .text("response_format", "json");
    if let Some(prompt) = prompt {
        form = form.text("prompt", prompt);
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        // Provider error bodies are short JSON error messages; they never
        // contain audio or transcription content, so they are safe to surface.
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Cloud transcription failed ({}): {}", status, body));
    }

    let parsed: TranscriptionResponse = response.json().await?;
    info!(
        "Cloud transcription completed ({} chars)",
        parsed.text.len()
    );
    Ok(parsed.text)
}
