-- Runs once when the Docker database is first created.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE DATABASE openward_test OWNER openward;
\connect openward_test
CREATE EXTENSION IF NOT EXISTS postgis;
