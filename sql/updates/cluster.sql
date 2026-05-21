-- Licensed to the Apache Software Foundation (ASF) under one
-- or more contributor license agreements.  See the NOTICE file
-- distributed with this work for additional information
-- regarding copyright ownership.  The ASF licenses this file
-- to you under the Apache License, Version 2.0 (the
-- "License"); you may not use this file except in compliance
-- with the License.  You may obtain a copy of the License at
--
--   http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing,
-- software distributed under the License is distributed on an
-- "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
-- KIND, either express or implied.  See the License for the
-- specific language governing permissions and limitations
-- under the License.

-- 1. Create a single consolidated ENUM type for all possible states
CREATE TYPE cluster_status AS ENUM (
    'LAUNCH_RECEIVED', 
    'PENDING', 
    'RUNNING', 
    'TERMINATE_RECEIVED', 
    'SHUTTING_DOWN', 
    'TERMINATED', 
    'STOP_RECEIVED', 
    'STOPPING', 
    'STOPPED', 
    'START_RECEIVED', 
    'LAUNCH_FAILED', 
    'TERMINATE_FAILED', 
    'STOP_FAILED', 
    'START_FAILED'
);

-- 2. Create the table
CREATE TABLE IF NOT EXISTS cluster (
    cid SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER NOT NULL CHECK (owner_id >= 0), -- Standard INT + CHECK replaces UNSIGNED
    machine_type VARCHAR(255) NOT NULL,
    number_of_machines INT NOT NULL,
    creation_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status cluster_status,
    -- Quoting "user" because it is a reserved keyword in Postgres
    FOREIGN KEY (owner_id) REFERENCES "user" (uid) ON DELETE CASCADE
);

-- 3. Create the cluster_activity table
CREATE TABLE IF NOT EXISTS cluster_activity (
    id SERIAL PRIMARY KEY,
    cluster_id INT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NULL,
    FOREIGN KEY (cluster_id) REFERENCES cluster (cid) ON DELETE CASCADE
);

-- 4. Create the index separately
CREATE INDEX idx_cluster_activity_cid_start ON cluster_activity (cluster_id, start_time);
