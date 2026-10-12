-- Nickname filtering for the FOC FAST leaderboard.
--
-- Run this once in the Supabase SQL editor for project qiihwpffmkotsjausztc.
-- It is safe to run more than once.
--
-- WHY IT HAS TO BE HERE AND NOT ONLY IN THE APP
-- The publishable key is compiled into the public JavaScript bundle, which is
-- what it is for, and the insert policy accepts anything. So anybody who opens
-- the bundle can POST a nickname straight to the REST endpoint and never touch
-- the game. Checking the name in Dart is still worth doing, for instant
-- feedback, but it is not a control. This trigger is the control: it runs on
-- every insert whatever the client is.
--
-- TWO LISTS, BECAUSE ONE IS NOT ENOUGH
--   exact = false  matches anywhere in the name. For words long and specific
--                  enough that finding them inside something longer is almost
--                  certainly deliberate.
--   exact = true   matches only a whole word. For the short ones. Matching
--                  those as substrings rejects Cassandra, Essex, Weedon and
--                  Sexton, which on a public stand is a worse failure than the
--                  thing it prevents.
--
-- One known false positive is accepted: Scunthorpe. Keeping 'cunt' matching
-- anywhere is worth more than that one place name.
--
-- The same two lists and the same folding are mirrored in the Flutter app, in
-- lib/leaderboard/banned_words.dart. If they drift the database wins, and the
-- player sees a server error instead of a hint. That is a worse experience,
-- not a hole.

-- ---------------------------------------------------------------------------
-- 1. The list. Edit this table, not the code.
-- ---------------------------------------------------------------------------
create table if not exists public.banned_words (
  word  text primary key,
  exact boolean not null default false
);

alter table public.banned_words enable row level security;
-- Deliberately no policy for anon: visitors can neither read nor change the
-- list. The trigger below is security definer and sees it regardless.

insert into public.banned_words (word, exact) values
  -- matched anywhere -------------------------------------------------------
  ('fuck', false), ('fuk', false), ('shit', false), ('cunt', false),
  ('asshole', false), ('bastard', false), ('bitch', false), ('whore', false),
  ('slut', false), ('wank', false), ('jerkoff', false), ('blowjob', false),
  ('handjob', false), ('semen', false), ('penis', false), ('vagina', false),
  ('pussy', false), ('boobs', false), ('porn', false), ('horny', false),
  ('rapist', false), ('masturbat', false),
  ('nigger', false), ('nigga', false), ('niger', false), ('kaffir', false),
  ('kaffer', false), ('coolie', false), ('wetback', false), ('faggot', false),
  ('fagot', false), ('tranny', false), ('shemale', false), ('retard', false),
  ('spastic', false), ('mongoloid', false), ('hottentot', false),
  ('boesman', false), ('kwerekwere', false), ('hymie', false), ('pikey', false),
  ('hitler', false), ('nazi', false), ('genocide', false), ('terrorist', false),
  ('jihad', false), ('lynch', false), ('suicide', false), ('selfharm', false),
  ('killyou', false), ('cocaine', false), ('heroin', false), ('nyaope', false),
  ('administrator', false), ('moderator', false), ('lecturer', false),
  ('professor', false), ('supervisor', false), ('examiner', false),
  -- matched only as a whole word -------------------------------------------
  ('ass', true), ('arse', true), ('crap', true), ('piss', true), ('twat', true),
  ('dick', true), ('cock', true), ('tits', true), ('fag', true), ('cum', true),
  ('sex', true), ('rape', true), ('nude', true), ('naked', true),
  ('dyke', true), ('spaz', true), ('kike', true), ('spic', true),
  ('gook', true), ('chink', true), ('paki', true), ('yid', true),
  ('gypo', true), ('honky', true), ('kkk', true), ('isis', true),
  ('fck', true), ('poes', true), ('doos', true), ('kak', true), ('fok', true),
  ('naai', true), ('piel', true), ('moer', true), ('kffr', true),
  ('meth', true), ('tik', true), ('weed', true), ('murder', true),
  ('admin', true), ('staff', true), ('official', true), ('wits', true)
on conflict (word) do update set exact = excluded.exact;

-- ---------------------------------------------------------------------------
-- 2. Folding: undo the obvious dodges before matching.
-- ---------------------------------------------------------------------------
-- 4->a @->a 0->o (->c 1->i !->i |->i 3->e 8->b $->s 5->s 7->t +->t
create or replace function public.fold_nickname(value text)
returns text language sql immutable as $$
  select translate(lower(coalesce(value, '')), '40138$57@!|(+', 'aoiebsstaiict');
$$;

-- Every letter run together, so "F.U.C.K" and "f u c k" both become "fuck".
create or replace function public.normalise_nickname(value text)
returns text language sql immutable as $$
  select regexp_replace(public.fold_nickname(value), '[^a-z]', '', 'g');
$$;

-- The name as separate words, each reduced to its letters.
create or replace function public.nickname_tokens(value text)
returns text[] language sql immutable as $$
  select coalesce(
           array_remove(
             string_to_array(
               btrim(regexp_replace(public.fold_nickname(value), '[^a-z]+', ' ', 'g')),
               ' '),
             ''),
           '{}')::text[];
$$;

-- ---------------------------------------------------------------------------
-- 3. The check itself, on every insert and update.
-- ---------------------------------------------------------------------------
create or replace function public.reject_banned_nickname()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  folded text;
  tokens text[];
  hit    text;
begin
  folded := public.normalise_nickname(new.nickname);
  tokens := public.nickname_tokens(new.nickname);

  if folded = '' then
    raise exception 'Please include at least one letter in the nickname.'
      using errcode = 'check_violation';
  end if;

  select word into hit
  from public.banned_words
  where (not exact and folded like '%' || word || '%')
     or (exact and (word = any(tokens)
                    or (array_length(tokens, 1) = 1 and folded = word)))
  limit 1;

  if hit is not null then
    -- The offending word is deliberately not echoed back to the client.
    raise exception 'Please choose a different nickname for a public screen.'
      using errcode = 'check_violation';
  end if;

  -- Collapse runs of whitespace so a name cannot be padded out to push other
  -- people off the visible part of the board.
  new.nickname := regexp_replace(btrim(new.nickname), '\s+', ' ', 'g');
  return new;
end;
$$;

drop trigger if exists check_nickname on public.torque_chase_scores;
create trigger check_nickname
  before insert or update on public.torque_chase_scores
  for each row execute function public.reject_banned_nickname();

-- ---------------------------------------------------------------------------
-- 4. Tidy up what is already in the table.
-- ---------------------------------------------------------------------------
-- The row Claude inserted while demonstrating that the endpoint was open.
delete from public.torque_chase_scores where nickname = 'ZZ test bypass';

-- Anything already on the board that the new rule would have refused.
delete from public.torque_chase_scores s
where exists (
  select 1 from public.banned_words b
  where (not b.exact and public.normalise_nickname(s.nickname) like '%' || b.word || '%')
     or (b.exact and b.word = any(public.nickname_tokens(s.nickname)))
);

-- ---------------------------------------------------------------------------
-- 5. Check it. The first four must fail; the last four must succeed.
-- ---------------------------------------------------------------------------
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('sh1t', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('F.U.C.K', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('big ass', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('admin', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('Cassandra', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('Sexton', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('Clara P', 10);
-- insert into public.torque_chase_scores (nickname, max_rpm) values ('Oryon', 10);
-- delete from public.torque_chase_scores where max_rpm = 10;
