drop policy if exists identity_access on app_user;
drop policy if exists auth_connection on session;
drop policy if exists auth_connection on account;
drop policy if exists auth_connection on verification;
drop policy if exists tenant_isolation on workspace;
drop policy if exists tenant_isolation on "role";
drop policy if exists tenant_isolation on member;
drop policy if exists tenant_isolation on invitation;

drop table if exists invitation;
drop table if exists session;
drop table if exists account;
drop table if exists verification;
drop table if exists member;
drop table if exists workspace;
drop table if exists app_user;
drop table if exists "role";

drop function if exists member_fill_role_id();
drop function if exists set_updated_at();
