export type InfrastructureProfile = 'mvp' | 'expanded';

/** MVP de USD 20 es el valor por defecto; costos fijos elevados son opt-in. */
export function parseInfrastructureProfile(value: unknown): InfrastructureProfile {
  if (value === undefined || value === 'mvp') return 'mvp';
  if (value === 'expanded') return 'expanded';
  throw new Error('infrastructureProfile debe ser mvp o expanded.');
}

export function infrastructurePlan(profile: InfrastructureProfile, enableBusiness: boolean) {
  return { includeData: profile === 'expanded' || enableBusiness, includeBusiness: enableBusiness };
}
