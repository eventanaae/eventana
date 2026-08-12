/**
 * Provider registry. The rest of the engine asks for a provider by name
 * and never knows whether it got the real adapter or the simulator.
 */
import { config } from '../config.js';
import type { PaymentProvider } from './provider.js';
import { SimulatedProvider } from './simulated.js';
import { TabbyProvider, mapTabbyStatus } from './tabby.js';
import { TamaraProvider, mapTamaraStatus } from './tamara.js';
import { ZiinaProvider, mapZiinaStatus } from './ziina.js';

export type ProviderName = 'tabby' | 'tamara' | 'ziina';

function build(name: ProviderName): PaymentProvider {
  const cfg = config.providers[name];
  if (cfg.mode === 'simulated') {
    switch (name) {
      case 'tabby':
        return new SimulatedProvider('tabby', 'tabby', '4 interest-free payments', mapTabbyStatus, cfg);
      case 'tamara':
        return new SimulatedProvider('tamara', 'tamara', 'Split in 4, no interest', mapTamaraStatus, cfg);
      case 'ziina':
        return new SimulatedProvider('ziina', 'Ziina', 'Card & wallet', mapZiinaStatus, cfg);
    }
  }
  switch (name) {
    case 'tabby':
      return new TabbyProvider(cfg);
    case 'tamara':
      return new TamaraProvider(cfg);
    case 'ziina':
      return new ZiinaProvider(cfg);
  }
}

const registry = new Map<ProviderName, PaymentProvider>();

export function getProvider(name: string): PaymentProvider {
  if (name !== 'tabby' && name !== 'tamara' && name !== 'ziina') {
    throw new Error(`Unknown payment provider: ${name}`);
  }
  let provider = registry.get(name);
  if (!provider) {
    provider = build(name);
    registry.set(name, provider);
  }
  return provider;
}

export function allProviders(): PaymentProvider[] {
  // A disabled provider (not production-ready in a live deployment) is not
  // offered to customers at all.
  return (['tabby', 'tamara', 'ziina'] as const)
    .filter((name) => config.providers[name].mode !== 'disabled')
    .map(getProvider);
}

/** Honest integration status for the dashboard's settings screen. */
export function integrationStatus() {
  return (['tabby', 'tamara', 'ziina'] as const).map((name) => {
    const cfg = config.providers[name];
    return {
      name,
      mode: cfg.mode,
      ready: cfg.mode === 'live' || cfg.mode === 'sandbox',
      missing: cfg.missing,
      webhookUrl: `${config.publicApiUrl}/api/webhooks/${name}`,
      note:
        cfg.mode === 'simulated'
          ? `Simulated — set ${cfg.missing
              .map((m) => `${name.toUpperCase()}_${m.replace(/([A-Z])/g, '_$1').toUpperCase()}`)
              .join(', ')} in the server environment to connect the real account.`
          : cfg.mode === 'disabled'
            ? 'Disabled in this live deployment — needs a complete set of production (non-test) credentials to accept real payments.'
            : cfg.mode === 'sandbox'
              ? 'Sandbox keys loaded. Run the 9-case test plan before switching to live.'
              : 'Live keys loaded.',
    };
  });
}

export * from './provider.js';
export { SimulatedProvider } from './simulated.js';
