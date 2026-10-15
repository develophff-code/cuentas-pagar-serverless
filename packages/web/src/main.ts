import { AppView } from './app-view.js';
import { MockApiClient } from './api-client.js';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (!root) throw new Error('No se encontró el elemento root');

  // En entorno local o demo, usa MockApiClient autónomo.
  // Puede conmutarse con HttpApiClient pasando la URL base del API Gateway.
  const client = new MockApiClient();
  const app = new AppView(root, client);
  app.init().catch(console.error);
});
