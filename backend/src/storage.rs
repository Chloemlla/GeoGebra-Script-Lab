use std::fs;
use std::process::Command;

use crate::error::AppError;

pub fn build_svg_export(title: &str, canvas_mode: &str, commands: &[String]) -> String {
    let lines = commands
        .iter()
        .enumerate()
        .map(|(index, command)| {
            format!(
                "<text x=\"40\" y=\"{}\" font-size=\"16\" fill=\"#1d1d1f\">{}</text>",
                120 + index * 24,
                escape_svg(command)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">
  <rect width=\"1280\" height=\"720\" fill=\"#f5f5f7\"/>
  <rect x=\"32\" y=\"32\" width=\"1216\" height=\"656\" rx=\"28\" fill=\"#ffffff\" stroke=\"#d2d2d7\"/>
  <text x=\"40\" y=\"72\" font-size=\"32\" font-family=\"Arial, sans-serif\" fill=\"#1d1d1f\">{}</text>
  <text x=\"40\" y=\"102\" font-size=\"16\" font-family=\"Arial, sans-serif\" fill=\"#6e6e73\">Canvas: {}</text>
  {}
</svg>",
        escape_svg(title),
        escape_svg(canvas_mode),
        lines
    )
}

pub fn build_pdf_export(title: &str, canvas_mode: &str, commands: &[String]) -> Vec<u8> {
    let mut content_stream = String::new();
    content_stream.push_str("BT\n/F1 28 Tf\n40 760 Td\n");
    content_stream.push_str(&format!("({}) Tj\n", escape_pdf_text(title)));
    content_stream.push_str("0 -28 Td\n/F1 14 Tf\n");
    content_stream.push_str(&format!("(Canvas: {}) Tj\n", escape_pdf_text(canvas_mode)));
    content_stream.push_str("0 -24 Td\n");

    for command in commands.iter().take(20) {
        content_stream.push_str(&format!("({}) Tj\n0 -20 Td\n", escape_pdf_text(command)));
    }
    content_stream.push_str("ET\n");

    let objects = vec![
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
        "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n".to_string(),
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1280 820] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n".to_string(),
        format!(
            "4 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            content_stream.len(),
            content_stream
        ),
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
    ];

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }

    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
        objects.len() + 1,
        xref_offset
    ));

    pdf.into_bytes()
}

pub fn build_media_export(
    format: &str,
    title: &str,
    canvas_mode: &str,
    commands: &[String],
    cover_image_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, AppError> {
    let export_id = crate::utils::short_id();
    let temp_dir = std::env::temp_dir().join(format!("geograba-export-{export_id}"));
    fs::create_dir_all(&temp_dir)
        .map_err(|err| AppError::Internal(format!("unable to prepare export temp dir: {err}")))?;

    let background_path = temp_dir.join("background.png");
    if let Some(bytes) = cover_image_bytes {
        fs::write(&background_path, bytes).map_err(|err| {
            AppError::Internal(format!("unable to write export background image: {err}"))
        })?;
    } else {
        fs::write(&background_path, minimal_png_bytes()).map_err(|err| {
            AppError::Internal(format!("unable to write fallback background image: {err}"))
        })?;
    }

    let output_extension = if format == "gif" { "gif" } else { "mp4" };
    let output_path = temp_dir.join(format!("export.{output_extension}"));
    let filter = build_drawtext_filter(title, canvas_mode, commands);

    let mut command = Command::new("ffmpeg");
    command
        .arg("-y")
        .arg("-loop")
        .arg("1")
        .arg("-i")
        .arg(&background_path)
        .arg("-vf")
        .arg(filter)
        .arg("-t")
        .arg(if format == "gif" { "4" } else { "6" });

    if format == "gif" {
        command.arg(&output_path);
    } else {
        command
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-c:v")
            .arg("libx264")
            .arg(&output_path);
    }

    let output = command
        .output()
        .map_err(|err| AppError::Internal(format!("unable to launch ffmpeg: {err}")))?;
    if !output.status.success() {
        return Err(AppError::Internal(format!(
            "ffmpeg export failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let bytes = fs::read(&output_path)
        .map_err(|err| AppError::Internal(format!("unable to read export artifact: {err}")))?;
    let _ = fs::remove_dir_all(&temp_dir);
    Ok(bytes)
}

fn build_drawtext_filter(title: &str, canvas_mode: &str, commands: &[String]) -> String {
    let mut filters = Vec::new();
    filters.push("scale=1280:720".to_string());
    filters.push(drawtext_segment(
        &sanitize_ffmpeg_text(title),
        40,
        40,
        36,
        "white",
        Some("box=1:boxcolor=black@0.55:boxborderw=8"),
    ));
    filters.push(drawtext_segment(
        &sanitize_ffmpeg_text(&format!("Canvas: {canvas_mode}")),
        40,
        92,
        20,
        "white",
        Some("box=1:boxcolor=black@0.45:boxborderw=6"),
    ));

    for (index, command) in commands.iter().take(8).enumerate() {
        filters.push(drawtext_segment(
            &sanitize_ffmpeg_text(command),
            40,
            150 + (index as i32 * 38),
            22,
            "white",
            Some("box=1:boxcolor=black@0.4:boxborderw=4"),
        ));
    }

    filters.join(",")
}

fn drawtext_segment(
    text: &str,
    x: i32,
    y: i32,
    font_size: i32,
    font_color: &str,
    extra: Option<&str>,
) -> String {
    let mut segment = format!(
        "drawtext=text='{}':x={}:y={}:fontsize={}:fontcolor={}",
        text, x, y, font_size, font_color
    );
    if let Some(extra) = extra {
        segment.push(':');
        segment.push_str(extra);
    }
    segment
}

fn sanitize_ffmpeg_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%")
}

fn escape_svg(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn escape_pdf_text(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii() { ch } else { '?' })
        .collect::<String>()
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn minimal_png_bytes() -> &'static [u8] {
    &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 255,
        127, 0, 9, 251, 3, 253, 160, 165, 131, 179, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}
