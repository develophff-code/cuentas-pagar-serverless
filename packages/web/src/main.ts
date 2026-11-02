import { AppView } from './app-view.js';
import { HttpApiClient, MockApiClient } from './api-client.js';
import { CognitoSession, type LiveConfig } from './auth.js';

async function start(root: HTMLElement) {
  const response = await fetch('/app-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar la configuración de la aplicación.');
  const config = await response.json();
  if (config.mode === 'demo' && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    await new AppView(root, new MockApiClient()).init();
    return;
  }
  if (config.mode !== 'live' || !config.clientId || !config.userPoolId || !config.region || !config.authDomain
    || config.apiBaseUrl !== '' || !/^https:\/\/[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/.test(config.authDomain)) {
    throw new Error('La aplicación todavía no tiene configurada su conexión segura.');
  }
  const session = new CognitoSession(config as LiveConfig);
  await session.completeLogin();
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'padding:12px 24px;background:#fff;display:flex;gap:16px;align-items:center;font-family:sans-serif';
  const button = document.createElement('button');
  toolbar.append(button);
  root.before(toolbar);
  if (!await session.getIdToken()) {
    root.textContent = 'Ingresá con tu cuenta para acceder a Cuentas a Pagar.';
    button.textContent = 'Iniciar sesión';
    button.onclick = () => { session.login().catch(showError); };
    return;
  }
  button.textContent = 'Cerrar sesión';
  button.onclick = () => session.logout();
  const token = await session.getIdToken();
  const res = await fetch('/v1/me/tenants', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudieron consultar tus empresas. Volvé a iniciar sesión.');
  const { items } = await res.json() as { items: { tenantId: string; businessName: string }[] };
  if (!items.length) {
    root.textContent = 'Tu cuenta todavía no tiene una empresa asignada. Solicitá el alta al administrador del piloto.';
    return;
  }
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Empresa');
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.tenantId;
    option.textContent = item.businessName;
    select.append(option);
  }
  toolbar.prepend(select);
  const open = async () => {
    select.disabled = true;
    try { await new AppView(root, new HttpApiClient('', () => session.getIdToken(), encodeURIComponent(select.value))).init(); }
    finally { select.disabled = false; }
  };
  select.onchange = () => { open().catch(showError); };
  await open();
}
function showError(error: unknown) {
  const root = document.getElementById('root')!;
  root.replaceChildren();
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : 'No se pudo abrir la aplicación.';
  const retry = document.createElement('button');
  retry.textContent = 'Volver a ingresar';
  retry.onclick = () => { location.href = '/'; };
  root.append(message, retry);
}
window.addEventListener('DOMContentLoaded', () => { start(document.getElementById('root')!).catch(showError); });
