drop trigger if exists work_order_before_update on work_order;
drop function if exists work_order_before_update();
drop table if exists work_order;
drop table if exists proposal_token;

drop index if exists signature_one_per_signer;
drop index if exists proposal_provider_envelope_idx;
drop index if exists proposal_public_token_hash_key;

-- Restore the 0016 trigger body. Optional items and expiry are frozen
-- again once the proposal leaves draft.
create or replace function proposal_before_update()
returns trigger
language plpgsql
as $$
declare
  super boolean;
begin
  select rolsuper into super from pg_roles where rolname = current_user;
  if super then
    return new;
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'a proposal cannot move to another workspace' using errcode = 'P0001';
  end if;
  if new.estimate_id is distinct from old.estimate_id then
    raise exception 'a proposal cannot move to another estimate' using errcode = 'P0001';
  end if;
  if new.snapshot is distinct from old.snapshot then
    raise exception 'a proposal snapshot is pinned' using errcode = 'P0001';
  end if;
  if new.number is distinct from old.number
     or new.estimate_version is distinct from old.estimate_version then
    raise exception 'a proposal number is fixed' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status in ('rendered', 'void'))
       or (old.status = 'rendered' and new.status in ('sent', 'void'))
       or (old.status = 'sent' and new.status in ('viewed', 'declined', 'expired', 'void'))
       or (old.status = 'viewed' and new.status in ('signed', 'declined', 'expired', 'void'))
       or (old.status = 'declined' and new.status = 'void')
       or (old.status = 'expired' and new.status = 'void')
     ) then
    raise exception 'illegal proposal transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  if old.status <> 'draft'
     and (
       new.intro is distinct from old.intro
       or new.scope_note is distinct from old.scope_note
       or new.terms is distinct from old.terms
       or new.include_site_map is distinct from old.include_site_map
       or new.include_optional is distinct from old.include_optional
       or new.selected_optional_line_ids is distinct from old.selected_optional_line_ids
       or new.expires_at is distinct from old.expires_at
       or new.template_id is distinct from old.template_id
     ) then
    raise exception 'only a draft proposal can be edited' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'rendered' and new.pdf_file_id is null then
    raise exception 'rendering a proposal stores a pdf' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter table proposal drop constraint if exists proposal_message_length;
alter table proposal drop constraint if exists proposal_recipients_array;
alter table proposal drop column if exists bounced;
alter table proposal drop column if exists message;
alter table proposal drop column if exists recipients;
