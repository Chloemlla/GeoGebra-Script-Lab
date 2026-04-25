use uuid::Uuid;

pub fn fallback_commands() -> Vec<String> {
    vec![
        "A = (-3, 0)".to_string(),
        "B = (3, 0)".to_string(),
        "C = (1, 4)".to_string(),
        "tri = Polygon(A, B, C)".to_string(),
        "M = Midpoint(B, C)".to_string(),
        "median = Segment(A, M)".to_string(),
    ]
}

pub fn request_id() -> String {
    format!("req_{}", short_id())
}

pub fn short_id() -> String {
    Uuid::new_v4().as_simple().to_string()[..24].to_string()
}

pub fn short_id_suffix() -> String {
    Uuid::new_v4().as_simple().to_string()[..6].to_string()
}

pub fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}
