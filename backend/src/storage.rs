use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use tokio::fs;

use crate::error::AppError;

#[derive(Debug)]
pub struct AssetFileStore {
    root: PathBuf,
}

impl AssetFileStore {
    pub async fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).await.map_err(|err| {
            AppError::Internal(format!(
                "unable to create asset storage directory {}: {err}",
                root.display()
            ))
        })?;

        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub async fn save(&self, asset_id: &str, bytes: &Bytes) -> Result<(), AppError> {
        let path = self.path_for(asset_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(|err| {
                AppError::Internal(format!(
                    "unable to create asset shard directory {}: {err}",
                    parent.display()
                ))
            })?;
        }

        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, bytes).await.map_err(|err| {
            AppError::Internal(format!(
                "unable to write asset payload {}: {err}",
                temp_path.display()
            ))
        })?;
        fs::rename(&temp_path, &path).await.map_err(|err| {
            AppError::Internal(format!(
                "unable to finalize asset payload {}: {err}",
                path.display()
            ))
        })?;

        Ok(())
    }

    pub async fn load(&self, asset_id: &str) -> Result<Option<Bytes>, AppError> {
        let path = self.path_for(asset_id);
        match fs::read(&path).await {
            Ok(bytes) => Ok(Some(Bytes::from(bytes))),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
            Err(err) => Err(AppError::Internal(format!(
                "unable to read asset payload {}: {err}",
                path.display()
            ))),
        }
    }

    fn path_for(&self, asset_id: &str) -> PathBuf {
        let normalized = asset_id.strip_prefix("asset_").unwrap_or(asset_id);
        let shard = &normalized[..normalized.len().min(2)];
        self.root.join(shard).join(format!("{asset_id}.bin"))
    }
}
