import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, Dialog, DialogClose, DialogContent, SelectField, TextField } from "@groundwork/ui";
import { type FormEvent, useState } from "react";

import { authClient } from "./auth";
import {
  ApiError,
  activeWorkspace,
  api,
  loadMe,
  queryClient,
  takeInviteToken,
  type Address,
  type Me,
  type MemberRow,
  type RoleRow,
  type Workspace,
} from "./session";

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Honolulu",
  "UTC",
];

function Alert({ children }: { children: string }) {
  return (
    <p role="alert" className="text-base text-accent">
      {children}
    </p>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

async function continueAfterAuth(navigate: ReturnType<typeof useNavigate>): Promise<void> {
  const token = takeInviteToken();
  await queryClient.invalidateQueries({ queryKey: ["me"] });
  if (token) {
    await navigate({ to: "/invites/$token", params: { token } });
    return;
  }
  await navigate({ to: "/" });
}

export function SignInPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.error) {
      setError(result.error.message ?? "Could not sign in.");
      return;
    }
    await continueAfterAuth(navigate);
  }

  async function onMagic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.magicLink({
      email: String(form.get("magic-email") ?? ""),
      callbackURL: `${window.location.origin}/`,
    });
    if (result.error) {
      setError(result.error.message ?? "Could not send the link.");
      return;
    }
    setNotice("Check your email for the sign-in link.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={onPassword} className="flex flex-col gap-4">
        <TextField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          required
        />
        <TextField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit">Sign in</Button>
      </form>
      <form onSubmit={onMagic} className="flex flex-col gap-4">
        <TextField
          id="magic-email"
          name="magic-email"
          label="Email a sign-in link"
          type="email"
          required
        />
        {notice ? <p>{notice}</p> : null}
        <Button type="submit" variant="secondary">
          Email me a link
        </Button>
      </form>
      <a className="text-base font-semibold underline" href="/sign-up">
        Create an account
      </a>
    </main>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.error) {
      setError(result.error.message ?? "Could not create the account.");
      return;
    }
    await continueAfterAuth(navigate);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Create account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="name" name="name" label="Name" autoComplete="name" required />
        <TextField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
        />
        <TextField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit">Create account</Button>
      </form>
      <a className="text-base font-semibold underline" href="/sign-in">
        Sign in
      </a>
    </main>
  );
}

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          timezone: String(form.get("timezone") ?? "America/New_York"),
          currency: String(form.get("currency") ?? "USD"),
          units_pref: String(form.get("units_pref") ?? "imperial"),
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate({ to: "/" });
    } catch (err) {
      setError(message(err, "Could not create the workspace."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <TextField id="company" name="name" label="Company name" required />
      <SelectField id="timezone" name="timezone" label="Timezone" defaultValue="America/New_York">
        {TIME_ZONES.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </SelectField>
      <TextField
        id="currency"
        name="currency"
        label="Currency"
        defaultValue="USD"
        maxLength={3}
        required
      />
      <SelectField id="units" name="units_pref" label="Units" defaultValue="imperial">
        <option value="imperial">Imperial</option>
        <option value="metric">Metric</option>
      </SelectField>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit">Create workspace</Button>
    </form>
  );
}

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold">No jobs yet</p>
      <p className="max-w-prose text-lg leading-relaxed">
        Measure a site, price the work, and send a proposal. Jobs show up here once estimating is
        connected.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const workspace = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api<Workspace>(`/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  if (!workspaceId) {
    return <p>Create a workspace before changing settings.</p>;
  }
  if (!workspace.data) {
    return <p>Loading settings.</p>;
  }
  return <SettingsForm workspace={workspace.data} />;
}

function SettingsForm({ workspace }: { workspace: Workspace }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const zones = TIME_ZONES.includes(workspace.timezone)
    ? TIME_ZONES
    : [workspace.timezone, ...TIME_ZONES];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const address: Address = {
      line1: String(form.get("line1") ?? ""),
      line2: String(form.get("line2") ?? ""),
      city: String(form.get("city") ?? ""),
      region: String(form.get("region") ?? ""),
      postal_code: String(form.get("postal_code") ?? ""),
      country: String(form.get("country") ?? ""),
    };
    try {
      await api(`/workspaces/${workspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          timezone: String(form.get("timezone") ?? ""),
          currency: String(form.get("currency") ?? ""),
          units_pref: String(form.get("units_pref") ?? ""),
          logo: String(form.get("logo") ?? "") || null,
          license_number: String(form.get("license_number") ?? "") || null,
          address,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace", workspace.id] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setSaved(true);
    } catch (err) {
      setError(message(err, "Could not save settings."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <TextField
        id="company"
        name="name"
        label="Company name"
        defaultValue={workspace.name}
        required
      />
      <SelectField id="timezone" name="timezone" label="Timezone" defaultValue={workspace.timezone}>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </SelectField>
      <TextField
        id="currency"
        name="currency"
        label="Currency"
        defaultValue={workspace.currency}
        maxLength={3}
        required
      />
      <SelectField id="units" name="units_pref" label="Units" defaultValue={workspace.units_pref}>
        <option value="imperial">Imperial</option>
        <option value="metric">Metric</option>
      </SelectField>
      <TextField id="logo" name="logo" label="Logo URL" defaultValue={workspace.logo ?? ""} />
      <TextField
        id="license"
        name="license_number"
        label="License number"
        defaultValue={workspace.license_number ?? ""}
      />
      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold">Address</legend>
        <TextField
          id="line1"
          name="line1"
          label="Street"
          defaultValue={workspace.address?.line1 ?? ""}
        />
        <TextField
          id="line2"
          name="line2"
          label="Street line 2"
          defaultValue={workspace.address?.line2 ?? ""}
        />
        <TextField
          id="city"
          name="city"
          label="City"
          defaultValue={workspace.address?.city ?? ""}
        />
        <TextField
          id="region"
          name="region"
          label="State"
          defaultValue={workspace.address?.region ?? ""}
        />
        <TextField
          id="postal"
          name="postal_code"
          label="Postal code"
          defaultValue={workspace.address?.postal_code ?? ""}
        />
        <TextField
          id="country"
          name="country"
          label="Country"
          defaultValue={workspace.address?.country ?? ""}
        />
      </fieldset>
      {error ? <Alert>{error}</Alert> : null}
      {saved ? <p>Settings saved.</p> : null}
      <Button type="submit">Save settings</Button>
    </form>
  );
}

export function MembersPage() {
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const members = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api<{ members: MemberRow[] }>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleRow[] }>("/roles"),
  });
  const [error, setError] = useState("");
  const [disableId, setDisableId] = useState<string | null>(null);

  if (!workspaceId) {
    return <p>Create a workspace before inviting people.</p>;
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/workspaces/${workspaceId}/invites`, {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          roleId: String(form.get("roleId") ?? ""),
        }),
      });
      event.currentTarget.reset();
      await refresh();
    } catch (err) {
      setError(message(err, "Could not send the invite."));
    }
  }

  async function changeRole(memberId: string, roleId: string) {
    setError("");
    try {
      await api(`/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ roleId }),
      });
      await refresh();
    } catch (err) {
      setError(message(err, "Could not change the role."));
    }
  }

  async function changeStatus(memberId: string, status: string) {
    setError("");
    try {
      await api(`/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setDisableId(null);
      await refresh();
    } catch (err) {
      setError(message(err, "Could not update the member."));
    }
  }

  const rows = members.data?.members ?? [];
  const roleRows = roles.data?.roles ?? [];

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onInvite} className="flex max-w-xl flex-col gap-4">
        <TextField id="invite-email" name="email" label="Email" type="email" required />
        <SelectField id="invite-role" name="roleId" label="Role" defaultValue={roleRows[5]?.id}>
          {roleRows.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectField>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit">Send invite</Button>
      </form>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Workspace members</caption>
        <thead>
          <tr>
            <th className="border-b border-line py-2 pr-3">Name</th>
            <th className="border-b border-line py-2 pr-3">Email</th>
            <th className="border-b border-line py-2 pr-3">Status</th>
            <th className="border-b border-line py-2 pr-3">Role</th>
            <th className="border-b border-line py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id}>
              <td className="py-3 pr-3">{member.name ?? "Invited"}</td>
              <td className="py-3 pr-3">{member.email}</td>
              <td className="py-3 pr-3">{member.status}</td>
              <td className="py-3 pr-3">
                <label className="sr-only" htmlFor={`role-${member.id}`}>
                  Role for {member.email ?? "member"}
                </label>
                <select
                  id={`role-${member.id}`}
                  className="min-h-11 rounded-md border border-line bg-paper px-3"
                  value={member.role_id}
                  onChange={(event) => {
                    void changeRole(member.id, event.target.value);
                  }}
                >
                  {roleRows.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-3">
                {member.status === "active" ? (
                  <Button variant="secondary" onClick={() => setDisableId(member.id)}>
                    Disable
                  </Button>
                ) : null}
                {member.status === "disabled" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void changeStatus(member.id, "active")}
                  >
                    Enable
                  </Button>
                ) : null}
                {member.status === "invited" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void changeStatus(member.id, "revoked")}
                  >
                    Revoke invite
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={disableId !== null} onOpenChange={(open) => !open && setDisableId(null)}>
        <DialogContent
          title="Disable member"
          description="They are signed out of Groundwork. You can enable them again later."
        >
          <div className="flex gap-3">
            <Button
              onClick={() => {
                if (disableId) {
                  void changeStatus(disableId, "disabled");
                }
              }}
            >
              Disable member
            </Button>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RolesPage() {
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleRow[] }>("/roles"),
  });
  return (
    <table className="w-full border-collapse text-left">
      <caption className="mb-3 text-left text-base">System roles. Custom roles come later.</caption>
      <thead>
        <tr>
          <th className="border-b border-line py-2 pr-3">Role</th>
          <th className="border-b border-line py-2">Permissions</th>
        </tr>
      </thead>
      <tbody>
        {(roles.data?.roles ?? []).map((role) => (
          <tr key={role.id}>
            <th scope="row" className="py-3 pr-3 font-semibold">
              {role.name}
            </th>
            <td className="py-3">{role.permissions.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AcceptInvitePage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await api(`/invites/${token}/accept`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate({ to: "/" });
    } catch (err) {
      setError(message(err, "Could not accept the invite."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <p className="text-lg leading-relaxed">Accept this invite to join the workspace.</p>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit">Accept invite</Button>
    </form>
  );
}

export function WorkspaceSwitcher({ me }: { me: Me }) {
  const current = activeWorkspace(me);
  const choices = me.memberships.filter((member) => member.status === "active");
  if (!current || choices.length === 0) {
    return null;
  }

  async function onChange(workspaceId: string) {
    if (workspaceId === current?.workspace_id) {
      return;
    }
    await api(`/workspaces/${workspaceId}/activate`, { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    await queryClient.invalidateQueries({ queryKey: ["members"] });
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="workspace-switcher" className="text-sm font-semibold">
        Workspace
      </label>
      <select
        id="workspace-switcher"
        className="min-h-11 rounded-md border border-line bg-paper px-3 text-base"
        value={current.workspace_id}
        onChange={(event) => {
          void onChange(event.target.value);
        }}
      >
        {choices.map((member) => (
          <option key={member.workspace_id} value={member.workspace_id}>
            {member.workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export async function signOut(navigate: ReturnType<typeof useNavigate>): Promise<void> {
  await authClient.signOut();
  queryClient.removeQueries({ queryKey: ["me"] });
  await navigate({ to: "/sign-in" });
}
