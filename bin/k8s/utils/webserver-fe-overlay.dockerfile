# Frontend-only overlay on top of the live webserver image.
#
# Use this when only files under frontend/ have changed and you don't
# want to wait ~30 min for a full sbt rebuild. The frontend is served
# by the texera-web-application JVM from /frontend/dist (see the main
# bin/texera-web-application.dockerfile), so swapping that directory
# is enough to roll the GUI.
#
# Build:
#   yarn --cwd frontend build
#   docker buildx build \
#       -f bin/k8s/utils/webserver-fe-overlay.dockerfile \
#       --platform=linux/amd64 \
#       --build-arg BASE=alirisheh876/texera-web-application@sha256:<digest> \
#       -t alirisheh876/texera-web-application:fe-<date> \
#       --push .
ARG BASE=alirisheh876/texera-web-application:latest
FROM ${BASE}

USER root
RUN rm -rf /frontend/dist
COPY frontend/dist /frontend/dist
RUN chown -R texera:texera /frontend
USER texera
