#!/usr/bin/env bash
# Deploy / re-deploy the Texera monitoring stack to the current
# kubectl context. Idempotent: safe to re-run after editing values
# files, dashboards, or manifests.
#
# Prerequisites already in place from the initial setup:
#   - `monitoring` namespace exists
#   - secret `monitoring/texera-postgresql` (replicated from default)
#   - secret `monitoring/grafana-admin` with admin-user / admin-password
#
# Re-create the postgres password secret in monitoring if it goes away:
#   kubectl get secret texera-postgresql -n default -o yaml \
#     | sed -e 's/namespace: default/namespace: monitoring/' \
#           -e '/uid:/d' -e '/resourceVersion:/d' -e '/creationTimestamp:/d' \
#     | kubectl apply -f -
#
# Re-create the Grafana admin secret with a fresh password:
#   PASS=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)
#   kubectl create secret generic grafana-admin -n monitoring \
#     --from-literal=admin-user=arisheh \
#     --from-literal=admin-password="$PASS" \
#     --dry-run=client -o yaml | kubectl apply -f -

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update prometheus-community >/dev/null

echo "==> kube-prometheus-stack"
helm upgrade --install kps prometheus-community/kube-prometheus-stack \
  --namespace monitoring --version 84.5.0 \
  -f bin/k8s/monitoring/values-kube-prometheus-stack.yaml \
  --wait --timeout 10m

echo "==> prometheus-postgres-exporter"
helm upgrade --install pg-exporter \
  prometheus-community/prometheus-postgres-exporter \
  --namespace monitoring --version 8.0.0 \
  -f bin/k8s/monitoring/values-postgres-exporter.yaml \
  --wait --timeout 5m

echo "==> Datasource + gateway routing"
kubectl apply -f bin/k8s/monitoring/manifests/grafana-datasource-postgres.yaml
kubectl apply -f bin/k8s/monitoring/manifests/httproute-grafana.yaml

echo "==> Dashboards"
for f in bin/k8s/monitoring/dashboards/*.json; do
  base="$(basename "$f" .json)"
  cm="dashboard-${base}"
  kubectl create configmap "$cm" \
    --namespace monitoring \
    --from-file="$(basename "$f")=$f" \
    --dry-run=client -o yaml | \
    kubectl label --local -f - grafana_dashboard=1 grafana_folder=Texera \
      --dry-run=client -o yaml | \
    kubectl apply -f -
done

echo
echo "Done. Grafana: https://dknet-ai.org/grafana"
echo "User: arisheh"
echo "Password: kubectl get secret grafana-admin -n monitoring -o jsonpath='{.data.admin-password}' | base64 -d ; echo"
