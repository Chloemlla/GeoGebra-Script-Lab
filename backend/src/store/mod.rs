mod cache;
mod mongo;

pub use cache::MemoryStore;
pub use mongo::MongoStore;

use crate::error::AppError;
use crate::state::AppState;
use crate::types::{
    AssetRecord, DrawingJobRecord, ExportJobRecord, ProjectRecord, ProjectVersionRecord,
    SessionRecord, ShareRecord, UploadedAsset, UserRecord,
};

const MAX_IN_MEMORY_ASSET_PAYLOAD_BYTES: usize = 512 * 1024;

pub async fn find_asset_record(
    asset_id: &str,
    state: &AppState,
) -> Result<Option<AssetRecord>, AppError> {
    if let Some(record) = state.store.read().await.assets.get(asset_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_asset(asset_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .assets
                .insert(asset_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.assets.get(asset_id).cloned())
}

pub async fn find_asset_payload(
    asset_id: &str,
    state: &AppState,
) -> Result<Option<UploadedAsset>, AppError> {
    if let Some(payload) = state
        .store
        .read()
        .await
        .asset_payloads
        .get(asset_id)
        .cloned()
    {
        return Ok(Some(payload));
    }

    if let Some(record) = find_asset_record(asset_id, state).await? {
        if let Some(bytes) = state.asset_file_store.load(asset_id).await? {
            let payload = UploadedAsset {
                content_type: record.mime_type,
                bytes,
            };
            cache_asset_payload(state, asset_id, payload.clone()).await;
            return Ok(Some(payload));
        }
    }

    if let Some(mongo_store) = &state.mongo_store {
        let payload = mongo_store.find_asset_payload(asset_id).await?;
        if let Some(payload) = payload.clone() {
            state
                .asset_file_store
                .save(asset_id, &payload.bytes)
                .await?;
            cache_asset_payload(state, asset_id, payload.clone()).await;
        }
        return Ok(payload);
    }

    Ok(None)
}

pub async fn find_job_record(
    job_id: &str,
    state: &AppState,
) -> Result<Option<DrawingJobRecord>, AppError> {
    if let Some(record) = state.store.read().await.jobs.get(job_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_job(job_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .jobs
                .insert(job_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.jobs.get(job_id).cloned())
}

pub async fn find_any_job_record(state: &AppState) -> Result<Option<DrawingJobRecord>, AppError> {
    if let Some(record) = state.store.read().await.jobs.values().next().cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_any_job().await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .jobs
                .insert(record.job_id.clone(), record.clone());
        }
        return Ok(record);
    }

    Ok(state.store.read().await.jobs.values().next().cloned())
}

pub async fn find_share_by_slug(
    slug: &str,
    state: &AppState,
) -> Result<Option<ShareRecord>, AppError> {
    if let Some(share_id) = state.store.read().await.share_slugs.get(slug).cloned() {
        if let Some(record) = state.store.read().await.shares.get(&share_id).cloned() {
            return Ok(Some(record));
        }
    }

    if let Some(record) = state
        .store
        .read()
        .await
        .shares
        .values()
        .find(|record| record.slug == slug)
        .cloned()
    {
        state
            .store
            .write()
            .await
            .share_slugs
            .insert(record.slug.clone(), record.share_id.clone());
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_share_by_slug(slug).await?;
        if let Some(record) = record.clone() {
            let mut store = state.store.write().await;
            store
                .share_slugs
                .insert(record.slug.clone(), record.share_id.clone());
            store.shares.insert(record.share_id.clone(), record.clone());
        }
        return Ok(record);
    }

    Ok(None)
}

pub async fn find_project_record(
    project_id: &str,
    state: &AppState,
) -> Result<Option<ProjectRecord>, AppError> {
    if let Some(record) = state.store.read().await.projects.get(project_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_project(project_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .projects
                .insert(project_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.projects.get(project_id).cloned())
}

pub async fn list_projects_by_workspace(
    workspace_key: &str,
    state: &AppState,
) -> Result<Vec<ProjectRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .projects
        .values()
        .filter(|record| record.owner_workspace_key == workspace_key)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_projects_by_workspace(workspace_key).await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store
                .projects
                .insert(record.project_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    Ok(memory_items)
}

pub async fn upsert_project_record(state: &AppState, record: &ProjectRecord) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_project(record).await?;
    }

    state
        .store
        .write()
        .await
        .projects
        .insert(record.project_id.clone(), record.clone());

    Ok(())
}

pub async fn find_project_versions_by_project(
    project_id: &str,
    state: &AppState,
) -> Result<Vec<ProjectVersionRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .project_versions
        .values()
        .filter(|record| record.project_id == project_id)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_project_versions(project_id).await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store
                .project_versions
                .insert(record.version_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    Ok(memory_items)
}

pub async fn upsert_project_version_record(
    state: &AppState,
    record: &ProjectVersionRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_project_version(record).await?;
    }

    state
        .store
        .write()
        .await
        .project_versions
        .insert(record.version_id.clone(), record.clone());

    Ok(())
}

pub async fn find_export_job_record(
    export_job_id: &str,
    state: &AppState,
) -> Result<Option<ExportJobRecord>, AppError> {
    if let Some(record) = state.store.read().await.export_jobs.get(export_job_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_export_job(export_job_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .export_jobs
                .insert(export_job_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.export_jobs.get(export_job_id).cloned())
}

pub async fn upsert_export_job_record(
    state: &AppState,
    record: &ExportJobRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_export_job(record).await?;
    }

    state
        .store
        .write()
        .await
        .export_jobs
        .insert(record.export_job_id.clone(), record.clone());

    Ok(())
}

pub async fn find_user_by_id(
    user_id: &str,
    state: &AppState,
) -> Result<Option<UserRecord>, AppError> {
    if let Some(record) = state.store.read().await.users.get(user_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_user_by_id(user_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .users
                .insert(user_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.users.get(user_id).cloned())
}

pub async fn find_user_by_email(
    email: &str,
    state: &AppState,
) -> Result<Option<UserRecord>, AppError> {
    if let Some(record) = state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.email == email)
        .cloned()
    {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_user_by_email(email).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .users
                .insert(record.user_id.clone(), record.clone());
        }
        return Ok(record);
    }

    Ok(state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.email == email)
        .cloned())
}

pub async fn find_user_by_username(
    username: &str,
    state: &AppState,
) -> Result<Option<UserRecord>, AppError> {
    if let Some(record) = state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.username == username)
        .cloned()
    {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_user_by_username(username).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .users
                .insert(record.user_id.clone(), record.clone());
        }
        return Ok(record);
    }

    Ok(state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.username == username)
        .cloned())
}

pub async fn find_session_by_token(
    token: &str,
    state: &AppState,
) -> Result<Option<SessionRecord>, AppError> {
    if let Some(record) = state
        .store
        .read()
        .await
        .sessions
        .values()
        .find(|record| record.token == token)
        .cloned()
    {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_session_by_token(token).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .sessions
                .insert(record.session_id.clone(), record.clone());
        }
        return Ok(record);
    }

    Ok(state
        .store
        .read()
        .await
        .sessions
        .values()
        .find(|record| record.token == token)
        .cloned())
}

pub async fn revoke_session_by_token(
    token: &str,
    state: &AppState,
) -> Result<Option<SessionRecord>, AppError> {
    let mut removed = {
        let mut store = state.store.write().await;
        let session_id = store
            .sessions
            .values()
            .find(|record| record.token == token)
            .map(|record| record.session_id.clone());
        session_id.and_then(|session_id| store.sessions.remove(&session_id))
    };

    if let Some(mongo_store) = &state.mongo_store {
        let deleted = mongo_store.delete_session_by_token(token).await?;
        if removed.is_none() {
            removed = deleted;
        }
    }

    Ok(removed)
}

pub async fn upsert_asset_record(state: &AppState, record: &AssetRecord) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_asset(record).await?;
    }

    state
        .store
        .write()
        .await
        .assets
        .insert(record.asset_id.clone(), record.clone());

    Ok(())
}

pub async fn upsert_job_record(
    state: &AppState,
    record: &DrawingJobRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_job(record).await?;
    }

    state
        .store
        .write()
        .await
        .jobs
        .insert(record.job_id.clone(), record.clone());

    Ok(())
}

pub async fn upsert_share_record(state: &AppState, record: &ShareRecord) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_share(record).await?;
    }

    let mut store = state.store.write().await;
    store
        .share_slugs
        .insert(record.slug.clone(), record.share_id.clone());
    store.shares.insert(record.share_id.clone(), record.clone());

    Ok(())
}

pub async fn cache_asset_payload(state: &AppState, asset_id: &str, payload: UploadedAsset) {
    let mut store = state.store.write().await;
    if payload.bytes.len() <= MAX_IN_MEMORY_ASSET_PAYLOAD_BYTES {
        store.asset_payloads.insert(asset_id.to_string(), payload);
    } else {
        store.asset_payloads.remove(asset_id);
    }
}
