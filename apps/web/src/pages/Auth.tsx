import { Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useLogin, useSession, useSetupAdmin, useSetupStatus } from '../api/queries';
import { Field, FormError } from '../components/ui';

function AuthFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth" id="main">
      <div className="auth-card">
        <div className="brand">Quorumloop</div>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          {intro}
        </p>
        <div className="round-rule" aria-hidden="true" />
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const session = useSession();
  const setup = useSetupStatus();
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (session.data) return <Navigate to="/" replace />;
  if (setup.data?.needs_setup) return <Navigate to="/setup" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate({ to: '/' }) });
  };

  return (
    <AuthFrame
      title="Sign in"
      intro="Use the account an owner or admin created for you on this instance."
    >
      <form onSubmit={submit} noValidate={false}>
        <Field label="Email" htmlFor="login-email">
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="login-password" hint="At least 12 characters.">
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <FormError error={login.error} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={login.isPending}>
            {login.isPending ? 'Signing in' : 'Sign in'}
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}

export function SetupPage() {
  const session = useSession();
  const setup = useSetupStatus();
  const create = useSetupAdmin();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    bootstrap_token: '',
    organization_name: '',
    display_name: '',
    email: '',
    password: '',
  });

  if (session.data) return <Navigate to="/" replace />;
  if (setup.data && !setup.data.needs_setup) return <Navigate to="/login" replace />;

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(form, { onSuccess: () => navigate({ to: '/' }) });
  };

  return (
    <AuthFrame
      title="Set up this instance"
      intro="Nobody has signed in here yet. Create the owner account and the organization it belongs to."
    >
      <form onSubmit={submit}>
        <Field
          label="Bootstrap token"
          htmlFor="setup-token"
          hint="SETUP_BOOTSTRAP_TOKEN from the .env file on the host that runs Quorumloop."
        >
          <input
            id="setup-token"
            type="password"
            autoComplete="off"
            required
            minLength={16}
            value={form.bootstrap_token}
            onChange={update('bootstrap_token')}
          />
        </Field>
        <Field label="Organization name" htmlFor="setup-org">
          <input
            id="setup-org"
            type="text"
            required
            maxLength={120}
            value={form.organization_name}
            onChange={update('organization_name')}
          />
        </Field>
        <Field label="Your name" htmlFor="setup-name">
          <input
            id="setup-name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            value={form.display_name}
            onChange={update('display_name')}
          />
        </Field>
        <Field label="Email" htmlFor="setup-email">
          <input
            id="setup-email"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={update('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="setup-password"
          hint="At least 12 characters with upper and lower case letters and a digit."
        >
          <input
            id="setup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={form.password}
            onChange={update('password')}
          />
        </Field>
        <FormError error={create.error} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating owner account' : 'Create owner account'}
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}
