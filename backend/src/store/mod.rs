mod cache;
mod mongo;

pub use cache::MemoryStore;
pub use mongo::MongoStore;

use crate::error::AppError;
use crate::state::AppState;
use crate::threat_intel::SCAMALYTICS_SETTING_ID;
use crate::types::{
    AssetRecord, DrawingJobRecord, ExportJobRecord, IpThreatProviderConfigRecord, ProjectRecord,
    ProjectVersionRecord, ReviewCommentRecord, SessionRecord, ShareRecord, TeamMembershipRecord,
    TeamRecord, UploadedAsset, UserRecord,
};

const MAX_IN_MEMORY_ASSET_PAYLOAD_BYTES: usize = 512 * 1024;

pub async fn find_ip_threat_provider_config(
    state: &AppState,
) -> Result<Option<IpThreatProviderConfigRecord>, AppError> {
    if let Some(record) = state
        .store
        .read()
        .await
        .ip_threat_provider_configs
        .get(SCAMALYTICS_SETTING_ID)
        .cloned()
    {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_ip_threat_provider_config().await?;
        if let Some(record) = record.clone() {
            cache_ip_threat_provider_config(state, &record).await;
        }
        return Ok(record);
    }

    Ok(None)
}

pub async fn upsert_ip_threat_provider_config(
    state: &AppState,
    record: &IpThreatProviderConfigRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_ip_threat_provider_config(record).await?;
    }

    cache_ip_threat_provider_config(state, record).await;
    Ok(())
}

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

    if let Some(mongo_store) = &state.mongo_store {
        let payload = mongo_store.find_asset_payload(asset_id).await?;
        if let Some(payload) = payload.clone() {
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
            cache_share_record(state, &record).await;
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
        let mongo_items = mongo_store
            .find_projects_by_workspace(workspace_key)
            .await?;
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

pub async fn list_projects_by_user(
    user_id: &str,
    state: &AppState,
) -> Result<Vec<ProjectRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .projects
        .values()
        .filter(|record| record.owner_user_id == user_id)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_projects_by_user(user_id).await?;
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

pub async fn list_projects_by_team(
    team_id: &str,
    state: &AppState,
) -> Result<Vec<ProjectRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .projects
        .values()
        .filter(|record| record.team_id.as_deref() == Some(team_id))
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_projects_by_team(team_id).await?;
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

pub async fn upsert_project_record(
    state: &AppState,
    record: &ProjectRecord,
) -> Result<(), AppError> {
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
    if let Some(record) = state
        .store
        .read()
        .await
        .export_jobs
        .get(export_job_id)
        .cloned()
    {
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

    Ok(state
        .store
        .read()
        .await
        .export_jobs
        .get(export_job_id)
        .cloned())
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

pub async fn find_team_record(
    team_id: &str,
    state: &AppState,
) -> Result<Option<TeamRecord>, AppError> {
    if let Some(record) = state.store.read().await.teams.get(team_id).cloned() {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_team(team_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .teams
                .insert(team_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state.store.read().await.teams.get(team_id).cloned())
}

pub async fn list_teams_by_user(
    user_id: &str,
    state: &AppState,
) -> Result<Vec<TeamRecord>, AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_teams_by_user(user_id).await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store.teams.insert(record.team_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    let memberships = list_team_memberships_by_user(user_id, state).await?;
    let team_ids = memberships
        .into_iter()
        .map(|membership| membership.team_id)
        .collect::<std::collections::HashSet<_>>();
    let memory_items = state
        .store
        .read()
        .await
        .teams
        .values()
        .filter(|team| team.owner_user_id == user_id || team_ids.contains(&team.team_id))
        .cloned()
        .collect::<Vec<_>>();

    Ok(memory_items)
}

pub async fn upsert_team_record(state: &AppState, record: &TeamRecord) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_team(record).await?;
    }

    state
        .store
        .write()
        .await
        .teams
        .insert(record.team_id.clone(), record.clone());

    Ok(())
}

pub async fn list_team_memberships_by_team(
    team_id: &str,
    state: &AppState,
) -> Result<Vec<TeamMembershipRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .team_memberships
        .values()
        .filter(|membership| membership.team_id == team_id)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_team_memberships_by_team(team_id).await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store
                .team_memberships
                .insert(record.membership_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    Ok(memory_items)
}

pub async fn list_team_memberships_by_user(
    user_id: &str,
    state: &AppState,
) -> Result<Vec<TeamMembershipRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .team_memberships
        .values()
        .filter(|membership| membership.user_id == user_id)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store.find_team_memberships_by_user(user_id).await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store
                .team_memberships
                .insert(record.membership_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    Ok(memory_items)
}

pub async fn upsert_team_membership_record(
    state: &AppState,
    record: &TeamMembershipRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_team_membership(record).await?;
    }

    state
        .store
        .write()
        .await
        .team_memberships
        .insert(record.membership_id.clone(), record.clone());

    Ok(())
}

pub async fn find_review_comment_record(
    comment_id: &str,
    state: &AppState,
) -> Result<Option<ReviewCommentRecord>, AppError> {
    if let Some(record) = state
        .store
        .read()
        .await
        .review_comments
        .get(comment_id)
        .cloned()
    {
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_review_comment(comment_id).await?;
        if let Some(record) = record.clone() {
            state
                .store
                .write()
                .await
                .review_comments
                .insert(comment_id.to_string(), record);
        }
        return Ok(record);
    }

    Ok(state
        .store
        .read()
        .await
        .review_comments
        .get(comment_id)
        .cloned())
}

pub async fn list_review_comments_by_project(
    project_id: &str,
    state: &AppState,
) -> Result<Vec<ReviewCommentRecord>, AppError> {
    let memory_items = state
        .store
        .read()
        .await
        .review_comments
        .values()
        .filter(|comment| comment.project_id == project_id)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(mongo_store) = &state.mongo_store {
        let mongo_items = mongo_store
            .find_review_comments_by_project(project_id)
            .await?;
        let mut store = state.store.write().await;
        for record in &mongo_items {
            store
                .review_comments
                .insert(record.comment_id.clone(), record.clone());
        }
        return Ok(mongo_items);
    }

    Ok(memory_items)
}

pub async fn upsert_review_comment_record(
    state: &AppState,
    record: &ReviewCommentRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_review_comment(record).await?;
    }

    state
        .store
        .write()
        .await
        .review_comments
        .insert(record.comment_id.clone(), record.clone());

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
            cache_user_record(state, &record).await;
        }
        return Ok(record);
    }

    Ok(state.store.read().await.users.get(user_id).cloned())
}

pub async fn find_user_by_email(
    email: &str,
    state: &AppState,
) -> Result<Option<UserRecord>, AppError> {
    if let Some(user_id) = state.store.read().await.user_emails.get(email).cloned() {
        if let Some(record) = state.store.read().await.users.get(&user_id).cloned() {
            return Ok(Some(record));
        }
    }

    if let Some(record) = state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.email == email)
        .cloned()
    {
        cache_user_record(state, &record).await;
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_user_by_email(email).await?;
        if let Some(record) = record.clone() {
            cache_user_record(state, &record).await;
        }
        return Ok(record);
    }

    Ok(None)
}

pub async fn find_user_by_username(
    username: &str,
    state: &AppState,
) -> Result<Option<UserRecord>, AppError> {
    if let Some(user_id) = state.store.read().await.usernames.get(username).cloned() {
        if let Some(record) = state.store.read().await.users.get(&user_id).cloned() {
            return Ok(Some(record));
        }
    }

    if let Some(record) = state
        .store
        .read()
        .await
        .users
        .values()
        .find(|record| record.username == username)
        .cloned()
    {
        cache_user_record(state, &record).await;
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_user_by_username(username).await?;
        if let Some(record) = record.clone() {
            cache_user_record(state, &record).await;
        }
        return Ok(record);
    }

    Ok(None)
}

pub async fn find_first_user_record(state: &AppState) -> Result<Option<UserRecord>, AppError> {
    let memory_first = state
        .store
        .read()
        .await
        .users
        .values()
        .min_by(|left, right| left.created_at.cmp(&right.created_at))
        .cloned();

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_first_user().await?;
        if let Some(record) = record.clone() {
            cache_user_record(state, &record).await;
        }
        return Ok(record.or(memory_first));
    }

    Ok(memory_first)
}

pub async fn count_admin_users(state: &AppState) -> Result<u64, AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        return mongo_store.count_admin_users().await;
    }

    Ok(state
        .store
        .read()
        .await
        .users
        .values()
        .filter(|user| user.is_admin)
        .count() as u64)
}

pub async fn count_users(state: &AppState) -> Result<u64, AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        return mongo_store.count_users().await;
    }

    Ok(state.store.read().await.users.len() as u64)
}

pub async fn find_session_by_token(
    token: &str,
    state: &AppState,
) -> Result<Option<SessionRecord>, AppError> {
    if let Some(session_id) = state.store.read().await.session_tokens.get(token).cloned() {
        if let Some(record) = state.store.read().await.sessions.get(&session_id).cloned() {
            return Ok(Some(record));
        }
    }

    if let Some(record) = state
        .store
        .read()
        .await
        .sessions
        .values()
        .find(|record| record.token == token)
        .cloned()
    {
        cache_session_record(state, &record).await;
        return Ok(Some(record));
    }

    if let Some(mongo_store) = &state.mongo_store {
        let record = mongo_store.find_session_by_token(token).await?;
        if let Some(record) = record.clone() {
            cache_session_record(state, &record).await;
        }
        return Ok(record);
    }

    Ok(None)
}

pub async fn revoke_session_by_token(
    token: &str,
    state: &AppState,
) -> Result<Option<SessionRecord>, AppError> {
    let removed = {
        let mut store = state.store.write().await;
        let session_id = store.session_tokens.remove(token).or_else(|| {
            store
                .sessions
                .values()
                .find(|record| record.token == token)
                .map(|record| record.session_id.clone())
        });

        session_id.and_then(|session_id| {
            let record = store.sessions.remove(&session_id);
            if let Some(record) = &record {
                store.session_tokens.remove(&record.token);
            }
            record
        })
    };

    let mongo_removed = if let Some(mongo_store) = &state.mongo_store {
        mongo_store.delete_session_by_token(token).await?
    } else {
        None
    };

    Ok(removed.or(mongo_removed))
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

    cache_share_record(state, record).await;

    Ok(())
}

pub async fn upsert_user_record(state: &AppState, record: &UserRecord) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_user(record).await?;
    }

    cache_user_record(state, record).await;

    Ok(())
}

pub async fn upsert_session_record(
    state: &AppState,
    record: &SessionRecord,
) -> Result<(), AppError> {
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_session(record).await?;
    }

    cache_session_record(state, record).await;

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

async fn cache_share_record(state: &AppState, record: &ShareRecord) {
    let mut store = state.store.write().await;
    store
        .share_slugs
        .insert(record.slug.clone(), record.share_id.clone());
    store.shares.insert(record.share_id.clone(), record.clone());
}

async fn cache_user_record(state: &AppState, record: &UserRecord) {
    let mut store = state.store.write().await;
    store
        .user_emails
        .insert(record.email.clone(), record.user_id.clone());
    store
        .usernames
        .insert(record.username.clone(), record.user_id.clone());
    store.users.insert(record.user_id.clone(), record.clone());
}

async fn cache_session_record(state: &AppState, record: &SessionRecord) {
    let mut store = state.store.write().await;
    store
        .session_tokens
        .insert(record.token.clone(), record.session_id.clone());
    store
        .sessions
        .insert(record.session_id.clone(), record.clone());
}

async fn cache_ip_threat_provider_config(state: &AppState, record: &IpThreatProviderConfigRecord) {
    state
        .store
        .write()
        .await
        .ip_threat_provider_configs
        .insert(record.setting_id.clone(), record.clone());
}
