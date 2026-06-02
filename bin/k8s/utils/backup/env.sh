# Defaults for Texera K8s backup scripts.
# Source this before running backup commands, or export these in your shell.
#
# Usage (on server):
#   source /path/to/env.sh
#   kubectl get pods -n "$TEXERA_NAMESPACE"

# SSH target when running from your laptop (optional)
export TEXERA_SSH="${TEXERA_SSH:-arisheh@texera-1.ics.uci.edu}"

# Main Texera namespace
export TEXERA_NAMESPACE="${TEXERA_NAMESPACE:-texera}"

# Kubeconfig on the server (required for kubectl on server)
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/rke2/rke2.yaml}"

# Release name used in Helm (for resource names like texera-postgresql)
export TEXERA_RELEASE_NAME="${TEXERA_RELEASE_NAME:-texera}"

# PostgreSQL
export TEXERA_PG_SVC="${TEXERA_RELEASE_NAME}-postgresql"
export TEXERA_PG_SECRET="${TEXERA_RELEASE_NAME}-postgresql"

# MinIO
export TEXERA_MINIO_SVC="${TEXERA_RELEASE_NAME}-minio"
