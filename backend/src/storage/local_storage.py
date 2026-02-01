"""
Local File Storage Service
Replaces S3 for local development and on-premise deployments.

Flow: Upload -> Local Storage -> Dify Ingestion Agents -> PostgreSQL
"""

import os
import shutil
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, BinaryIO
from dataclasses import dataclass, asdict


@dataclass
class FileMetadata:
    """Metadata for stored files."""
    file_id: str
    original_name: str
    file_type: str
    size_bytes: int
    upload_time: str
    checksum: str
    storage_path: str

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


@dataclass
class UploadResult:
    """Result of file upload operation."""
    success: bool
    file_id: Optional[str]
    message: str
    metadata: Optional[FileMetadata]
    is_duplicate: bool = False  # True if file already exists

    def to_dict(self) -> dict:
        result = {
            "success": self.success,
            "file_id": self.file_id,
            "message": self.message,
            "metadata": self.metadata.to_dict() if self.metadata else None,
            "is_duplicate": self.is_duplicate
        }
        return result

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


class LocalStorage:
    """
    Local file storage service.

    Provides S3-like interface for local file storage:
    - upload: Store a file
    - download: Retrieve a file
    - delete: Remove a file
    - list: List stored files
    - get_metadata: Get file metadata
    """

    def __init__(self, base_path: str = "./uploads"):
        """
        Initialize local storage.

        Args:
            base_path: Base directory for file storage
        """
        self.base_path = Path(base_path).resolve()
        self.files_dir = self.base_path / "files"
        self.metadata_dir = self.base_path / "metadata"

        # Create directories if they don't exist
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)

    def _generate_file_id(self, file_name: str, content: bytes) -> str:
        """Generate unique file ID based on content hash and timestamp."""
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
        content_hash = hashlib.sha256(content[:8192]).hexdigest()[:16]
        safe_name = "".join(c for c in file_name if c.isalnum() or c in ".-_")[:32]
        return f"{timestamp}_{content_hash}_{safe_name}"

    def _get_file_path(self, file_id: str) -> Path:
        """Get storage path for a file."""
        # Organize by date prefix for better file system performance
        date_prefix = file_id[:8] if len(file_id) >= 8 else "unknown"
        return self.files_dir / date_prefix / file_id

    def _get_metadata_path(self, file_id: str) -> Path:
        """Get metadata file path."""
        date_prefix = file_id[:8] if len(file_id) >= 8 else "unknown"
        return self.metadata_dir / date_prefix / f"{file_id}.json"

    def _calculate_checksum(self, content: bytes) -> str:
        """Calculate SHA-256 checksum."""
        return hashlib.sha256(content).hexdigest()

    def _detect_file_type(self, file_name: str, content: bytes) -> str:
        """Detect file type from extension and magic bytes."""
        # Extension-based detection
        ext = Path(file_name).suffix.lower()
        ext_types = {
            ".pdf": "application/pdf",
            ".txt": "text/plain",
            ".csv": "text/csv",
            ".json": "application/json",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xls": "application/vnd.ms-excel",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".ppt": "application/vnd.ms-powerpoint",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".html": "text/html",
            ".xml": "application/xml",
            ".md": "text/markdown",
        }

        if ext in ext_types:
            return ext_types[ext]

        # Magic bytes detection for common formats
        if content[:4] == b'%PDF':
            return "application/pdf"
        if content[:2] == b'PK':  # ZIP-based formats (docx, xlsx, pptx)
            return "application/zip"

        return "application/octet-stream"

    def upload(
        self,
        file_name: str,
        content: bytes,
        file_type: Optional[str] = None,
        skip_duplicate_check: bool = False
    ) -> UploadResult:
        """
        Upload a file to local storage.

        Args:
            file_name: Original file name
            content: File content as bytes
            file_type: MIME type (auto-detected if not provided)
            skip_duplicate_check: If True, skip duplicate check and always upload

        Returns:
            UploadResult with success status and metadata
        """
        try:
            # Calculate checksum first for duplicate check
            checksum = self._calculate_checksum(content)

            # Check for duplicate file by checksum
            if not skip_duplicate_check:
                existing = self.find_by_checksum(checksum)
                if existing:
                    return UploadResult(
                        success=True,
                        file_id=existing.file_id,
                        message=f"File already exists (duplicate of {existing.original_name})",
                        metadata=existing,
                        is_duplicate=True
                    )

            # Generate file ID
            file_id = self._generate_file_id(file_name, content)

            # Detect file type if not provided
            if not file_type:
                file_type = self._detect_file_type(file_name, content)

            # Create storage path
            file_path = self._get_file_path(file_id)
            file_path.parent.mkdir(parents=True, exist_ok=True)

            # Write file
            with open(file_path, 'wb') as f:
                f.write(content)

            # Create metadata
            metadata = FileMetadata(
                file_id=file_id,
                original_name=file_name,
                file_type=file_type,
                size_bytes=len(content),
                upload_time=datetime.utcnow().isoformat() + "Z",
                checksum=checksum,
                storage_path=str(file_path)
            )

            # Save metadata
            metadata_path = self._get_metadata_path(file_id)
            metadata_path.parent.mkdir(parents=True, exist_ok=True)
            with open(metadata_path, 'w', encoding='utf-8') as f:
                f.write(metadata.to_json())

            return UploadResult(
                success=True,
                file_id=file_id,
                message="File uploaded successfully",
                metadata=metadata
            )

        except Exception as e:
            return UploadResult(
                success=False,
                file_id=None,
                message=f"Upload failed: {str(e)}",
                metadata=None
            )

    def upload_from_path(self, file_path: str) -> UploadResult:
        """
        Upload a file from filesystem path.

        Args:
            file_path: Path to the file to upload

        Returns:
            UploadResult with success status and metadata
        """
        path = Path(file_path)
        if not path.exists():
            return UploadResult(
                success=False,
                file_id=None,
                message=f"File not found: {file_path}",
                metadata=None
            )

        with open(path, 'rb') as f:
            content = f.read()

        return self.upload(path.name, content)

    def download(self, file_id: str) -> Optional[bytes]:
        """
        Download a file from storage.

        Args:
            file_id: File identifier

        Returns:
            File content as bytes, or None if not found
        """
        file_path = self._get_file_path(file_id)
        if not file_path.exists():
            return None

        with open(file_path, 'rb') as f:
            return f.read()

    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """
        Get file metadata.

        Args:
            file_id: File identifier

        Returns:
            FileMetadata or None if not found
        """
        metadata_path = self._get_metadata_path(file_id)
        if not metadata_path.exists():
            return None

        with open(metadata_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        return FileMetadata(**data)

    def delete(self, file_id: str) -> bool:
        """
        Delete a file from storage.

        Args:
            file_id: File identifier

        Returns:
            True if deleted, False if not found
        """
        file_path = self._get_file_path(file_id)
        metadata_path = self._get_metadata_path(file_id)

        deleted = False

        if file_path.exists():
            file_path.unlink()
            deleted = True

        if metadata_path.exists():
            metadata_path.unlink()
            deleted = True

        return deleted

    def list_files(self, limit: int = 100, offset: int = 0) -> list[FileMetadata]:
        """
        List stored files.

        Args:
            limit: Maximum number of files to return
            offset: Number of files to skip

        Returns:
            List of FileMetadata objects
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info(f"[LocalStorage.list_files] Called with limit={limit}, offset={offset}")
        logger.info(f"[LocalStorage.list_files] metadata_dir={self.metadata_dir}")
        logger.info(f"[LocalStorage.list_files] metadata_dir exists={self.metadata_dir.exists()}")

        files = []

        if not self.metadata_dir.exists():
            logger.error(f"[LocalStorage.list_files] metadata_dir does not exist!")
            return files

        try:
            date_dirs = list(sorted(self.metadata_dir.iterdir(), reverse=True))
            logger.info(f"[LocalStorage.list_files] Found {len(date_dirs)} date directories")
        except Exception as e:
            logger.error(f"[LocalStorage.list_files] Error listing date dirs: {e}")
            return files

        for date_dir in date_dirs:
            if not date_dir.is_dir():
                continue

            logger.info(f"[LocalStorage.list_files] Processing date_dir: {date_dir.name}")

            try:
                meta_files = list(sorted(date_dir.iterdir(), reverse=True))
                logger.info(f"[LocalStorage.list_files] Found {len(meta_files)} files in {date_dir.name}")
            except Exception as e:
                logger.error(f"[LocalStorage.list_files] Error listing meta files: {e}")
                continue

            for meta_file in meta_files:
                if not meta_file.suffix == '.json':
                    continue

                if offset > 0:
                    offset -= 1
                    continue

                if len(files) >= limit:
                    logger.info(f"[LocalStorage.list_files] Reached limit, returning {len(files)} files")
                    return files

                try:
                    with open(meta_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    files.append(FileMetadata(**data))
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"[LocalStorage.list_files] Failed to parse {meta_file}: {e}")
                    continue

        logger.info(f"[LocalStorage.list_files] Returning {len(files)} files")
        return files

    def exists(self, file_id: str) -> bool:
        """Check if a file exists."""
        return self._get_file_path(file_id).exists()

    def find_by_checksum(self, checksum: str) -> Optional[FileMetadata]:
        """
        Find existing file by checksum.

        Args:
            checksum: SHA-256 checksum to search for

        Returns:
            FileMetadata if found, None otherwise
        """
        for date_dir in self.metadata_dir.iterdir():
            if not date_dir.is_dir():
                continue

            for meta_file in date_dir.iterdir():
                if not meta_file.suffix == '.json':
                    continue

                try:
                    with open(meta_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if data.get("checksum") == checksum:
                        return FileMetadata(**data)
                except (json.JSONDecodeError, TypeError, KeyError):
                    continue

        return None

    def get_storage_stats(self) -> dict:
        """Get storage statistics."""
        total_files = 0
        total_size = 0

        for date_dir in self.files_dir.iterdir():
            if not date_dir.is_dir():
                continue

            for file_path in date_dir.iterdir():
                if file_path.is_file():
                    total_files += 1
                    total_size += file_path.stat().st_size

        return {
            "total_files": total_files,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "storage_path": str(self.base_path)
        }


# Convenience functions
_default_storage: Optional[LocalStorage] = None


def get_storage(base_path: str = "./uploads") -> LocalStorage:
    """Get or create default storage instance."""
    global _default_storage
    if _default_storage is None:
        _default_storage = LocalStorage(base_path)
    return _default_storage


def upload_file(file_name: str, content: bytes, file_type: Optional[str] = None) -> UploadResult:
    """Upload a file using default storage."""
    return get_storage().upload(file_name, content, file_type)


def download_file(file_id: str) -> Optional[bytes]:
    """Download a file using default storage."""
    return get_storage().download(file_id)


def delete_file(file_id: str) -> bool:
    """Delete a file using default storage."""
    return get_storage().delete(file_id)
