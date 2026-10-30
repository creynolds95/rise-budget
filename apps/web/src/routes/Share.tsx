import type { InviteCreateResponse, InviteListResponse } from '@rise/shared/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/primitives/Button';
import { Group, GroupRow } from '../components/primitives/Group';
import { Sheet } from '../components/primitives/Sheet';
import { api, ApiError, get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { localToday, shortDate } from '../lib/dates';
import { passkeyMessage } from '../lib/passkey';
import { useDevices, useMe } from '../lib/queries';

const inviteUrl = (token: string) => `${window.location.origin}/register#invite=${token}`;

/** Settings > Share: who has a login, and single-use 12-hour links to add someone. */
export function ShareSection() {
  const { stepUp } = useAuth();
  const qc = useQueryClient();
  const tz = useMe().data?.timezone;
  const devices = useDevices();
  const owner = devices.data?.viewerRole === 'owner';
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => get<InviteListResponse>('/auth/invite'),
    enabled: owner,
  });
  const [link, setLink] = useState<InviteCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seen = (iso: string) => shortDate(localToday(tz, new Date(iso)));
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : passkeyMessage(e, fail));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const made = await api<InviteCreateResponse>('POST', '/auth/invite', undefined, {
        stepUp: await stepUp(),
      });
      setCopied(false);
      setLink(made);
      await qc.invalidateQueries({ queryKey: ['invites'] });
    }, 'The link wasn’t made.');

  const revoke = (id: string) =>
    run(async () => {
      await api('DELETE', `/auth/invite/${id}`);
      await qc.invalidateQueries({ queryKey: ['invites'] });
    }, 'The link wasn’t revoked.');

  const rename = (id: string, current: string | null) => {
    const label = window.prompt('Name', current ?? '')?.trim();
    if (!label || label === current) return;
    void run(async () => {
      await api('PATCH', `/devices/passkeys/${encodeURIComponent(id)}`, { label });
      await qc.invalidateQueries({ queryKey: ['devices'] });
    }, 'The name wasn’t changed.');
  };

  const remove = (id: string, label: string | null) => {
    if (!window.confirm(`Remove ${label ?? 'this profile'}? They’ll be signed out right away.`))
      return;
    void run(async () => {
      await api('DELETE', `/devices/passkeys/${encodeURIComponent(id)}`, undefined, {
        stepUp: await stepUp(),
      });
      await qc.invalidateQueries({ queryKey: ['devices'] });
    }, 'The profile wasn’t removed.');
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setMsg('Copy didn’t work. Press and hold the link to copy it.');
    }
  };

  return (
    <>
      <Group title="Who has a login">
        {devices.data?.passkeys.map((k) => (
          <GroupRow
            key={k.id}
            label={
              <>
                {k.label ?? 'Passkey'}
                {k.role === 'owner' && (
                  <span className="ml-2 type-caption text-ink-muted">Owner</span>
                )}
              </>
            }
            hint={`Added ${seen(k.createdAt)}${k.lastUsedAt ? ` · used ${seen(k.lastUsedAt)}` : ''}`}
          >
            {owner && (
              <span className="flex shrink-0 gap-3">
                <button className="min-h-11 font-semibold" onClick={() => rename(k.id, k.label)}>
                  Rename
                </button>
                {(devices.data?.passkeys.length ?? 0) > 1 && (
                  <button
                    className="min-h-11 font-semibold text-clay"
                    onClick={() => remove(k.id, k.label)}
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </GroupRow>
        ))}
      </Group>
      {owner && (
        <Group
          title="Invite links"
          footer="Anyone with a link can add a passkey and gets full access to this budget. Each link works once and expires after 12 hours."
        >
          {invites.data?.invites.map((i) => (
            <GroupRow
              key={i.id}
              label="Link"
              hint={`Expires ${seen(i.expiresAt)}, ${time(i.expiresAt)}`}
            >
              <button
                className="min-h-11 shrink-0 font-semibold text-clay"
                disabled={busy}
                onClick={() => void revoke(i.id)}
              >
                Revoke
              </button>
            </GroupRow>
          ))}
          <div className="p-4">
            <Button className="w-full" disabled={busy} onClick={() => void create()}>
              Share
            </Button>
          </div>
        </Group>
      )}
      {msg && (
        <p role="alert" className="mt-2 px-1 text-clay">
          {msg}
        </p>
      )}
      {link && (
        <Sheet open title="Invite link" onClose={() => setLink(null)}>
          <p className="break-all rounded-input border border-hairline bg-surface p-3 type-caption">
            {inviteUrl(link.token)}
          </p>
          <p className="mt-3 text-ink-muted">
            Works once. Expires {seen(link.expiresAt)}, {time(link.expiresAt)}. It won’t be shown
            again.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={() => void copy(inviteUrl(link.token))}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button
                variant="quiet"
                onClick={() =>
                  void navigator.share({ url: inviteUrl(link.token) }).catch(() => undefined)
                }
              >
                Share…
              </Button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
