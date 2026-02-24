# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

FROM postgres:17-bookworm

# 1. Install prerequisites for adding the Groonga repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Add Groonga official APT repo and install pre-compiled PGroonga for PGDG
RUN wget https://packages.groonga.org/debian/groonga-apt-source-latest-bookworm.deb && \
    dpkg -i groonga-apt-source-latest-bookworm.deb && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    postgresql-17-pgdg-pgroonga \
    groonga-tokenizer-mecab \
    mecab \
    && rm -rf /var/lib/apt/lists/* \
    && rm groonga-apt-source-latest-bookworm.deb