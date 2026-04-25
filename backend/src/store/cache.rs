use std::collections::HashMap;

use crate::types::{
    AssetRecord, DrawingJobRecord, ExportJobRecord, ProjectRecord, ProjectVersionRecord,
    SessionRecord, ShareRecord, UploadedAsset, UserRecord,
};

#[derive(Default)]
pub struct MemoryStore {
    pub assets: HashMap<String, AssetRecord>,
    pub asset_payloads: HashMap<String, UploadedAsset>,
    pub jobs: HashMap<String, DrawingJobRecord>,
    pub shares: HashMap<String, ShareRecord>,
    pub share_slugs: HashMap<String, String>,
    pub projects: HashMap<String, ProjectRecord>,
    pub project_versions: HashMap<String, ProjectVersionRecord>,
    pub export_jobs: HashMap<String, ExportJobRecord>,
    pub users: HashMap<String, UserRecord>,
    pub user_emails: HashMap<String, String>,
    pub usernames: HashMap<String, String>,
    pub sessions: HashMap<String, SessionRecord>,
    pub session_tokens: HashMap<String, String>,
}
