import { User, UserSettings } from '@rise/shared/schemas';
import { nowIso, type UserId } from './util';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  settings_json: string;
  created_at: string;
}

const toUser = (r: UserRow): User =>
  User.parse({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    timezone: r.timezone,
    settings: JSON.parse(r.settings_json),
    createdAt: r.created_at,
  });

export async function getUser(userId: UserId, db: D1Database): Promise<User | null> {
  const row = await db
    .prepare('SELECT * FROM user WHERE id = ?1 /* scoped:user.id */')
    .bind(userId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

/** Provisioning only (T15 `seed:user`). There is no signup route. */
export async function createUser(
  userId: UserId,
  db: D1Database,
  input: { email: string; displayName: string; timezone?: string },
): Promise<User> {
  await db
    .prepare(
      'INSERT INTO user (id, email, display_name, timezone, settings_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) /* scoped:user.id */',
    )
    .bind(
      userId,
      input.email,
      input.displayName,
      input.timezone ?? 'America/Chicago',
      JSON.stringify(UserSettings.parse({})),
      nowIso(),
    )
    .run();
  return (await getUser(userId, db)) as User;
}

export async function updateSettings(
  userId: UserId,
  db: D1Database,
  patch: Partial<UserSettings>,
): Promise<UserSettings | null> {
  const user = await getUser(userId, db);
  if (!user) return null;
  const settings = UserSettings.parse({ ...user.settings, ...patch });
  await db
    .prepare('UPDATE user SET settings_json = ?2 WHERE id = ?1 /* scoped:user.id */')
    .bind(userId, JSON.stringify(settings))
    .run();
  return settings;
}
