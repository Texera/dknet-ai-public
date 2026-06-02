#!/usr/bin/env bash
# MinIO backup: tar.gz of /bitnami/minio/data from texera-minio deployment.
# Run on server (texera-1) with KUBECONFIG set. Creates one compressed archive in BACKUP_DIR.
#
# Usage:
#   export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
#   BACKUP_DIR="/extra/chenli-research0/db_backup/texera/hub/Feb_26_2026" ./backup-minio.sh
# Or with a date:
#   BACKUP_DIR="/extra/chenli-research0/db_backup/texera/hub/$(date +%b_%d_%Y)" ./backup-minio.sh

set -e
BACKUP_DIR="${BACKUP_DIR:-/extra/chenli-research0/db_backup/texera/hub/Feb_26_2026}"
DATE_LABEL="${DATE_LABEL:-Feb_26_2026}"
NAMESPACE="${TEXERA_NAMESPACE:-texera}"

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/minio_backup_${DATE_LABEL}.tar.gz"

echo "Backing up MinIO to $OUT ..."
kubectl exec -n "$NAMESPACE" deployment/texera-minio -- tar czf - -C /bitnami/minio/data . > "$OUT"
echo "Done. Size: $(du -h "$OUT" | cut -f1)"
