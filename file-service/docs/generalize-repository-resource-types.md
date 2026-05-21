# Plan: Generalize File-Service to Support Multiple Resource Types (Datasets + Models)

> **NOTE**: This plan was originally written with `repository` as the generalized table/class name.
> The final implementation uses `asset` instead (table: `asset`, PK: `aid`, classes: `Asset*`, endpoints: `/asset/...`).
> The `repository_name` column is retained as-is since it refers to the LakeFS repository name.

## 1. Problem Statement

Currently the file-service manages only **datasets**. Every table, class, variable, endpoint, and URI scheme is hardcoded around the word "dataset". We want users to also upload and store **models** (and potentially other resource types in the future) using the same LakeFS + MinIO infrastructure.

### New Logical Address Format

The logical address that the frontend sends to the backend changes from:

```
OLD:  /ownerEmail/datasetName/versionName/filePath
NEW:  /datasets/ownerEmail/repoName/versionName/filePath
      /models/ownerEmail/repoName/versionName/filePath
```

The **first segment** is the **resource type** (`datasets` or `models`). The rest of the path is identical in structure. The backend still resolves data using the second-through-last segments, but the first segment tells it which *type* of resource is being accessed.

### Design Approach

Two changes:

1. **Rename** all `dataset`-prefixed tables, columns, classes, and variables to `repository_`-prefixed names, reflecting that a "repository" is a general-purpose versioned file store (like a git repo) — not specific to datasets.
2. **Add a `type` column** to the `repository` table (enum: `dataset`, `model`) so the resource type from the logical address prefix is persisted and queryable.

---

## 2. Current Architecture Summary

### 2.1 Database Tables (in `texera_ddl.sql`)

| Current Table | Primary Key | Purpose |
|---|---|---|
| `dataset` | `did` | Main resource table (name, owner, repo_name, publicity, etc.) |
| `dataset_version` | `dvid` | Version snapshots (name, version_hash = LakeFS commit ID) |
| `dataset_user_access` | `(did, uid)` | Access control (privilege: READ/WRITE/NONE) |
| `dataset_upload_session` | `(uid, did, file_path)` | Active multipart upload tracking |
| `dataset_upload_session_part` | `(upload_id, part_number)` | Per-part ETag tracking |
| `dataset_user_likes` | `(uid, did)` | User likes |
| `dataset_view_count` | `did` | View analytics |

### 2.2 Key Backend Files

| File | Location | Role |
|---|---|---|
| `DatasetResource.scala` | `file-service/.../resource/` | Main REST API (~40 endpoints, ~1000 lines) |
| `DatasetAccessResource.scala` | `file-service/.../resource/` | Access control REST API |
| `DatasetFileNode.scala` | `file-service/.../type/dataset/` | File tree model |
| `DatasetFileNodeSerializer.java` | `file-service/.../type/serde/` | JSON serializer |
| `LakeFSExceptionHandler.scala` | `file-service/.../util/` | Error handling |
| `MigrateDatasetStorageNamespace.scala` | `file-service/.../migration/` | S3 migration tool |
| `DatasetResourceSpec.scala` | `file-service/.../test/` | Test suite |
| `MockLakeFS.scala` | `file-service/.../test/` | Mock LakeFS |
| `FileResolver.scala` | `common/workflow-core/.../storage/` | Logical path → URI resolution |
| `DatasetFileDocument.scala` | `common/workflow-core/.../storage/model/` | URI → file content |
| `DocumentFactory.scala` | `common/workflow-core/.../storage/` | URI scheme routing |
| `LakeFSStorageClient.scala` | `common/workflow-core/.../storage/util/` | LakeFS API wrapper |

### 2.3 JOOQ Generated Code (auto-generated from DB schema)

| Package | Classes |
|---|---|
| `tables.pojos` | `Dataset`, `DatasetVersion`, `DatasetUserAccess`, `DatasetUploadSession`, `DatasetUploadSessionPart` |
| `tables.daos` | `DatasetDao`, `DatasetVersionDao`, `DatasetUserAccessDao`, etc. |
| `tables` | `Dataset.DATASET`, `DatasetVersion.DATASET_VERSION`, etc. (table references) |

### 2.4 Frontend Files

| File | Role |
|---|---|
| `frontend/.../common/type/dataset.ts` | `Dataset`, `DatasetVersion` TypeScript interfaces |
| `frontend/.../dashboard/service/user/dataset/dataset.service.ts` | Angular HTTP service with all endpoint URLs |
| `frontend/.../dashboard/component/user/user-dataset/*` | Dataset dashboard UI components |
| `frontend/.../dashboard/component/user/user-ml-model/*` | ML model dashboard UI (currently reuses dataset infra) |

### 2.5 Repository Naming

When a dataset is created, the LakeFS repository name is constructed as:
```scala
// DatasetResource.scala:313
val repositoryName = s"dataset-${createdDataset.getDid}"
```
This is the **only place** where the `dataset-` prefix is hardcoded in repository naming. The name is then persisted in `dataset.repository_name` and looked up from the database everywhere else.

### 2.6 URI Scheme

```
dataset:///{repositoryName}/{versionHash}/{filePath}
```
This scheme is defined in `FileResolver.DATASET_FILE_URI_SCHEME = "dataset"` and routed in `DocumentFactory.openReadonlyDocument()`.

---

## 3. Detailed Change Plan

### Phase 1: Database Schema Migration

**Goal**: Rename all `dataset_*` tables to `repository_*` and add the `type` column.

#### 3.1.1 Create New Enum Type

```sql
CREATE TYPE repository_type_enum AS ENUM ('dataset', 'model');
```

#### 3.1.2 Rename Tables

| Old Name | New Name |
|---|---|
| `dataset` | `repository` |
| `dataset_version` | `repository_version` |
| `dataset_user_access` | `repository_user_access` |
| `dataset_upload_session` | `repository_upload_session` |
| `dataset_upload_session_part` | `repository_upload_session_part` |
| `dataset_user_likes` | `repository_user_likes` |
| `dataset_view_count` | `repository_view_count` |

#### 3.1.3 Rename Primary Key Column

| Old Column | New Column | Table |
|---|---|---|
| `did` | `rid` | `repository` (and all FK references) |
| `dvid` | `rvid` | `repository_version` |

#### 3.1.4 Add `type` Column to `repository`

```sql
ALTER TABLE repository ADD COLUMN type repository_type_enum NOT NULL DEFAULT 'dataset';
```

#### 3.1.5 Full New `repository` Table DDL

```sql
CREATE TABLE IF NOT EXISTS repository
(
    rid             SERIAL PRIMARY KEY,
    owner_uid       INT NOT NULL,
    name            VARCHAR(128) NOT NULL,
    type            repository_type_enum NOT NULL DEFAULT 'dataset',
    repository_name VARCHAR(128),
    is_public       BOOLEAN NOT NULL DEFAULT TRUE,
    is_downloadable BOOLEAN NOT NULL DEFAULT TRUE,
    description     TEXT NOT NULL,
    creation_time   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cover_image     VARCHAR(255),
    FOREIGN KEY (owner_uid) REFERENCES "user"(uid) ON DELETE CASCADE
);
```

#### 3.1.6 Uniqueness Constraint

Currently uniqueness is per (owner, name). With the type column, the same user can have a dataset named "test" AND a model named "test":

```sql
-- Old: UNIQUE(owner_uid, name) — implicit from current usage
-- New: UNIQUE(owner_uid, name, type)
CREATE UNIQUE INDEX idx_repository_owner_name_type ON repository(owner_uid, name, type);
```

#### 3.1.7 Migration Script

A SQL migration script should:
1. Create `repository_type_enum`
2. Rename tables using `ALTER TABLE ... RENAME TO ...`
3. Rename PK columns (`did` → `rid`, `dvid` → `rvid`)
4. Add the `type` column with default `'dataset'`
5. Add the uniqueness index
6. Update PGroonga indexes (they reference table names)

#### 3.1.8 Update `texera_ddl.sql`

The DDL file that creates the schema from scratch must be updated to reflect all new names and the new `type` column.

---

### Phase 2: JOOQ Code Regeneration

**Goal**: Regenerate JOOQ classes to reflect new table/column names.

After the DDL changes, run the JOOQ code generator. This will produce:

| Old Class | New Class |
|---|---|
| `tables.Dataset` / `DATASET` | `tables.Repository` / `REPOSITORY` |
| `tables.DatasetVersion` / `DATASET_VERSION` | `tables.RepositoryVersion` / `REPOSITORY_VERSION` |
| `tables.DatasetUserAccess` / `DATASET_USER_ACCESS` | `tables.RepositoryUserAccess` / `REPOSITORY_USER_ACCESS` |
| `tables.DatasetUploadSession` | `tables.RepositoryUploadSession` |
| `tables.DatasetUploadSessionPart` | `tables.RepositoryUploadSessionPart` |
| `tables.pojos.Dataset` | `tables.pojos.Repository` |
| `tables.pojos.DatasetVersion` | `tables.pojos.RepositoryVersion` |
| `tables.pojos.DatasetUserAccess` | `tables.pojos.RepositoryUserAccess` |
| `tables.daos.DatasetDao` | `tables.daos.RepositoryDao` |
| `tables.daos.DatasetVersionDao` | `tables.daos.RepositoryVersionDao` |
| etc. | etc. |

New additions:
- `tables.pojos.Repository` will have a `getType(): RepositoryTypeEnum` method
- `tables.enums.RepositoryTypeEnum` with values `DATASET`, `MODEL`
- POJO getter/setter: `getRid()` instead of `getDid()`, `getRvid()` instead of `getDvid()`

---

### Phase 3: File-Service Backend Refactoring

#### 3.3.1 Rename `DatasetResource.scala` → `RepositoryResource.scala`

All internal references change:

| Old | New |
|---|---|
| `class DatasetResource` | `class RepositoryResource` |
| `object DatasetResource` | `object RepositoryResource` |
| `@Path("/dataset")` | `@Path("/repository")` |
| `DashboardDataset` | `DashboardRepository` |
| `DashboardDatasetVersion` | `DashboardRepositoryVersion` |
| `CreateDatasetRequest` | `CreateRepositoryRequest` |
| `DatasetDescriptionModification` | `RepositoryDescriptionModification` |
| `getDatasetByID()` | `getRepositoryByID()` |
| `getDatasetVersionByID()` | `getRepositoryVersionByID()` |
| `getLatestDatasetVersion()` | `getLatestRepositoryVersion()` |
| `validateDatasetName()` | `validateRepositoryName()` |
| All `did` path params | `rid` path params |
| All `dvid` path params | `rvid` path params |
| Error messages: "Dataset ..." | "Repository ..." |

#### 3.3.2 Update Repository Name Construction

```scala
// OLD (DatasetResource.scala:313)
val repositoryName = s"dataset-${createdDataset.getDid}"

// NEW (RepositoryResource.scala)
val repositoryName = s"repository-${createdRepository.getRid}"
```

The `CreateRepositoryRequest` case class gains a `type` field:

```scala
case class CreateRepositoryRequest(
    repositoryName: String,
    repositoryDescription: String,
    repositoryType: RepositoryTypeEnum,  // NEW
    isRepositoryPublic: Boolean,
    isRepositoryDownloadable: Boolean
)
```

And creation logic sets it:

```scala
val repository = new Repository()
repository.setName(repositoryName)
repository.setType(request.repositoryType)  // NEW
// ...
```

#### 3.3.3 Rename `DatasetAccessResource.scala` → `RepositoryAccessResource.scala`

| Old | New |
|---|---|
| `class DatasetAccessResource` | `class RepositoryAccessResource` |
| `@Path("/access/dataset")` | `@Path("/access/repository")` |
| `isDatasetPublic()` | `isRepositoryPublic()` |
| `userHasReadAccess(ctx, did, uid)` | `userHasReadAccess(ctx, rid, uid)` |
| `userOwnDataset()` | `userOwnRepository()` |
| `userHasWriteAccess(ctx, did, uid)` | `userHasWriteAccess(ctx, rid, uid)` |
| All `did` params | `rid` params |

#### 3.3.4 Rename `DatasetFileNode.scala` → `RepositoryFileNode.scala`

Rename the class and update all references.

#### 3.3.5 Rename `DatasetFileNodeSerializer.java` → `RepositoryFileNodeSerializer.java`

Update the serializer to reference the new class name.

#### 3.3.6 Update `FileService.scala`

Register the renamed resource classes:
```scala
// OLD
environment.jersey().register(classOf[DatasetResource])
environment.jersey().register(classOf[DatasetAccessResource])

// NEW
environment.jersey().register(classOf[RepositoryResource])
environment.jersey().register(classOf[RepositoryAccessResource])
```

#### 3.3.7 Update `MigrateDatasetStorageNamespace.scala`

Rename to `MigrateRepositoryStorageNamespace.scala` and update all internal references. (This migration tool may need to be preserved for backward compat or rewritten.)

#### 3.3.8 Update Test Files

- `DatasetResourceSpec.scala` → `RepositoryResourceSpec.scala`
- Update all test references from `dataset` to `repository`
- Add test cases for creating models vs datasets

---

### Phase 4: Storage Layer Refactoring (common/workflow-core)

#### 3.4.1 `FileResolver.scala` — Update Logical Path Parsing

The resolver must now handle the new path format with a resource type prefix:

```scala
// OLD format: /ownerEmail/datasetName/versionName/filePath
// NEW format: /datasets/ownerEmail/repoName/versionName/filePath
//         or: /models/ownerEmail/repoName/versionName/filePath
```

Changes:

```scala
// OLD
val DATASET_FILE_URI_SCHEME = "dataset"

// NEW
val REPOSITORY_FILE_URI_SCHEME = "repository"
```

The `parseDatasetFilePath` method becomes `parseRepositoryFilePath`:

```scala
// OLD: expects 4+ segments: ownerEmail/datasetName/versionName/filePath
// NEW: expects 5+ segments: resourceType/ownerEmail/repoName/versionName/filePath

private def parseRepositoryFilePath(
    fileName: String
): Option[(String, String, String, String, Array[String])] = {
  val pathSegments = ...
  if (pathSegments.length < 5) return None

  val resourceType = pathSegments(0)           // "datasets" or "models"
  val ownerEmail = pathSegments(1)
  val repositoryName = pathSegments(2)
  val versionName = pathSegments(3)
  val fileRelativePathSegments = pathSegments.drop(4)

  Some((resourceType, ownerEmail, repositoryName, versionName, fileRelativePathSegments))
}
```

The `datasetResolveFunc` becomes `repositoryResolveFunc` and the DB query adds a `type` filter:

```scala
private def repositoryResolveFunc(fileName: String): URI = {
  val (resourceType, ownerEmail, repoName, versionName, fileSegments) =
    parseRepositoryFilePath(fileName).getOrElse(...)

  // Map prefix to enum
  val repoType = resourceType match {
    case "datasets" => RepositoryTypeEnum.DATASET
    case "models"   => RepositoryTypeEnum.MODEL
    case _          => throw new FileNotFoundException(...)
  }

  val (repository, repositoryVersion) = withTransaction(ctx) {
    val repo = ctx
      .select(REPOSITORY.fields: _*)
      .from(REPOSITORY)
      .leftJoin(USER).on(USER.UID.eq(REPOSITORY.OWNER_UID))
      .where(USER.EMAIL.eq(ownerEmail))
      .and(REPOSITORY.NAME.eq(repoName))
      .and(REPOSITORY.TYPE.eq(repoType))            // NEW filter
      .fetchOneInto(classOf[Repository])
    // ... fetch version ...
  }

  // Build URI: repository:///{repositoryName}/{versionHash}/{filePath}
  new URI(REPOSITORY_FILE_URI_SCHEME, "", encodedPath, null)
}
```

The public helper `parseDatasetOwnerAndName` becomes `parseRepositoryOwnerAndName` and returns the type as well:

```scala
def parseRepositoryOwnerAndName(path: String): Option[(String, String, String)] = {
  parseRepositoryFilePath(path).map {
    case (resourceType, ownerEmail, repoName, _, _) => (resourceType, ownerEmail, repoName)
  }
}
```

#### 3.4.2 `DatasetFileDocument.scala` → `RepositoryFileDocument.scala`

Rename the class. The URI parsing logic is identical (it works with `repositoryName/versionHash/filePath` — no resource type in the URI itself). Only the class and variable names change.

#### 3.4.3 `DocumentFactory.scala` — Update URI Scheme Routing

```scala
// OLD
case DATASET_FILE_URI_SCHEME => new DatasetFileDocument(fileUri)

// NEW
case REPOSITORY_FILE_URI_SCHEME => new RepositoryFileDocument(fileUri)
```

#### 3.4.4 `OnDataset` trait → `OnRepository` trait

```scala
// OLD
trait OnDataset {
  def getRepositoryName(): String
  def getVersionHash(): String
  def getFileRelativePath(): String
}

// NEW
trait OnRepository {
  def getRepositoryName(): String
  def getVersionHash(): String
  def getFileRelativePath(): String
}
```

---

### Phase 5: Frontend Changes

#### 3.5.1 TypeScript Types

**`dataset.ts` → `repository.ts`** (or keep and add):

```typescript
// NEW
export interface Repository {
  rid: number;         // was did
  ownerUid: number;
  name: string;
  type: "dataset" | "model";  // NEW
  isPublic: boolean;
  isDownloadable: boolean;
  storagePath: string;
  description: string;
  creationTime: string;
  coverImage: string;
}

export interface RepositoryVersion {
  rvid: number;        // was dvid
  rid: number;         // was did
  creatorUid: number;
  name: string;
  versionHash: string;
  creationTime: string;
  fileNodes: DatasetFileNode[];
}
```

#### 3.5.2 Angular Service

**`dataset.service.ts` → `repository.service.ts`** (or update in place):

All endpoint URLs change from `/dataset/...` to `/repository/...`:

| Old URL | New URL |
|---|---|
| `dataset/create` | `repository/create` |
| `dataset/list` | `repository/list` |
| `dataset/{did}` | `repository/{rid}` |
| `dataset/{did}/upload` | `repository/{rid}/upload` |
| `dataset/{did}/version/create` | `repository/{rid}/version/create` |
| `dataset/multipart-upload` | `repository/multipart-upload` |
| `dataset/presign-download` | `repository/presign-download` |
| `access/dataset/...` | `access/repository/...` |
| etc. | etc. |

The service methods are renamed accordingly. The `createDataset()` method becomes `createRepository()` and accepts a `type` parameter.

#### 3.5.3 Dashboard Components

- **`user-dataset/`** components continue to work but call the repository service with `type: "dataset"` filter
- **`user-ml-model/`** components call the same repository service with `type: "model"` filter
- Both share the same upload, versioning, and access control UI — just filtered by type

#### 3.5.4 Logical Address Construction

Anywhere the frontend constructs a logical address (e.g., for operator file inputs):

```typescript
// OLD
const path = `/${ownerEmail}/${datasetName}/${versionName}/${filePath}`;

// NEW
const path = `/datasets/${ownerEmail}/${repoName}/${versionName}/${filePath}`;
// or
const path = `/models/${ownerEmail}/${repoName}/${versionName}/${filePath}`;
```

---

### Phase 6: Amber-Side Changes

#### 3.6.1 `amber/.../dataset/DatasetResource.scala`

This file contains only the `DashboardDataset` case class. Rename to `RepositoryResource.scala` with `DashboardRepository`.

#### 3.6.2 Any Other Amber References

Search for all references to `Dataset`, `DatasetVersion`, `DatasetDao`, etc. in the amber module and update to the new names.

---

## 4. File-by-File Change Summary

### Files to Rename

| Old Path | New Path |
|---|---|
| `file-service/.../resource/DatasetResource.scala` | `file-service/.../resource/RepositoryResource.scala` |
| `file-service/.../resource/DatasetAccessResource.scala` | `file-service/.../resource/RepositoryAccessResource.scala` |
| `file-service/.../type/dataset/DatasetFileNode.scala` | `file-service/.../type/repository/RepositoryFileNode.scala` |
| `file-service/.../type/serde/DatasetFileNodeSerializer.java` | `file-service/.../type/serde/RepositoryFileNodeSerializer.java` |
| `file-service/.../migration/MigrateDatasetStorageNamespace.scala` | `file-service/.../migration/MigrateRepositoryStorageNamespace.scala` |
| `file-service/.../test/.../DatasetResourceSpec.scala` | `file-service/.../test/.../RepositoryResourceSpec.scala` |
| `common/workflow-core/.../storage/model/DatasetFileDocument.scala` | `common/workflow-core/.../storage/model/RepositoryFileDocument.scala` |
| `amber/.../dataset/DatasetResource.scala` | `amber/.../repository/RepositoryResource.scala` |
| `frontend/.../common/type/dataset.ts` | `frontend/.../common/type/repository.ts` |
| `frontend/.../dashboard/service/user/dataset/dataset.service.ts` | `frontend/.../dashboard/service/user/repository/repository.service.ts` |

### Files to Modify (Not Rename)

| File | Changes |
|---|---|
| `sql/texera_ddl.sql` | Rename all tables, add enum, add `type` column |
| `common/workflow-core/.../storage/FileResolver.scala` | New path format, `type` filter, rename constants |
| `common/workflow-core/.../storage/DocumentFactory.scala` | Update URI scheme constant reference |
| `common/workflow-core/.../storage/model/OnDataset.scala` | Rename trait to `OnRepository` |
| `file-service/.../FileService.scala` | Register renamed resources |
| `file-service/.../test/.../MockLakeFS.scala` | Update references |
| `frontend/.../dashboard/component/user/user-dataset/*` | Use repository service with type filter |
| `frontend/.../dashboard/component/user/user-ml-model/*` | Use repository service with type filter |

---

## 5. Migration Strategy for Existing Data

### 5.1 Database Migration

Existing datasets must seamlessly become `repository` rows with `type = 'dataset'`:

```sql
-- Step 1: Add enum type
CREATE TYPE repository_type_enum AS ENUM ('dataset', 'model');

-- Step 2: Rename tables
ALTER TABLE dataset RENAME TO repository;
ALTER TABLE dataset_version RENAME TO repository_version;
ALTER TABLE dataset_user_access RENAME TO repository_user_access;
ALTER TABLE dataset_upload_session RENAME TO repository_upload_session;
ALTER TABLE dataset_upload_session_part RENAME TO repository_upload_session_part;
ALTER TABLE dataset_user_likes RENAME TO repository_user_likes;
ALTER TABLE dataset_view_count RENAME TO repository_view_count;

-- Step 3: Rename PK columns
ALTER TABLE repository RENAME COLUMN did TO rid;
ALTER TABLE repository_version RENAME COLUMN dvid TO rvid;
ALTER TABLE repository_version RENAME COLUMN did TO rid;
ALTER TABLE repository_user_access RENAME COLUMN did TO rid;
ALTER TABLE repository_upload_session RENAME COLUMN did TO rid;
ALTER TABLE repository_user_likes RENAME COLUMN did TO rid;
ALTER TABLE repository_view_count RENAME COLUMN did TO rid;

-- Step 4: Add type column (all existing rows are datasets)
ALTER TABLE repository ADD COLUMN type repository_type_enum NOT NULL DEFAULT 'dataset';

-- Step 5: Add composite uniqueness constraint
CREATE UNIQUE INDEX idx_repository_owner_name_type ON repository(owner_uid, name, type);

-- Step 6: Recreate PGroonga indexes (they reference table names)
-- (drop old dataset indexes, create new ones on repository table)
```

### 5.2 LakeFS Repositories

Existing LakeFS repositories are named `dataset-{did}`. These continue to work because the name is stored in `repository.repository_name` and looked up from the database — it is never re-derived. New repositories will be named `repository-{rid}`.

**No LakeFS migration is needed.** Old repos keep their `dataset-*` names. New repos get `repository-*` names. Both are valid LakeFS repository names.

### 5.3 S3 Storage

Similarly, S3 storage namespace for existing repos is `s3://bucket/datasets/dataset-{did}`. No migration needed — the namespace is stored in LakeFS metadata and retrieved from there.

For new repositories, the namespace could be:
- `s3://bucket/datasets/repository-{rid}` for datasets
- `s3://bucket/models/repository-{rid}` for models

Or simply `s3://bucket/repositories/repository-{rid}` for all types.

---

## 6. Backward Compatibility

### 6.1 API Endpoints

The REST API paths change from `/dataset/...` to `/repository/...`. This is a **breaking change** for any external consumers. Options:

- **Option A (Recommended)**: Clean break — update frontend and backend together, no old endpoints.
- **Option B**: Keep old `/dataset/...` endpoints as aliases that redirect/delegate to `/repository/...` for a transition period.

### 6.2 Logical Addresses

Old logical addresses (`/ownerEmail/datasetName/...`) stored in workflow operator properties will break. Options:

- **Option A (Recommended)**: Write a migration to prefix stored paths with `/datasets/`.
- **Option B**: Have `FileResolver` fall back to old format if the path doesn't start with a known resource type.

### 6.3 Internal URIs

The `dataset:///` URI scheme stored in execution records changes to `repository:///`. Since these URIs are ephemeral (used during execution, not persisted long-term), this should have minimal impact. But if any are stored in DB (e.g., in `workflow_executions.result`), a migration may be needed.

---

## 7. Implementation Order

The recommended implementation order minimizes risk and allows incremental testing:

### Step 1: Database Schema + JOOQ Regeneration
- Write migration SQL script
- Update `texera_ddl.sql`
- Regenerate JOOQ code
- **Test**: Verify existing datasets still queryable with new schema

### Step 2: Storage Layer (common/workflow-core)
- Rename `OnDataset` → `OnRepository`
- Rename `DatasetFileDocument` → `RepositoryFileDocument`
- Update `FileResolver` (new path format + type filter)
- Update `DocumentFactory` (new URI scheme)
- **Test**: Verify file resolution works with new path format

### Step 3: File-Service Backend
- Rename all Resource classes
- Update endpoint paths
- Add `type` to creation flow
- Update all DB queries to use new table/column names
- **Test**: Verify all CRUD operations for both datasets and models

### Step 4: Frontend
- Update types, services, components
- Update logical address construction
- Add model-specific UI filtering
- **Test**: End-to-end create/upload/version for both types

### Step 5: Data Migration
- Write and test backward-compat migration for stored logical addresses
- Run in staging, then production

### Step 6: Cleanup
- Remove any temporary backward-compat code
- Update documentation

---

## 8. Testing Checklist

- [ ] Create a dataset via new API → verify LakeFS repo created, DB row has `type = 'dataset'`
- [ ] Create a model via new API → verify LakeFS repo created, DB row has `type = 'model'`
- [ ] Upload file to dataset → verify file accessible via `/datasets/owner/name/v1/file`
- [ ] Upload file to model → verify file accessible via `/models/owner/name/v1/file`
- [ ] Same user creates dataset "test" and model "test" → both should coexist
- [ ] Access control works independently per resource
- [ ] Existing datasets still accessible after migration
- [ ] Old logical addresses (if migrated) resolve correctly
- [ ] Multipart upload works for both types
- [ ] Version creation works for both types
- [ ] Public access endpoints work for both types
- [ ] PGroonga full-text search works on renamed table
- [ ] Frontend list/filter shows correct resources per type