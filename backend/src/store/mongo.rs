use bytes::Bytes;
use mongodb::bson::{doc, spec::BinarySubtype, Binary, Bson, Document};
use mongodb::options::IndexOptions;
use mongodb::{Client as MongoClient, Collection, IndexModel};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

use crate::error::AppError;
use crate::metrics::MetricsRegistry;
use crate::types::{
    AssetRecord, DrawingJobRecord, ExportJobRecord, ProjectRecord, ProjectVersionRecord,
    SessionRecord, ShareRecord, UploadedAsset, UserRecord,
};
use crate::utils::{deserialize_payload, serialize_payload};

#[derive(Clone)]
pub struct MongoStore {
    assets: Collection<Document>,
    asset_payloads: Collection<Document>,
    jobs: Collection<Document>,
    shares: Collection<Document>,
    projects: Collection<Document>,
    project_versions: Collection<Document>,
    export_jobs: Collection<Document>,
    users: Collection<Document>,
    sessions: Collection<Document>,
    metrics: Arc<MetricsRegistry>,
}

impl MongoStore {
    pub async fn connect(
        uri: &str,
        database_name: &str,
        metrics: Arc<MetricsRegistry>,
    ) -> Result<Self, AppError> {
        let client = MongoClient::with_uri_str(uri)
            .await
            .map_err(|err| AppError::Internal(format!("unable to connect to MongoDB: {err}")))?;
        let database = client.database(database_name);
        let started_at = Instant::now();
        database
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|err| AppError::Internal(format!("unable to ping MongoDB: {err}")))?;
        metrics.record_mongo_query("ping", started_at.elapsed());

        let store = Self {
            assets: database.collection("assets"),
            asset_payloads: database.collection("asset_payloads"),
            jobs: database.collection("drawing_jobs"),
            shares: database.collection("shares"),
            projects: database.collection("projects"),
            project_versions: database.collection("project_versions"),
            export_jobs: database.collection("export_jobs"),
            users: database.collection("users"),
            sessions: database.collection("sessions"),
            metrics,
        };
        store.ensure_indexes().await?;

        Ok(store)
    }

    pub async fn upsert_asset(&self, record: &AssetRecord) -> Result<(), AppError> {
        self.upsert_json(
            "upsert_asset",
            &self.assets,
            "key",
            &record.asset_id,
            record,
        )
        .await
    }

    pub async fn find_asset(&self, asset_id: &str) -> Result<Option<AssetRecord>, AppError> {
        self.find_json("find_asset", &self.assets, doc! { "key": asset_id })
            .await
    }

    pub async fn save_asset_payload(
        &self,
        asset_id: &str,
        content_type: &str,
        bytes: &Bytes,
    ) -> Result<(), AppError> {
        let payload = doc! {
            "key": asset_id,
            "contentType": content_type,
            "bytes": Bson::Binary(Binary {
                subtype: BinarySubtype::Generic,
                bytes: bytes.to_vec(),
            }),
        };

        let started_at = Instant::now();
        self.asset_payloads
            .replace_one(doc! { "key": asset_id }, payload)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist asset payload: {err}")))?;
        self.metrics
            .record_mongo_query("save_asset_payload", started_at.elapsed());
        Ok(())
    }

    pub async fn find_asset_payload(
        &self,
        asset_id: &str,
    ) -> Result<Option<UploadedAsset>, AppError> {
        let started_at = Instant::now();
        let document = self
            .asset_payloads
            .find_one(doc! { "key": asset_id })
            .await
            .map_err(|err| AppError::Internal(format!("unable to load asset payload: {err}")))?;
        self.metrics
            .record_mongo_query("find_asset_payload", started_at.elapsed());

        let Some(document) = document else {
            return Ok(None);
        };

        let content_type = document
            .get_str("contentType")
            .map(ToString::to_string)
            .unwrap_or_else(|_| "application/octet-stream".to_string());
        let bytes = document
            .get_binary_generic("bytes")
            .map(Bytes::copy_from_slice)
            .map_err(|err| AppError::Internal(format!("invalid asset payload bytes: {err}")))?;

        Ok(Some(UploadedAsset {
            content_type,
            bytes,
        }))
    }

    pub async fn upsert_job(&self, record: &DrawingJobRecord) -> Result<(), AppError> {
        self.upsert_json("upsert_job", &self.jobs, "key", &record.job_id, record)
            .await
    }

    pub async fn find_job(&self, job_id: &str) -> Result<Option<DrawingJobRecord>, AppError> {
        self.find_json("find_job", &self.jobs, doc! { "key": job_id })
            .await
    }

    pub async fn find_any_job(&self) -> Result<Option<DrawingJobRecord>, AppError> {
        self.find_json("find_any_job", &self.jobs, doc! {}).await
    }

    pub async fn upsert_share(&self, record: &ShareRecord) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.share_id,
            "slug": &record.slug,
            "payload": payload,
        };

        let started_at = Instant::now();
        self.shares
            .replace_one(doc! { "key": &record.share_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist share: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_share", started_at.elapsed());
        Ok(())
    }

    pub async fn upsert_project(&self, record: &ProjectRecord) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.project_id,
            "workspaceKey": &record.owner_workspace_key,
            "updatedAt": record.updated_at.to_rfc3339(),
            "isFavorite": record.is_favorite,
            "folder": &record.folder,
            "payload": payload,
        };

        let started_at = Instant::now();
        self.projects
            .replace_one(doc! { "key": &record.project_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist project: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_project", started_at.elapsed());
        Ok(())
    }

    pub async fn find_project(&self, project_id: &str) -> Result<Option<ProjectRecord>, AppError> {
        self.find_json("find_project", &self.projects, doc! { "key": project_id })
            .await
    }

    pub async fn find_projects_by_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<ProjectRecord>, AppError> {
        self.find_many_json(
            "find_projects_by_workspace",
            &self.projects,
            doc! { "workspaceKey": workspace_key },
        )
        .await
    }

    pub async fn upsert_project_version(
        &self,
        record: &ProjectVersionRecord,
    ) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.version_id,
            "projectId": &record.project_id,
            "workspaceKey": &record.owner_workspace_key,
            "createdAt": record.created_at.to_rfc3339(),
            "payload": payload,
        };

        let started_at = Instant::now();
        self.project_versions
            .replace_one(doc! { "key": &record.version_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist project version: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_project_version", started_at.elapsed());
        Ok(())
    }

    pub async fn find_project_versions(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectVersionRecord>, AppError> {
        self.find_many_json(
            "find_project_versions",
            &self.project_versions,
            doc! { "projectId": project_id },
        )
        .await
    }

    pub async fn upsert_export_job(&self, record: &ExportJobRecord) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.export_job_id,
            "workspaceKey": &record.owner_workspace_key,
            "projectId": record.project_id.clone(),
            "updatedAt": record.updated_at.to_rfc3339(),
            "format": &record.format,
            "status": serde_json::to_string(&record.status).unwrap_or_else(|_| "\"failed\"".to_string()),
            "payload": payload,
        };

        let started_at = Instant::now();
        self.export_jobs
            .replace_one(doc! { "key": &record.export_job_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist export job: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_export_job", started_at.elapsed());
        Ok(())
    }

    pub async fn find_export_job(
        &self,
        export_job_id: &str,
    ) -> Result<Option<ExportJobRecord>, AppError> {
        self.find_json("find_export_job", &self.export_jobs, doc! { "key": export_job_id })
            .await
    }

    pub async fn find_share_by_slug(&self, slug: &str) -> Result<Option<ShareRecord>, AppError> {
        self.find_json("find_share_by_slug", &self.shares, doc! { "slug": slug })
            .await
    }

    pub async fn upsert_user(&self, record: &UserRecord) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.user_id,
            "email": &record.email,
            "username": &record.username,
            "payload": payload,
        };

        let started_at = Instant::now();
        self.users
            .replace_one(doc! { "key": &record.user_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist user: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_user", started_at.elapsed());
        Ok(())
    }

    pub async fn find_user_by_id(&self, user_id: &str) -> Result<Option<UserRecord>, AppError> {
        self.find_json("find_user_by_id", &self.users, doc! { "key": user_id })
            .await
    }

    pub async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, AppError> {
        self.find_json("find_user_by_email", &self.users, doc! { "email": email })
            .await
    }

    pub async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        self.find_json(
            "find_user_by_username",
            &self.users,
            doc! { "username": username },
        )
        .await
    }

    pub async fn upsert_session(&self, record: &SessionRecord) -> Result<(), AppError> {
        let payload = serialize_payload(record)?;
        let document = doc! {
            "key": &record.session_id,
            "token": &record.token,
            "userId": &record.user_id,
            "payload": payload,
        };

        let started_at = Instant::now();
        self.sessions
            .replace_one(doc! { "key": &record.session_id }, document)
            .upsert(true)
            .await
            .map_err(|err| AppError::Internal(format!("unable to persist session: {err}")))?;
        self.metrics
            .record_mongo_query("upsert_session", started_at.elapsed());
        Ok(())
    }

    pub async fn find_session_by_token(
        &self,
        token: &str,
    ) -> Result<Option<SessionRecord>, AppError> {
        self.find_json(
            "find_session_by_token",
            &self.sessions,
            doc! { "token": token },
        )
        .await
    }

    pub async fn delete_session_by_token(
        &self,
        token: &str,
    ) -> Result<Option<SessionRecord>, AppError> {
        let existing = self.find_session_by_token(token).await?;
        let Some(session) = existing.clone() else {
            return Ok(None);
        };

        let started_at = Instant::now();
        self.sessions
            .delete_one(doc! { "token": token })
            .await
            .map_err(|err| AppError::Internal(format!("unable to delete session: {err}")))?;
        self.metrics
            .record_mongo_query("delete_session_by_token", started_at.elapsed());

        Ok(Some(session))
    }

    async fn ensure_indexes(&self) -> Result<(), AppError> {
        self.create_unique_index(
            "create_index_assets_key",
            &self.assets,
            doc! { "key": 1 },
            "assets_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_asset_payloads_key",
            &self.asset_payloads,
            doc! { "key": 1 },
            "asset_payloads_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_jobs_key",
            &self.jobs,
            doc! { "key": 1 },
            "drawing_jobs_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_shares_key",
            &self.shares,
            doc! { "key": 1 },
            "shares_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_shares_slug",
            &self.shares,
            doc! { "slug": 1 },
            "shares_slug_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_projects_key",
            &self.projects,
            doc! { "key": 1 },
            "projects_key_unique",
        )
        .await?;
        self.create_index(
            "create_index_projects_workspace",
            &self.projects,
            doc! { "workspaceKey": 1, "updatedAt": -1 },
            "projects_workspace_updated",
        )
        .await?;
        self.create_unique_index(
            "create_index_project_versions_key",
            &self.project_versions,
            doc! { "key": 1 },
            "project_versions_key_unique",
        )
        .await?;
        self.create_index(
            "create_index_project_versions_project",
            &self.project_versions,
            doc! { "projectId": 1, "createdAt": -1 },
            "project_versions_project_created",
        )
        .await?;
        self.create_unique_index(
            "create_index_export_jobs_key",
            &self.export_jobs,
            doc! { "key": 1 },
            "export_jobs_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_users_key",
            &self.users,
            doc! { "key": 1 },
            "users_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_users_email",
            &self.users,
            doc! { "email": 1 },
            "users_email_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_users_username",
            &self.users,
            doc! { "username": 1 },
            "users_username_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_sessions_key",
            &self.sessions,
            doc! { "key": 1 },
            "sessions_key_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_sessions_token",
            &self.sessions,
            doc! { "token": 1 },
            "sessions_token_unique",
        )
        .await?;

        Ok(())
    }

    async fn upsert_json<T: Serialize>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        key_field: &str,
        key: &str,
        value: &T,
    ) -> Result<(), AppError> {
        let payload = serialize_payload(value)?;
        let mut document = Document::new();
        document.insert(key_field, key);
        document.insert("payload", payload);

        let mut filter = Document::new();
        filter.insert(key_field, key);

        let started_at = Instant::now();
        collection
            .replace_one(filter, document)
            .upsert(true)
            .await
            .map_err(|err| {
                AppError::Internal(format!("unable to persist MongoDB document: {err}"))
            })?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());
        Ok(())
    }

    async fn find_json<T: DeserializeOwned>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        filter: Document,
    ) -> Result<Option<T>, AppError> {
        let started_at = Instant::now();
        let document = collection
            .find_one(filter)
            .await
            .map_err(|err| AppError::Internal(format!("unable to read MongoDB document: {err}")))?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());

        document.map(deserialize_payload).transpose()
    }

    async fn find_many_json<T: DeserializeOwned>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        filter: Document,
    ) -> Result<Vec<T>, AppError> {
        let started_at = Instant::now();
        let mut cursor = collection
            .find(filter)
            .await
            .map_err(|err| AppError::Internal(format!("unable to read MongoDB documents: {err}")))?;
        let mut items = Vec::new();

        while cursor
            .advance()
            .await
            .map_err(|err| AppError::Internal(format!("unable to iterate MongoDB documents: {err}")))?
        {
            let document = cursor
                .deserialize_current()
                .map_err(|err| AppError::Internal(format!("invalid MongoDB document: {err}")))?;
            items.push(deserialize_payload(document)?);
        }

        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());
        Ok(items)
    }

    async fn create_unique_index(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        keys: Document,
        name: &str,
    ) -> Result<(), AppError> {
        let started_at = Instant::now();
        let options = IndexOptions::builder()
            .name(Some(name.to_string()))
            .unique(Some(true))
            .build();
        let model = IndexModel::builder()
            .keys(keys)
            .options(Some(options))
            .build();

        collection
            .create_index(model)
            .await
            .map_err(|err| AppError::Internal(format!("unable to create MongoDB index: {err}")))?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());
        Ok(())
    }

    async fn create_index(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        keys: Document,
        name: &str,
    ) -> Result<(), AppError> {
        let started_at = Instant::now();
        let options = IndexOptions::builder()
            .name(Some(name.to_string()))
            .build();
        let model = IndexModel::builder()
            .keys(keys)
            .options(Some(options))
            .build();

        collection
            .create_index(model)
            .await
            .map_err(|err| AppError::Internal(format!("unable to create MongoDB index: {err}")))?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());
        Ok(())
    }
}
