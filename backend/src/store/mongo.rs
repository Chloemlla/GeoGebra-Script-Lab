use bytes::Bytes;
use mongodb::bson::{doc, from_document, spec::BinarySubtype, to_document, Binary, Bson, Document};
use mongodb::options::IndexOptions;
use mongodb::{Client as MongoClient, Collection, IndexModel};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::metrics::MetricsRegistry;
use crate::threat_intel::SCAMALYTICS_SETTING_ID;
use crate::types::{
    AssetRecord, DrawingJobRecord, ExportJobRecord, IpThreatProviderConfigRecord, ProjectRecord,
    ProjectVersionRecord, ReviewCommentRecord, SessionRecord, ShareRecord, TeamMembershipRecord,
    TeamRecord, UploadedAsset, UserRecord,
};

#[derive(Clone)]
pub struct MongoStore {
    assets: Collection<Document>,
    asset_payloads: Collection<Document>,
    jobs: Collection<Document>,
    shares: Collection<Document>,
    projects: Collection<Document>,
    project_versions: Collection<Document>,
    export_jobs: Collection<Document>,
    teams: Collection<Document>,
    team_memberships: Collection<Document>,
    review_comments: Collection<Document>,
    users: Collection<Document>,
    sessions: Collection<Document>,
    app_settings: Collection<Document>,
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
            teams: database.collection("teams"),
            team_memberships: database.collection("team_memberships"),
            review_comments: database.collection("review_comments"),
            users: database.collection("users"),
            sessions: database.collection("sessions"),
            app_settings: database.collection("app_settings"),
            metrics,
        };
        store.ensure_indexes().await?;

        Ok(store)
    }

    pub async fn upsert_asset(&self, record: &AssetRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_asset", &self.assets, &record.asset_id, record)
            .await
    }

    pub async fn find_asset(&self, asset_id: &str) -> Result<Option<AssetRecord>, AppError> {
        self.find_one_record("find_asset", &self.assets, doc! { "_id": asset_id }, None)
            .await
    }

    pub async fn save_asset_payload(
        &self,
        asset_id: &str,
        content_type: &str,
        bytes: &Bytes,
    ) -> Result<(), AppError> {
        let document = doc! {
            "_id": asset_id,
            "contentType": content_type,
            "bytes": Bson::Binary(Binary {
                subtype: BinarySubtype::Generic,
                bytes: bytes.to_vec(),
            }),
        };

        let started_at = Instant::now();
        self.asset_payloads
            .replace_one(doc! { "_id": asset_id }, document)
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
            .find_one(doc! { "_id": asset_id })
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
            .map(|bytes| Bytes::copy_from_slice(bytes))
            .map_err(|err| AppError::Internal(format!("invalid asset payload bytes: {err}")))?;

        Ok(Some(UploadedAsset {
            content_type,
            bytes,
        }))
    }

    pub async fn upsert_job(&self, record: &DrawingJobRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_job", &self.jobs, &record.job_id, record)
            .await
    }

    pub async fn find_job(&self, job_id: &str) -> Result<Option<DrawingJobRecord>, AppError> {
        self.find_one_record("find_job", &self.jobs, doc! { "_id": job_id }, None)
            .await
    }

    pub async fn find_any_job(&self) -> Result<Option<DrawingJobRecord>, AppError> {
        self.find_one_record(
            "find_any_job",
            &self.jobs,
            doc! {},
            Some(doc! { "updated_at": -1 }),
        )
        .await
    }

    pub async fn upsert_share(&self, record: &ShareRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_share", &self.shares, &record.share_id, record)
            .await
    }

    pub async fn find_share_by_slug(&self, slug: &str) -> Result<Option<ShareRecord>, AppError> {
        self.find_one_record(
            "find_share_by_slug",
            &self.shares,
            doc! { "slug": slug },
            None,
        )
        .await
    }

    pub async fn upsert_project(&self, record: &ProjectRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_project", &self.projects, &record.project_id, record)
            .await
    }

    pub async fn find_project(&self, project_id: &str) -> Result<Option<ProjectRecord>, AppError> {
        self.find_one_record(
            "find_project",
            &self.projects,
            doc! { "_id": project_id },
            None,
        )
        .await
    }

    pub async fn find_projects_by_workspace(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<ProjectRecord>, AppError> {
        self.find_many_records(
            "find_projects_by_workspace",
            &self.projects,
            doc! { "ownerWorkspaceKey": workspace_key },
            Some(doc! { "updatedAt": -1 }),
        )
        .await
    }

    pub async fn find_projects_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<ProjectRecord>, AppError> {
        self.find_many_records(
            "find_projects_by_user",
            &self.projects,
            doc! { "ownerUserId": user_id },
            Some(doc! { "updatedAt": -1 }),
        )
        .await
    }

    pub async fn find_projects_by_team(
        &self,
        team_id: &str,
    ) -> Result<Vec<ProjectRecord>, AppError> {
        self.find_many_records(
            "find_projects_by_team",
            &self.projects,
            doc! { "teamId": team_id },
            Some(doc! { "updatedAt": -1 }),
        )
        .await
    }

    pub async fn upsert_project_version(
        &self,
        record: &ProjectVersionRecord,
    ) -> Result<(), AppError> {
        self.upsert_record(
            "upsert_project_version",
            &self.project_versions,
            &record.version_id,
            record,
        )
        .await
    }

    pub async fn find_project_versions(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectVersionRecord>, AppError> {
        self.find_many_records(
            "find_project_versions",
            &self.project_versions,
            doc! { "projectId": project_id },
            Some(doc! { "createdAt": -1 }),
        )
        .await
    }

    pub async fn upsert_export_job(&self, record: &ExportJobRecord) -> Result<(), AppError> {
        self.upsert_record(
            "upsert_export_job",
            &self.export_jobs,
            &record.export_job_id,
            record,
        )
        .await
    }

    pub async fn find_export_job(
        &self,
        export_job_id: &str,
    ) -> Result<Option<ExportJobRecord>, AppError> {
        self.find_one_record(
            "find_export_job",
            &self.export_jobs,
            doc! { "_id": export_job_id },
            None,
        )
        .await
    }

    pub async fn upsert_team(&self, record: &TeamRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_team", &self.teams, &record.team_id, record)
            .await
    }

    pub async fn find_team(&self, team_id: &str) -> Result<Option<TeamRecord>, AppError> {
        self.find_one_record("find_team", &self.teams, doc! { "_id": team_id }, None)
            .await
    }

    pub async fn find_teams_by_user(&self, user_id: &str) -> Result<Vec<TeamRecord>, AppError> {
        let memberships = self
            .find_team_memberships_by_user(user_id)
            .await?
            .into_iter()
            .map(|membership| membership.team_id)
            .collect::<Vec<_>>();
        let mut teams = Vec::new();

        for team_id in memberships {
            if let Some(team) = self.find_team(&team_id).await? {
                teams.push(team);
            }
        }

        Ok(teams)
    }

    pub async fn upsert_team_membership(
        &self,
        record: &TeamMembershipRecord,
    ) -> Result<(), AppError> {
        self.upsert_record(
            "upsert_team_membership",
            &self.team_memberships,
            &record.membership_id,
            record,
        )
        .await
    }

    pub async fn find_team_memberships_by_team(
        &self,
        team_id: &str,
    ) -> Result<Vec<TeamMembershipRecord>, AppError> {
        self.find_many_records(
            "find_team_memberships_by_team",
            &self.team_memberships,
            doc! { "teamId": team_id },
            None,
        )
        .await
    }

    pub async fn find_team_memberships_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<TeamMembershipRecord>, AppError> {
        self.find_many_records(
            "find_team_memberships_by_user",
            &self.team_memberships,
            doc! { "userId": user_id },
            None,
        )
        .await
    }

    pub async fn upsert_review_comment(
        &self,
        record: &ReviewCommentRecord,
    ) -> Result<(), AppError> {
        self.upsert_record(
            "upsert_review_comment",
            &self.review_comments,
            &record.comment_id,
            record,
        )
        .await
    }

    pub async fn find_review_comment(
        &self,
        comment_id: &str,
    ) -> Result<Option<ReviewCommentRecord>, AppError> {
        self.find_one_record(
            "find_review_comment",
            &self.review_comments,
            doc! { "_id": comment_id },
            None,
        )
        .await
    }

    pub async fn find_review_comments_by_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<ReviewCommentRecord>, AppError> {
        self.find_many_records(
            "find_review_comments_by_project",
            &self.review_comments,
            doc! { "projectId": project_id },
            Some(doc! { "updatedAt": -1 }),
        )
        .await
    }

    pub async fn upsert_user(&self, record: &UserRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_user", &self.users, &record.user_id, record)
            .await
    }

    pub async fn find_user_by_id(&self, user_id: &str) -> Result<Option<UserRecord>, AppError> {
        self.find_one_record(
            "find_user_by_id",
            &self.users,
            doc! { "_id": user_id },
            None,
        )
        .await
    }

    pub async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, AppError> {
        self.find_one_record(
            "find_user_by_email",
            &self.users,
            doc! { "email": email },
            None,
        )
        .await
    }

    pub async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, AppError> {
        self.find_one_record(
            "find_user_by_username",
            &self.users,
            doc! { "username": username },
            None,
        )
        .await
    }

    pub async fn find_first_user(&self) -> Result<Option<UserRecord>, AppError> {
        self.find_one_record(
            "find_first_user",
            &self.users,
            doc! {},
            Some(doc! { "createdAt": 1 }),
        )
        .await
    }

    pub async fn count_admin_users(&self) -> Result<u64, AppError> {
        let started_at = Instant::now();
        let count = self
            .users
            .count_documents(doc! { "isAdmin": true })
            .await
            .map_err(|err| AppError::Internal(format!("unable to count admin users: {err}")))?;
        self.metrics
            .record_mongo_query("count_admin_users", started_at.elapsed());

        Ok(count)
    }

    pub async fn count_users(&self) -> Result<u64, AppError> {
        let started_at = Instant::now();
        let count = self
            .users
            .count_documents(doc! {})
            .await
            .map_err(|err| AppError::Internal(format!("unable to count users: {err}")))?;
        self.metrics
            .record_mongo_query("count_users", started_at.elapsed());

        Ok(count)
    }

    pub async fn upsert_session(&self, record: &SessionRecord) -> Result<(), AppError> {
        self.upsert_record("upsert_session", &self.sessions, &record.session_id, record)
            .await
    }

    pub async fn upsert_ip_threat_provider_config(
        &self,
        record: &IpThreatProviderConfigRecord,
    ) -> Result<(), AppError> {
        self.upsert_record(
            "upsert_ip_threat_provider_config",
            &self.app_settings,
            &record.setting_id,
            record,
        )
        .await
    }

    pub async fn find_ip_threat_provider_config(
        &self,
    ) -> Result<Option<IpThreatProviderConfigRecord>, AppError> {
        self.find_one_record(
            "find_ip_threat_provider_config",
            &self.app_settings,
            doc! { "_id": SCAMALYTICS_SETTING_ID },
            None,
        )
        .await
    }

    pub async fn find_session_by_token(
        &self,
        token: &str,
    ) -> Result<Option<SessionRecord>, AppError> {
        self.find_one_record(
            "find_session_by_token",
            &self.sessions,
            doc! { "token": token },
            None,
        )
        .await
    }

    pub async fn delete_session_by_token(
        &self,
        token: &str,
    ) -> Result<Option<SessionRecord>, AppError> {
        let started_at = Instant::now();
        let document = self
            .sessions
            .find_one_and_delete(doc! { "token": token })
            .await
            .map_err(|err| AppError::Internal(format!("unable to delete session: {err}")))?;
        self.metrics
            .record_mongo_query("delete_session_by_token", started_at.elapsed());

        document.map(document_into_record).transpose()
    }

    async fn ensure_indexes(&self) -> Result<(), AppError> {
        self.create_index(
            "create_index_jobs_updated_at",
            &self.jobs,
            doc! { "updated_at": -1 },
            "drawing_jobs_updated_at_desc",
        )
        .await?;
        self.create_unique_index(
            "create_index_shares_slug",
            &self.shares,
            doc! { "slug": 1 },
            "shares_slug_unique",
        )
        .await?;
        self.create_index(
            "create_index_projects_workspace",
            &self.projects,
            doc! { "ownerWorkspaceKey": 1, "updatedAt": -1 },
            "projects_workspace_updated",
        )
        .await?;
        self.create_index(
            "create_index_projects_user",
            &self.projects,
            doc! { "ownerUserId": 1, "updatedAt": -1 },
            "projects_user_updated",
        )
        .await?;
        self.create_index(
            "create_index_projects_team",
            &self.projects,
            doc! { "teamId": 1, "updatedAt": -1 },
            "projects_team_updated",
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
            "create_index_teams_slug",
            &self.teams,
            doc! { "slug": 1 },
            "teams_slug_unique",
        )
        .await?;
        self.create_index(
            "create_index_team_memberships_team",
            &self.team_memberships,
            doc! { "teamId": 1 },
            "team_memberships_team",
        )
        .await?;
        self.create_index(
            "create_index_team_memberships_user",
            &self.team_memberships,
            doc! { "userId": 1 },
            "team_memberships_user",
        )
        .await?;
        self.create_index(
            "create_index_review_comments_project",
            &self.review_comments,
            doc! { "projectId": 1, "updatedAt": -1 },
            "review_comments_project_updated",
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
            "create_index_sessions_token",
            &self.sessions,
            doc! { "token": 1 },
            "sessions_token_unique",
        )
        .await?;
        self.create_unique_index(
            "create_index_app_settings_provider",
            &self.app_settings,
            doc! { "provider": 1 },
            "app_settings_provider_unique",
        )
        .await?;
        self.create_ttl_index(
            "create_index_sessions_expires_at_ttl",
            &self.sessions,
            doc! { "expiresAt": 1 },
            "sessions_expires_at_ttl",
            Duration::from_secs(0),
        )
        .await?;

        Ok(())
    }

    async fn upsert_record<T: Serialize>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        id: &str,
        value: &T,
    ) -> Result<(), AppError> {
        let mut document = to_document(value).map_err(|err| {
            AppError::Internal(format!("unable to build MongoDB document: {err}"))
        })?;
        document.insert("_id", id);

        let started_at = Instant::now();
        collection
            .replace_one(doc! { "_id": id }, document)
            .upsert(true)
            .await
            .map_err(|err| {
                AppError::Internal(format!("unable to persist MongoDB document: {err}"))
            })?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());

        Ok(())
    }

    async fn find_one_record<T: DeserializeOwned>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        filter: Document,
        sort: Option<Document>,
    ) -> Result<Option<T>, AppError> {
        let started_at = Instant::now();
        let action = collection.find_one(filter);
        let action = if let Some(sort) = sort {
            action.sort(sort)
        } else {
            action
        };
        let document = action
            .await
            .map_err(|err| AppError::Internal(format!("unable to read MongoDB document: {err}")))?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());

        document.map(document_into_record).transpose()
    }

    async fn find_many_records<T: DeserializeOwned>(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        filter: Document,
        sort: Option<Document>,
    ) -> Result<Vec<T>, AppError> {
        let started_at = Instant::now();
        let action = collection.find(filter);
        let action = if let Some(sort) = sort {
            action.sort(sort)
        } else {
            action
        };
        let mut cursor = action.await.map_err(|err| {
            AppError::Internal(format!("unable to read MongoDB documents: {err}"))
        })?;
        let mut items = Vec::new();

        while cursor.advance().await.map_err(|err| {
            AppError::Internal(format!("unable to iterate MongoDB documents: {err}"))
        })? {
            let document = cursor
                .deserialize_current()
                .map_err(|err| AppError::Internal(format!("invalid MongoDB document: {err}")))?;
            items.push(document_into_record(document)?);
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
        let options = IndexOptions::builder().name(Some(name.to_string())).build();
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

    async fn create_ttl_index(
        &self,
        operation_name: &str,
        collection: &Collection<Document>,
        keys: Document,
        name: &str,
        expire_after: Duration,
    ) -> Result<(), AppError> {
        let started_at = Instant::now();
        let options = IndexOptions::builder()
            .name(Some(name.to_string()))
            .expire_after(Some(expire_after))
            .build();
        let model = IndexModel::builder()
            .keys(keys)
            .options(Some(options))
            .build();

        collection.create_index(model).await.map_err(|err| {
            AppError::Internal(format!("unable to create MongoDB TTL index: {err}"))
        })?;
        self.metrics
            .record_mongo_query(operation_name, started_at.elapsed());

        Ok(())
    }
}

fn document_into_record<T: DeserializeOwned>(document: Document) -> Result<T, AppError> {
    from_document(document)
        .map_err(|err| AppError::Internal(format!("unable to deserialize MongoDB document: {err}")))
}
