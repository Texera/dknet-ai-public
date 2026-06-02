# Texera K8s Backup Utilities

Scripts and notes for backing up a Texera deployment on the RKE2 Kubernetes cluster.

## Server & access

- **Host:** `texera-1.ics.uci.edu`
- **SSH:** `ssh arisheh@texera-1.ics.uci.edu`
- **Kubeconfig:** On the server, use `KUBECONFIG=/etc/rancher/rke2/rke2.yaml` for `kubectl` (or copy to `~/.kube/config`).

## Cluster summary (as of check)

- **RKE2** cluster; kubectl client v1.30.5+rke2r1.
- **Nodes:** texera-1–5 (control-plane on 1–3), archimedes-23, archimedes-24.
- **Storage classes:** `local-path` (Rancher), `nfs-client` (used by Texera PVCs).

## Texera namespaces

| Namespace                         | Purpose                          |
|-----------------------------------|----------------------------------|
| `texera`                          | Main Texera deployment           |
| `texera-dev`                      | Dev deployment (optional)        |
| `texera-workflow-computing-unit-pool` | Workflow computing units    |
| `texera-cd`                       | Argo CD                          |
| `texera-observability`            | Grafana, Loki, OTEL              |

## Data to back up (main: `texera` namespace)

1. **PostgreSQL**
   - Service: `texera-postgresql` (port 5432).
   - Secret: `texera-postgresql` (credentials).
   - PVC: `postgresql-data-pvc` (50Gi, nfs-client).
   - DBs: `texera_db`, `texera_lakefs`, plus others (e.g. LiteLLM).

2. **MinIO**
   - Service: `texera-minio` (port 9000).
   - PVC: `minio-data-pvc` (200Gi, nfs-client).
   - Object storage for files and LakeFS block store.

3. **LakeFS**
   - Uses PostgreSQL DB and MinIO; no separate volume beyond those.

4. **Other PVCs in `texera`** (optional per need):  
   `minio-pvc`, `postgres-pvc`, `postgresql-litellm-data-pvc`, `texera-file-volume`, `mongodb-pvc`, Flarum PVCs, etc.

## Useful kubectl commands (run on server)

```bash
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml

# Namespaces
kubectl get ns | grep texera

# Pods in main namespace
kubectl get pods -n texera

# PVCs / PVs
kubectl get pvc -n texera
kubectl get pv

# PostgreSQL and Minio
kubectl get svc -n texera | grep -E 'postgres|minio'
kubectl get secret -n texera texera-postgresql -o jsonpath='{.data.postgres-password}' | base64 -d
```

## Backup commands (run on server)

Set kubeconfig and backup dir, then run. Replace `Feb_26_2026` with your date folder if needed.

**MinIO** (compress data dir to tar.gz; can take a long time for large buckets):

```bash
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
BACKUP_DIR="/extra/chenli-research0/db_backup/texera/hub/Feb_26_2026"
mkdir -p "$BACKUP_DIR"

kubectl exec -n texera deployment/texera-minio -- tar czf - -C /bitnami/minio/data . > "$BACKUP_DIR/minio_backup_Feb_26_2026.tar.gz"
```

**PostgreSQL** (logical dump; password from `/hub-deployment/hub-override.yaml` on server):

```bash
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
BACKUP_DIR="/extra/chenli-research0/db_backup/texera/hub/Feb_26_2026"
mkdir -p "$BACKUP_DIR"

kubectl exec -n texera texera-postgresql-0 -- sh -c 'PGPASSWORD=texera_hub_dep_461252891023 /opt/bitnami/postgresql/bin/pg_dumpall -U postgres' > "$BACKUP_DIR/hub_backup_Feb_26_2026.sql"
```

## Scripts in this directory

- `env.sh` – Defaults for server, namespace, and kubeconfig (source from backup scripts).
- `backup-minio.sh` – MinIO backup one-liner (run on server).

## Running commands from your machine

From your laptop you can run one-off backup commands via SSH:

```bash
ssh arisheh@texera-1.ics.uci.edu "KUBECONFIG=/etc/rancher/rke2/rke2.yaml kubectl get pods -n texera"
```

For scripted backups, either:

- Run the scripts **on the server** (e.g. via cron) after copying them there, or  
- Have scripts on your machine that `ssh arisheh@texera-1.ics.uci.edu 'bash -s' < script.sh` and pass any needed env (e.g. backup dir, namespace).
