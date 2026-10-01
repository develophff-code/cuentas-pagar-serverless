export type InfrastructureProfile = 'mvp' | 'expanded';

/** MVP de USD 20 es el valor por defecto; costos fijos elevados son opt-in. */
export function parseInfrastructureProfile(value: unknown): InfrastructureProfile {
  if (value === undefined || value === 'mvp') return 'mvp';
  if (value === 'expanded') return 'expanded';
  throw new Error('infrastructureProfile debe ser mvp o expanded.');
}

export function infrastructurePlan(profile: InfrastructureProfile, enableBusiness: boolean) {
  if (profile === 'mvp' && enableBusiness) {
    throw new Error('El backend MVP con Data API todavía requiere adaptación. No se habilita Proxy/NAT como alternativa automática.');
  }
  return { includeData: profile === 'expanded', includeBusiness: profile === 'expanded' && enableBusiness };
}
