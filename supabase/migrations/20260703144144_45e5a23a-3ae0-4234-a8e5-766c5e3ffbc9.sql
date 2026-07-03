CREATE TABLE public.attendance_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT 'Attendance Room',
  invite_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_rooms_invite_code_format CHECK (invite_code ~ '^[A-Z0-9]{6}$')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_rooms TO authenticated;
GRANT ALL ON public.attendance_rooms TO service_role;
ALTER TABLE public.attendance_rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.attendance_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  display_name text NOT NULL DEFAULT 'Student',
  attendance_pct numeric(5,2) NOT NULL DEFAULT 0,
  status_badge text NOT NULL DEFAULT 'In Danger',
  active_streak integer NOT NULL DEFAULT 0,
  bunk_coins integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id),
  CONSTRAINT room_members_attendance_pct_range CHECK (attendance_pct >= 0 AND attendance_pct <= 100),
  CONSTRAINT room_members_status_badge_allowed CHECK (status_badge IN ('Safe', 'On the Edge', 'In Danger'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_members TO authenticated;
GRANT ALL ON public.room_members TO service_role;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mass_bunk_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.attendance_rooms(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL DEFAULT auth.uid(),
  subject text NOT NULL,
  class_slot text NOT NULL,
  class_date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mass_bunk_polls TO authenticated;
GRANT ALL ON public.mass_bunk_polls TO service_role;
ALTER TABLE public.mass_bunk_polls ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mass_bunk_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.mass_bunk_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  intent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id),
  CONSTRAINT mass_bunk_votes_intent_allowed CHECK (intent IN ('attending', 'bunking'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mass_bunk_votes TO authenticated;
GRANT ALL ON public.mass_bunk_votes TO service_role;
ALTER TABLE public.mass_bunk_votes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sos_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.attendance_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid(),
  sender_name text NOT NULL DEFAULT 'A friend',
  subject text NOT NULL,
  class_slot text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_broadcasts TO authenticated;
GRANT ALL ON public.sos_broadcasts TO service_role;
ALTER TABLE public.sos_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_room_member(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = _room_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.room_id_for_poll(_poll_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT room_id FROM public.mass_bunk_polls WHERE id = _poll_id
$$;

CREATE OR REPLACE FUNCTION public.touch_collaboration_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_rooms_touch_updated_at
BEFORE UPDATE ON public.attendance_rooms
FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_updated_at();

CREATE TRIGGER room_members_touch_updated_at
BEFORE UPDATE ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_updated_at();

CREATE TRIGGER mass_bunk_polls_touch_updated_at
BEFORE UPDATE ON public.mass_bunk_polls
FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_updated_at();

CREATE TRIGGER mass_bunk_votes_touch_updated_at
BEFORE UPDATE ON public.mass_bunk_votes
FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_updated_at();

CREATE TRIGGER sos_broadcasts_touch_updated_at
BEFORE UPDATE ON public.sos_broadcasts
FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_updated_at();

CREATE POLICY "Room owners can view their rooms"
ON public.attendance_rooms
FOR SELECT
TO authenticated
USING (owner_id = auth.uid() OR public.is_room_member(id, auth.uid()));

CREATE POLICY "Users can create rooms"
ON public.attendance_rooms
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Room owners can update rooms"
ON public.attendance_rooms
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Room owners can delete rooms"
ON public.attendance_rooms
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY "Members can view room roster"
ON public.room_members
FOR SELECT
TO authenticated
USING (public.is_room_member(room_id, auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Users can join rooms as themselves"
ON public.room_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update their own room profile"
ON public.room_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users leave rooms as themselves"
ON public.room_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Room members view polls"
ON public.mass_bunk_polls
FOR SELECT
TO authenticated
USING (public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Room members create polls"
ON public.mass_bunk_polls
FOR INSERT
TO authenticated
WITH CHECK (creator_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Poll creators update polls"
ON public.mass_bunk_polls
FOR UPDATE
TO authenticated
USING (creator_id = auth.uid() AND public.is_room_member(room_id, auth.uid()))
WITH CHECK (creator_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Poll creators delete polls"
ON public.mass_bunk_polls
FOR DELETE
TO authenticated
USING (creator_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Room members view poll votes"
ON public.mass_bunk_votes
FOR SELECT
TO authenticated
USING (public.is_room_member(public.room_id_for_poll(poll_id), auth.uid()));

CREATE POLICY "Room members vote anonymously"
ON public.mass_bunk_votes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_room_member(public.room_id_for_poll(poll_id), auth.uid()));

CREATE POLICY "Users update their own poll vote"
ON public.mass_bunk_votes
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND public.is_room_member(public.room_id_for_poll(poll_id), auth.uid()))
WITH CHECK (user_id = auth.uid() AND public.is_room_member(public.room_id_for_poll(poll_id), auth.uid()));

CREATE POLICY "Users delete their own poll vote"
ON public.mass_bunk_votes
FOR DELETE
TO authenticated
USING (user_id = auth.uid() AND public.is_room_member(public.room_id_for_poll(poll_id), auth.uid()));

CREATE POLICY "Room members view SOS broadcasts"
ON public.sos_broadcasts
FOR SELECT
TO authenticated
USING (public.is_room_member(room_id, auth.uid()) AND expires_at > now());

CREATE POLICY "Room members send SOS broadcasts"
ON public.sos_broadcasts
FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Users update their SOS broadcasts"
ON public.sos_broadcasts
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid() AND public.is_room_member(room_id, auth.uid()))
WITH CHECK (sender_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

CREATE POLICY "Users delete their SOS broadcasts"
ON public.sos_broadcasts
FOR DELETE
TO authenticated
USING (sender_id = auth.uid() AND public.is_room_member(room_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mass_bunk_polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mass_bunk_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_broadcasts;