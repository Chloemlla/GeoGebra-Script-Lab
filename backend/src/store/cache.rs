use std::collections::HashMap;

use crate::types::{
    AssetRecord, DrawingJobRecord, SessionRecord, ShareRecord, UploadedAsset, UserRecord,
};

#[derive(Default)]
pub struct MemoryStore {
    pub assets: HashMap<String, AssetRecord>,
    pub asset_payloads: HashMap<String, UploadedAsset>,
    pub jobs: HashMap<String, DrawingJobRecord>,
    pub shares: HashMap<String, ShareRecord>,
    pub share_slugs: HashMap<String, String>,
    pub users: HashMap<String, UserRecord>,
    pub sessions: HashMap<String, SessionRecord>,
}
