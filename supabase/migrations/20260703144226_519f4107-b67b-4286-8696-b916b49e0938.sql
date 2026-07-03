CREATE SCHEMA IF NOT EXISTS app_private;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT USAGE ON SCHEMA app_private TO service_role;

CREATE OR REPLACE FUNCTION app_private.is_room_member(_room_id uuid, _user_id uuid)
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

CREATE OR REPLACE FUNCTION app_private.room_id_for_poll(_poll_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT room_id FROM public.mass_bunk_polls WHERE id = _poll_id
$$;

GRANT EXECUTE ON FUNCTION app_private.is_room_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.room_id_for_poll(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_room_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.room_id_for_poll(uuid) TO service_role;

DROP POLICY IF EXISTS "Room owners can view their rooms" ON public.attendance_rooms;
CREATE POLICY "Room owners can view their rooms"
ON public.attendance_rooms
FOR SELECT
TO authenticated
USING (owner_id = auth.uid() OR app_private.is_room_member(id, auth.uid()));

DROP POLICY IF EXISTS "Members can view room roster" ON public.room_members;
CREATE POLICY "Members can view room roster"
ON public.room_members
FOR SELECT
TO authenticated
USING (app_private.is_room_member(room_id, auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Room members view polls" ON public.mass_bunk_polls;
CREATE POLICY "Room members view polls"
ON public.mass_bunk_polls
FOR SELECT
TO authenticated
USING (app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Room members create polls" ON public.mass_bunk_polls;
CREATE POLICY "Room members create polls"
ON public.mass_bunk_polls
FOR INSERT
TO authenticated
WITH CHECK (creator_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Poll creators update polls" ON public.mass_bunk_polls;
CREATE POLICY "Poll creators update polls"
ON public.mass_bunk_polls
FOR UPDATE
TO authenticated
USING (creator_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()))
WITH CHECK (creator_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Poll creators delete polls" ON public.mass_bunk_polls;
CREATE POLICY "Poll creators delete polls"
ON public.mass_bunk_polls
FOR DELETE
TO authenticated
USING (creator_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Room members view poll votes" ON public.mass_bunk_votes;
CREATE POLICY "Room members view poll votes"
ON public.mass_bunk_votes
FOR SELECT
TO authenticated
USING (app_private.is_room_member(app_private.room_id_for_poll(poll_id), auth.uid()));

DROP POLICY IF EXISTS "Room members vote anonymously" ON public.mass_bunk_votes;
CREATE POLICY "Room members vote anonymously"
ON public.mass_bunk_votes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND app_private.is_room_member(app_private.room_id_for_poll(poll_id), auth.uid()));

DROP POLICY IF EXISTS "Users update their own poll vote" ON public.mass_bunk_votes;
CREATE POLICY "Users update their own poll vote"
ON public.mass_bunk_votes
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND app_private.is_room_member(app_private.room_id_for_poll(poll_id), auth.uid()))
WITH CHECK (user_id = auth.uid() AND app_private.is_room_member(app_private.room_id_for_poll(poll_id), auth.uid()));

DROP POLICY IF EXISTS "Users delete their own poll vote" ON public.mass_bunk_votes;
CREATE POLICY "Users delete their own poll vote"
ON public.mass_bunk_votes
FOR DELETE
TO authenticated
USING (user_id = auth.uid() AND app_private.is_room_member(app_private.room_id_for_poll(poll_id), auth.uid()));

DROP POLICY IF EXISTS "Room members view SOS broadcasts" ON public.sos_broadcasts;
CREATE POLICY "Room members view SOS broadcasts"
ON public.sos_broadcasts
FOR SELECT
TO authenticated
USING (app_private.is_room_member(room_id, auth.uid()) AND expires_at > now());

DROP POLICY IF EXISTS "Room members send SOS broadcasts" ON public.sos_broadcasts;
CREATE POLICY "Room members send SOS broadcasts"
ON public.sos_broadcasts
FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Users update their SOS broadcasts" ON public.sos_broadcasts;
CREATE POLICY "Users update their SOS broadcasts"
ON public.sos_broadcasts
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()))
WITH CHECK (sender_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "Users delete their SOS broadcasts" ON public.sos_broadcasts;
CREATE POLICY "Users delete their SOS broadcasts"
ON public.sos_broadcasts
FOR DELETE
TO authenticated
USING (sender_id = auth.uid() AND app_private.is_room_member(room_id, auth.uid()));

DROP FUNCTION IF EXISTS public.is_room_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.room_id_for_poll(uuid);