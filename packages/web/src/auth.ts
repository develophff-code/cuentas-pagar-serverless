export interface LiveConfig {
  mode: 'live'; apiBaseUrl: string; region: string; userPoolId: string;
  clientId: string; authDomain: string;
}
type Tokens = { id_token: string; refresh_token?: string | undefined; expires_in: number };
const pendingKey = 'cuentas-pagar-login';
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

/** Authorization code + PKCE; tokens stay in memory and disappear on reload. */
export class CognitoSession {
  private tokens: Tokens | undefined;
  private expiresAt = 0;
  private refresh: Promise<string | null> | undefined;
  constructor(private readonly config: LiveConfig) {}
  private redirectUri() { return `${window.location.origin}/`; }
  async login(): Promise<void> {
    const verifier = random(), state = random(), nonce = random();
    sessionStorage.setItem(pendingKey, JSON.stringify({ verifier, state, nonce, at: Date.now() }));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const params = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code',
      redirect_uri: this.redirectUri(), scope: 'openid email profile', state, nonce,
      code_challenge_method: 'S256', code_challenge: challenge });
    window.location.assign(`${this.config.authDomain}/oauth2/authorize?${params}`);
  }
  async completeLogin(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('code') && !params.has('error')) return false;
    const raw = sessionStorage.getItem(pendingKey);
    sessionStorage.removeItem(pendingKey);
    history.replaceState(null, '', '/');
    if (!raw) throw new Error('El inicio de sesión venció. Volvé a ingresar.');
    const pending = JSON.parse(raw) as { verifier: string; state: string; nonce: string; at: number };
    if (params.get('state') !== pending.state || Date.now() - pending.at > 600_000) throw new Error('El inicio de sesión no es válido o venció.');
    if (params.has('error')) throw new Error('No se pudo completar el inicio de sesión.');
    const tokens = await this.exchange({ grant_type: 'authorization_code', code: params.get('code')!,
      redirect_uri: this.redirectUri(), code_verifier: pending.verifier });
    // Claims come directly from Cognito over HTTPS, never from a browser-supplied JWT.
    const segment = tokens.id_token.split('.')[1]!;
    const claims = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    if (claims.nonce !== pending.nonce || claims.aud !== this.config.clientId || claims.token_use !== 'id'
      || claims.iss !== `https://cognito-idp.${this.config.region}.amazonaws.com/${this.config.userPoolId}`
      || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('La respuesta de identidad no es válida.');
    this.accept(tokens);
    return true;
  }
  private async exchange(fields: Record<string, string>): Promise<Tokens> {
    const result = await fetch(`${this.config.authDomain}/oauth2/token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, client_id: this.config.clientId }), credentials: 'omit' });
    if (!result.ok) throw new Error('La sesión venció. Volvé a ingresar.');
    const tokens = await result.json() as Tokens;
    if (!tokens.id_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Respuesta de sesión inválida.');
    return tokens;
  }
  private accept(tokens: Tokens) {
    this.tokens = { ...tokens, refresh_token: tokens.refresh_token ?? this.tokens?.refresh_token };
    this.expiresAt = Date.now() + tokens.expires_in * 1000;
  }
  async getIdToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (Date.now() < this.expiresAt - 60_000) return this.tokens.id_token;
    if (!this.tokens.refresh_token) return null;
    if (!this.refresh) this.refresh = this.exchange({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token })
      .then(tokens => { this.accept(tokens); return tokens.id_token; })
      .catch(error => { this.tokens = undefined; throw error; }).finally(() => { this.refresh = undefined; });
    return this.refresh;
  }
  logout(): void {
    this.tokens = undefined;
    sessionStorage.removeItem(pendingKey);
    const params = new URLSearchParams({ client_id: this.config.clientId, logout_uri: this.redirectUri() });
    window.location.assign(`${this.config.authDomain}/logout?${params}`);
  }
}
