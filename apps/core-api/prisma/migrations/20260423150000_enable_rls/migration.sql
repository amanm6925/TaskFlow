-- Enable Row-Level Security for multi-tenant isolation.
-- See docs/ADRs when we add one for full rationale. Summary:
-- - Two roles: the migrator (owner, bypasses RLS) and taskflow_app (restricted, subject to policies)
-- - Tenant context lives in the Postgres session variable app.current_user_id
-- - withTx() in the app sets this per-transaction via set_config(..., is_local=true)

-- 1. Create the restricted app role (idempotent, safe across repeated migrations)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow_app') THEN
    CREATE ROLE taskflow_app WITH LOGIN PASSWORD 'taskflow_app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2. Grant data-level privileges. Crucially, taskflow_app does NOT own the tables,
-- so BYPASSRLS does not apply to it.
GRANT USAGE ON SCHEMA public TO taskflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taskflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taskflow_app;

-- Future tables in this schema inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taskflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO taskflow_app;

-- 3. SECURITY DEFINER function: returns the current user's org ids, bypassing RLS.
-- Needed to break the recursion that would otherwise occur if the memberships
-- policy referenced the memberships table directly.
CREATE OR REPLACE FUNCTION current_user_org_ids() RETURNS SETOF text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT organization_id FROM memberships
  WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')
$$;

GRANT EXECUTE ON FUNCTION current_user_org_ids() TO taskflow_app;

-- 4. Enable RLS on tenant-scoped tables. Users and refresh_tokens are intentionally
-- unprotected — users must be queryable cross-org for email lookups during login/invite,
-- and refresh tokens are already secret-gated by their hash.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks        ENABLE ROW LEVEL SECURITY;

-- 5. Policies.

-- ORGANIZATIONS: visible only if the caller has a membership in the org.
-- Org INSERT happens via withAdminTx (bypasses RLS) because of the bootstrap paradox:
-- a new org cannot yet have a membership. WITH CHECK still defined as defense in depth.
CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id IN (SELECT current_user_org_ids()))
  WITH CHECK (id IN (SELECT current_user_org_ids()));

-- MEMBERSHIPS: SELECT/UPDATE/DELETE scoped to the caller's orgs.
-- INSERT permits:
--   (a) inserting your own membership (covers the bootstrap "you just joined" case, though
--       we actually use admin bypass for that — keeping the clause as a safety net), AND
--   (b) inserting any membership into an org you belong to (admin inviting other members).
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')
    OR organization_id IN (SELECT current_user_org_ids())
  );

CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (organization_id IN (SELECT current_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY memberships_delete ON memberships FOR DELETE
  USING (organization_id IN (SELECT current_user_org_ids()));

-- PROJECTS: scoped to the caller's orgs.
CREATE POLICY projects_tenant_isolation ON projects
  USING (organization_id IN (SELECT current_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- TASKS: scoped via project → org. The subquery on projects has its own RLS
-- applied automatically; the explicit org filter is defense in depth.
CREATE POLICY tasks_tenant_isolation ON tasks
  USING (
    project_id IN (
      SELECT id FROM projects WHERE organization_id IN (SELECT current_user_org_ids())
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE organization_id IN (SELECT current_user_org_ids())
    )
  );
